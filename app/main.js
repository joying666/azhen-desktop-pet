const { app, BrowserWindow, Menu, ipcMain, screen, shell, dialog } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const EVENT_PORT = 17876;
const LOG_FILENAME = "桌宠运行日志.txt";
const DEFAULT_SETTINGS = {
  sizePx: 420,
  x: null,
  y: null,
  hideOnFullScreen: false,
  stateHoldMs: {
    done: 4200,
    failed: 4200,
    water: 120000,
  },
  waterReminder: {
    enabled: true,
    intervalMinutes: 60,
    workStart: "09:00",
    workEnd: "18:00",
  },
  rest: {
    enabled: true,
    start: "12:00",
    end: "13:00",
    state: "paused",
  },
};
const STANDARD_ASSET_STATES = {
  working: { label: "任务进行中", stem: "任务进行中_无缝循环", legacyStems: ["working"] },
  done: { label: "任务完成", stem: "任务完成", legacyStems: ["done"] },
  failed: { label: "任务失败", stem: "任务失败", legacyStems: ["failed"] },
  paused: { label: "任务暂停/休息", stem: "任务暂停_休息_无缝循环", legacyStems: ["paused", "任务暂停_无缝循环"] },
  water: { label: "喝水提醒", stem: "喝水提醒", legacyStems: ["water"] },
};
const STANDARD_STATE_EVENTS = {
  working: "agent.task.running",
  done: "agent.task.done",
  failed: "agent.task.failed",
  paused: "agent.waiting.user",
  water: "reminder.water.hourly",
};
const ASSET_EXTENSIONS = [".webm", ".gif", ".webp", ".apng", ".png", ".mp4"];

let mainWindow = null;
let settingsWindow = null;
let eventServer = null;
let desktopManifest = null;
let userSettings = Object.assign({}, DEFAULT_SETTINGS);
let saveBoundsTimer = null;
let suppressBoundsSave = false;
let waterPresentationRestoreBounds = null;
let waterPresentationReturnState = null;
let waterPresentationTimer = null;
let rendererState = null;
let rendererLoop = null;
let manualStateLock = null;

const WATER_PRESENTATION_MIN_SIZE = 420;
const WATER_PRESENTATION_MAX_SIZE = 560;
const WATER_PRESENTATION_SCALE = 1.6;

function log(message) {
  try {
    const logPath = path.join(app.getPath("userData"), LOG_FILENAME);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch (_) {
    // Logging should never stop the pet from starting, especially in packaged apps.
  }
}

function constrainSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_SETTINGS.sizePx;
  return Math.min(760, Math.max(180, Math.round(size)));
}

function constrainHoldMs(value, fallback) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return fallback;
  return Math.min(10 * 60 * 1000, Math.max(1000, Math.round(ms)));
}

function constrainIntervalMinutes(value, fallback) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.min(240, Math.max(5, Math.round(minutes)));
}

function normalizeClock(value, fallback) {
  const text = String(value || "");
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeBool(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeSettings(settings) {
  const source = settings || {};
  const hold = source.stateHoldMs || {};
  const water = source.waterReminder || {};
  const rest = source.rest || {};
  return {
    sizePx: constrainSize(source.sizePx),
    x: Number.isFinite(Number(source.x)) ? Math.round(Number(source.x)) : null,
    y: Number.isFinite(Number(source.y)) ? Math.round(Number(source.y)) : null,
    hideOnFullScreen: normalizeBool(source.hideOnFullScreen, DEFAULT_SETTINGS.hideOnFullScreen),
    stateHoldMs: {
      done: constrainHoldMs(hold.done, DEFAULT_SETTINGS.stateHoldMs.done),
      failed: constrainHoldMs(hold.failed, DEFAULT_SETTINGS.stateHoldMs.failed),
      water: constrainHoldMs(hold.water, DEFAULT_SETTINGS.stateHoldMs.water),
    },
    waterReminder: {
      enabled: normalizeBool(water.enabled, DEFAULT_SETTINGS.waterReminder.enabled),
      intervalMinutes: constrainIntervalMinutes(water.intervalMinutes, DEFAULT_SETTINGS.waterReminder.intervalMinutes),
      workStart: normalizeClock(water.workStart, DEFAULT_SETTINGS.waterReminder.workStart),
      workEnd: normalizeClock(water.workEnd, DEFAULT_SETTINGS.waterReminder.workEnd),
    },
    rest: {
      enabled: normalizeBool(rest.enabled, DEFAULT_SETTINGS.rest.enabled),
      start: normalizeClock(rest.start, DEFAULT_SETTINGS.rest.start),
      end: normalizeClock(rest.end, DEFAULT_SETTINGS.rest.end),
      state: STANDARD_ASSET_STATES[rest.state] ? rest.state : DEFAULT_SETTINGS.rest.state,
    },
  };
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "桌宠设置.json");
}

function loadSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"));
    return normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, settings));
  } catch (_) {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(userSettings, null, 2), "utf8");
}

function broadcastSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop-pet-settings", userSettings);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("desktop-pet-settings", userSettings);
  }
}

function applySettingsPatch(patch) {
  if (!patch || typeof patch !== "object") return userSettings;
  const shouldResize = Object.prototype.hasOwnProperty.call(patch, "sizePx");

  if (shouldResize) {
    userSettings.sizePx = constrainSize(patch.sizePx);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "hideOnFullScreen")) {
    userSettings.hideOnFullScreen = normalizeBool(patch.hideOnFullScreen, userSettings.hideOnFullScreen);
  }
  if (patch.stateHoldMs && typeof patch.stateHoldMs === "object") {
    userSettings.stateHoldMs = Object.assign({}, userSettings.stateHoldMs, patch.stateHoldMs);
  }
  if (patch.waterReminder && typeof patch.waterReminder === "object") {
    userSettings.waterReminder = Object.assign({}, userSettings.waterReminder, patch.waterReminder);
  }
  if (patch.rest && typeof patch.rest === "object") {
    userSettings.rest = Object.assign({}, userSettings.rest, patch.rest);
  }

  userSettings = normalizeSettings(userSettings);
  if (shouldResize && mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    mainWindow.setBounds({
      x: Math.round(centerX - userSettings.sizePx / 2),
      y: Math.round(centerY - userSettings.sizePx / 2),
      width: userSettings.sizePx,
      height: userSettings.sizePx,
    });
    const updatedBounds = mainWindow.getBounds();
    userSettings.x = updatedBounds.x;
    userSettings.y = updatedBounds.y;
  }
  applyFullScreenVisibility();
  saveSettings();
  broadcastSettings();
  return userSettings;
}

function applySize(sizePx) {
  return applySettingsPatch({ sizePx });
}

function applyFullScreenVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !userSettings.hideOnFullScreen });
  mainWindow.setAlwaysOnTop(true, "floating");
}

function rememberWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (suppressBoundsSave) return;
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    userSettings.x = bounds.x;
    userSettings.y = bounds.y;
    userSettings.sizePx = constrainSize(bounds.width);
    saveSettings();
  }, 150);
}

function defaultWindowBounds() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const size = constrainSize(userSettings.sizePx);
  return {
    width: size,
    height: size,
    x: Math.max(0, width - size - 36),
    y: Math.max(0, height - size - 36),
  };
}

function getInitialWindowBounds() {
  const fallback = defaultWindowBounds();
  if (!Number.isFinite(userSettings.x) || !Number.isFinite(userSettings.y)) {
    return fallback;
  }
  const display = screen.getDisplayNearestPoint({ x: userSettings.x, y: userSettings.y });
  const area = display.workArea;
  const size = constrainSize(userSettings.sizePx);
  const x = Math.min(Math.max(area.x - size + 80, userSettings.x), area.x + area.width - 80);
  const y = Math.min(Math.max(area.y - size + 80, userSettings.y), area.y + area.height - 80);
  return { width: size, height: size, x, y };
}

function resetPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return userSettings;
  restoreWaterPresentationFrame();
  const bounds = defaultWindowBounds();
  mainWindow.setBounds(bounds);
  userSettings.x = bounds.x;
  userSettings.y = bounds.y;
  userSettings.sizePx = bounds.width;
  saveSettings();
  return userSettings;
}

function findProjectRoot() {
  const candidates = [
    path.resolve(__dirname),
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", "..", "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "08_可替换素材", "状态映射.json")) ||
      fs.existsSync(path.join(candidate, "06_桌宠模板", "状态映射.json"))
    ) {
      return candidate;
    }
  }
  return path.resolve(__dirname, "..");
}

function loadDesktopManifest() {
  const projectRoot = findProjectRoot();
  const userManifestPath = path.join(projectRoot, "08_可替换素材", "状态映射.json");
  const manifestPath = fs.existsSync(userManifestPath)
    ? userManifestPath
    : path.join(projectRoot, "06_桌宠模板", "状态映射.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const state of Object.values(manifest.states || {})) {
    if (state.file && !String(state.file).startsWith("file:")) {
      const assetPath = resolveAssetPath(path.dirname(manifestPath), state.file);
      const version = fs.existsSync(assetPath) ? Math.round(fs.statSync(assetPath).mtimeMs) : Date.now();
      state.file = `${pathToFileURL(assetPath).toString()}?v=${version}`;
    }
  }
  manifest.projectRoot = projectRoot;
  return manifest;
}

function resolveAssetPath(baseDir, file) {
  const directPath = path.resolve(baseDir, file);
  if (path.extname(directPath) || fs.existsSync(directPath)) return directPath;
  for (const extension of ASSET_EXTENSIONS) {
    const candidate = directPath + extension;
    if (fs.existsSync(candidate)) return candidate;
  }
  return directPath;
}

function createWindow() {
  log("createWindow:start");
  const bounds = getInitialWindowBounds();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  applyFullScreenVisibility();
  mainWindow.loadFile(path.join(__dirname, "桌宠桌面.html"));
  log("createWindow:loaded");

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("move", rememberWindowBounds);
  mainWindow.on("resize", rememberWindowBounds);
}

function eventForState(stateName) {
  return STANDARD_STATE_EVENTS[stateName] || stateName || "agent.waiting.user";
}

function getCenteredBounds(size, sourceBounds) {
  const point = sourceBounds
    ? { x: sourceBounds.x + sourceBounds.width / 2, y: sourceBounds.y + sourceBounds.height / 2 }
    : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  return {
    width: size,
    height: size,
    x: Math.round(area.x + (area.width - size) / 2),
    y: Math.round(area.y + (area.height - size) / 2),
  };
}

function setWindowBoundsWithoutSaving(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  suppressBoundsSave = true;
  mainWindow.setBounds(bounds);
  setTimeout(() => {
    suppressBoundsSave = false;
  }, 250);
}

function restoreWaterPresentationFrame() {
  if (waterPresentationTimer) {
    clearTimeout(waterPresentationTimer);
    waterPresentationTimer = null;
  }
  if (mainWindow && !mainWindow.isDestroyed() && waterPresentationRestoreBounds) {
    setWindowBoundsWithoutSaving(waterPresentationRestoreBounds);
  }
  waterPresentationRestoreBounds = null;
  waterPresentationReturnState = null;
}

function showWaterPresentation(previousState) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentBounds = mainWindow.getBounds();
  if (!waterPresentationRestoreBounds) {
    waterPresentationRestoreBounds = currentBounds;
  }
  if (previousState && previousState !== "water") {
    waterPresentationReturnState = previousState;
  }
  if (!waterPresentationReturnState) {
    waterPresentationReturnState = "paused";
  }

  const baseSize = Math.max(userSettings.sizePx || currentBounds.width, currentBounds.width);
  const targetSize = Math.min(
    WATER_PRESENTATION_MAX_SIZE,
    Math.max(WATER_PRESENTATION_MIN_SIZE, Math.round(baseSize * WATER_PRESENTATION_SCALE)),
  );

  setWindowBoundsWithoutSaving(getCenteredBounds(targetSize, waterPresentationRestoreBounds));
  applyFullScreenVisibility();
  mainWindow.showInactive();

  if (waterPresentationTimer) clearTimeout(waterPresentationTimer);
  waterPresentationTimer = setTimeout(() => {
    const returnState = waterPresentationReturnState || "paused";
    restoreWaterPresentationFrame();
    sendEvent(eventForState(returnState));
  }, userSettings.stateHoldMs.water);
}

function handleRendererStateChange(detail) {
  const stateName = detail && detail.stateName ? String(detail.stateName) : "";
  const previousState = detail && detail.previousState ? String(detail.previousState) : "";
  const source = detail && detail.source ? String(detail.source) : "event";
  const locked = Boolean(detail && detail.locked);
  if (stateName) rendererState = stateName;
  if (detail && Object.prototype.hasOwnProperty.call(detail, "loop")) rendererLoop = Boolean(detail.loop);
  manualStateLock = locked ? rendererState : null;
  log(`state:${previousState || "none"}->${stateName || "unknown"} source:${source} lock:${manualStateLock || "none"} loop:${rendererLoop}`);
  if (stateName === "water") {
    showWaterPresentation(previousState);
    return;
  }
  if (waterPresentationRestoreBounds) {
    restoreWaterPresentationFrame();
  }
}

function normalizeEventPayload(nameOrPayload, options) {
  const source = nameOrPayload && typeof nameOrPayload === "object" ? nameOrPayload : {};
  const patch = options && typeof options === "object" ? options : {};
  const name = typeof nameOrPayload === "string"
    ? nameOrPayload
    : String(source.name || source.event || "");
  const payload = Object.assign({ name, manual: false, source: "event" }, source, patch, { name });
  if (payload.manual && payload.source === "event") payload.source = "manual";
  return payload;
}

function sendEvent(nameOrPayload, options) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const payload = normalizeEventPayload(nameOrPayload, options);
  if (!payload.name) return false;
  mainWindow.webContents.send("desktop-pet-event", payload);
  return true;
}

function sendManualEvent(name) {
  return sendEvent(name, { manual: true, source: "manual" });
}

function registerIpc() {
  ipcMain.handle("desktop-pet:get-manifest", () => desktopManifest);
  ipcMain.handle("desktop-pet:get-settings", () => userSettings);
  ipcMain.handle("desktop-pet:get-assets", () => getAssetInfo());
  ipcMain.handle("desktop-pet:update-settings", (_event, patch) => {
    return applySettingsPatch(patch);
  });
  ipcMain.handle("desktop-pet:open-settings", () => {
    createSettingsWindow();
    return userSettings;
  });
  ipcMain.handle("desktop-pet:send-event", (_event, name, options) => sendEvent(name, options));
  ipcMain.handle("desktop-pet:show-context-menu", () => {
    showContextMenu();
    return true;
  });
  ipcMain.handle("desktop-pet:open-assets-folder", () => {
    openAssetsFolder();
    return true;
  });
  ipcMain.handle("desktop-pet:replace-asset", (_event, stateKey) => replaceAsset(stateKey));
  ipcMain.handle("desktop-pet:reset-position", () => resetPosition());
  ipcMain.on("desktop-pet:state-change", (_event, detail) => {
    handleRendererStateChange(detail);
  });
}

function getAssetsFolder() {
  const projectRoot = desktopManifest && desktopManifest.projectRoot ? desktopManifest.projectRoot : findProjectRoot();
  return path.join(projectRoot, "08_可替换素材");
}

function openAssetsFolder() {
  const folder = getAssetsFolder();
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
}

function findCurrentAssetPath(stateKey) {
  const folder = getAssetsFolder();
  const config = STANDARD_ASSET_STATES[stateKey];
  const stems = config ? [config.stem].concat(config.legacyStems || []) : [stateKey];
  for (const stem of stems) {
    for (const extension of ASSET_EXTENSIONS) {
      const candidate = path.join(folder, `${stem}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function getAssetInfo() {
  return Object.entries(STANDARD_ASSET_STATES).map(([stateKey, config]) => {
    const currentPath = findCurrentAssetPath(stateKey);
    return {
      stateKey,
      label: config.label,
      exists: Boolean(currentPath),
      filename: currentPath ? path.basename(currentPath) : "",
      extension: currentPath ? path.extname(currentPath).toLowerCase() : "",
      path: currentPath || "",
    };
  });
}

function normalizeStateKey(value) {
  const text = String(value || "").trim();
  if (STANDARD_ASSET_STATES[text]) return text;
  for (const [stateKey, eventName] of Object.entries(STANDARD_STATE_EVENTS)) {
    if (eventName === text) return stateKey;
  }
  for (const [stateKey, state] of Object.entries((desktopManifest && desktopManifest.states) || {})) {
    if ((state.eventAliases || []).includes(text)) return stateKey;
  }
  return null;
}

function replaceAssetFromPath(stateKey, sourcePath) {
  const config = STANDARD_ASSET_STATES[stateKey];
  if (!config) {
    return { ok: false, error: "unknown_state" };
  }
  if (!sourcePath || typeof sourcePath !== "string") {
    return { ok: false, error: "missing_path" };
  }

  const resolvedSourcePath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSourcePath) || !fs.statSync(resolvedSourcePath).isFile()) {
    return { ok: false, error: "source_not_found", path: resolvedSourcePath };
  }

  const extension = path.extname(resolvedSourcePath).toLowerCase();
  if (!ASSET_EXTENSIONS.includes(extension)) {
    return { ok: false, error: "unsupported_extension", extension };
  }

  const folder = getAssetsFolder();
  fs.mkdirSync(folder, { recursive: true });
  const oldPaths = [];
  for (const stem of [config.stem].concat(config.legacyStems || [])) {
    for (const oldExtension of ASSET_EXTENSIONS) {
      oldPaths.push(path.join(folder, `${stem}${oldExtension}`));
    }
  }

  let copySourcePath = resolvedSourcePath;
  let tempSourcePath = null;
  if (oldPaths.some((oldPath) => path.resolve(oldPath) === resolvedSourcePath)) {
    tempSourcePath = path.join(folder, `.tmp-${Date.now()}-${path.basename(resolvedSourcePath)}`);
    fs.copyFileSync(resolvedSourcePath, tempSourcePath);
    copySourcePath = tempSourcePath;
  }

  for (const oldPath of oldPaths) {
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const targetPath = path.join(folder, `${config.stem}${extension}`);
  fs.copyFileSync(copySourcePath, targetPath);
  if (tempSourcePath && fs.existsSync(tempSourcePath)) fs.unlinkSync(tempSourcePath);
  desktopManifest = loadDesktopManifest();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      sendEvent(STANDARD_STATE_EVENTS[stateKey] || "agent.task.running", { manual: true });
    });
    mainWindow.reload();
  }

  return {
    ok: true,
    stateKey,
    label: config.label,
    filename: path.basename(targetPath),
    extension,
    path: targetPath,
    assets: getAssetInfo(),
  };
}

async function replaceAsset(stateKey) {
  const config = STANDARD_ASSET_STATES[stateKey];
  if (!config) {
    return { ok: false, error: "unknown_state" };
  }

  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    title: `选择${config.label}素材`,
    properties: ["openFile"],
    filters: [
      { name: "WebM 动图", extensions: ["webm"] },
      { name: "GIF 动图", extensions: ["gif"] },
      { name: "WebP 动图", extensions: ["webp"] },
      { name: "桌宠素材", extensions: ["webm", "gif", "webp", "apng", "png", "mp4"] },
      { name: "全部文件", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }

  return replaceAssetFromPath(stateKey, result.filePaths[0]);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 720,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "阿真桌面宠物设置",
    backgroundColor: "#f6f8fb",
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, "设置.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function showContextMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "切换状态",
      submenu: [
        { label: "任务进行中", click: () => sendManualEvent("agent.task.running") },
        { label: "任务完成", click: () => sendManualEvent("agent.task.done") },
        { label: "任务失败", click: () => sendManualEvent("agent.task.failed") },
        { label: "任务暂停", click: () => sendManualEvent("agent.waiting.user") },
        { label: "喝水提醒", click: () => sendManualEvent("reminder.water.hourly") },
      ],
    },
    {
      label: "显示大小",
      submenu: [
        { label: "小 300px", click: () => applySize(300) },
        { label: "中 420px", click: () => applySize(420) },
        { label: "大 560px", click: () => applySize(560) },
        { label: "超大 680px", click: () => applySize(680) },
      ],
    },
    { type: "separator" },
    { label: "设置...", click: () => createSettingsWindow() },
    { label: "打开素材文件夹", click: () => openAssetsFolder() },
    { label: "回到右下角", click: () => resetPosition() },
    { type: "separator" },
    { label: "退出桌宠", click: () => app.quit() },
  ]);
  menu.popup({ window: mainWindow });
}

function createMenu() {
  const template = [
    {
      label: "阿真桌面宠物",
      submenu: [
        { label: "任务进行中", accelerator: "CommandOrControl+1", click: () => sendManualEvent("agent.task.running") },
        { label: "任务完成", accelerator: "CommandOrControl+2", click: () => sendManualEvent("agent.task.done") },
        { label: "任务失败", accelerator: "CommandOrControl+3", click: () => sendManualEvent("agent.task.failed") },
        { label: "任务暂停", accelerator: "CommandOrControl+4", click: () => sendManualEvent("agent.waiting.user") },
        { label: "喝水提醒", accelerator: "CommandOrControl+5", click: () => sendManualEvent("reminder.water.hourly") },
        { type: "separator" },
        { label: "设置...", accelerator: "CommandOrControl+,", click: () => createSettingsWindow() },
        {
          label: "显示大小",
          submenu: [
            { label: "小 300px", click: () => applySize(300) },
            { label: "中 420px", click: () => applySize(420) },
            { label: "大 560px", click: () => applySize(560) },
            { label: "超大 680px", click: () => applySize(680) },
          ],
        },
        { type: "separator" },
        { label: "退出", accelerator: "CommandOrControl+Q", click: () => app.quit() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createEventServer() {
  log("eventServer:start");
  eventServer = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${EVENT_PORT}`}`);

    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        ok: true,
        app: "azhen-desktop-pet",
        settings: userSettings,
        state: rendererState,
        loop: rendererLoop,
        manualStateLock,
        bounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
        presentation: {
          water: Boolean(waterPresentationRestoreBounds),
          returnState: waterPresentationReturnState,
        },
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings/open") {
      createSettingsWindow();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, settings: userSettings }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/assets/open") {
      openAssetsFolder();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, path: getAssetsFolder() }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/assets") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, assets: getAssetInfo(), supportedExtensions: ASSET_EXTENSIONS }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/assets/replace") {
      const stateKey = normalizeStateKey(url.searchParams.get("stateKey") || url.searchParams.get("state") || url.searchParams.get("slot"));
      const sourcePath = url.searchParams.get("path") || url.searchParams.get("file") || "";
      const result = stateKey ? replaceAssetFromPath(stateKey, sourcePath) : { ok: false, error: "unknown_state" };
      response.writeHead(result.ok ? 200 : 400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/position/reset") {
      const settings = resetPosition();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, settings }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings") {
      if (url.searchParams.get("open") === "1") {
        createSettingsWindow();
      }
      const size = url.searchParams.get("size") || url.searchParams.get("sizePx");
      const hideOnFullScreen = url.searchParams.get("hideOnFullScreen");
      const patch = {};
      if (size) patch.sizePx = size;
      if (hideOnFullScreen !== null) {
        patch.hideOnFullScreen = ["1", "true", "yes", "on"].includes(String(hideOnFullScreen).toLowerCase());
      }
      const settings = Object.keys(patch).length ? applySettingsPatch(patch) : userSettings;
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, settings }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      request.on("end", () => {
        let patch = {};
        try {
          patch = JSON.parse(body || "{}");
        } catch (_) {
          patch = {};
        }
        const settings = applySettingsPatch(patch);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, settings }));
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/assets/replace") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 8192) request.destroy();
      });
      request.on("end", () => {
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch (_) {
          payload = {};
        }
        const stateKey = normalizeStateKey(payload.stateKey || payload.state || payload.slot);
        const result = stateKey ? replaceAssetFromPath(stateKey, payload.path || payload.file || "") : { ok: false, error: "unknown_state" };
        response.writeHead(result.ok ? 200 : 400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result));
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/event") {
      const name = url.searchParams.get("name") || "";
      const manual = ["1", "true", "yes", "manual"].includes(String(url.searchParams.get("manual") || "").toLowerCase());
      const ok = Boolean(name) && sendEvent(name, { manual, source: manual ? "manual-api" : "api" });
      response.writeHead(ok ? 200 : 400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok, event: name }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/event") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      request.on("end", () => {
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch (_) {
          payload = {};
        }
        const name = payload.event || payload.name || "";
        const manual = Boolean(payload.manual);
        const ok = Boolean(name) && sendEvent(name, { manual, source: manual ? "manual-api" : "api" });
        response.writeHead(ok ? 200 : 400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok, event: name }));
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false }));
  });

  eventServer.listen(EVENT_PORT, "127.0.0.1");
  eventServer.on("listening", () => log(`eventServer:listening:${EVENT_PORT}`));
  eventServer.on("error", (error) => log(`eventServer:error:${error.message}`));
}

app.whenReady().then(() => {
  userSettings = loadSettings();
  desktopManifest = loadDesktopManifest();
  registerIpc();
  log("app:ready");
  createWindow();
  createMenu();
  createEventServer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (eventServer) eventServer.close();
});
