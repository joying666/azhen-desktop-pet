const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  getManifest() {
    return ipcRenderer.invoke("desktop-pet:get-manifest");
  },
  getSettings() {
    return ipcRenderer.invoke("desktop-pet:get-settings");
  },
  getAssets() {
    return ipcRenderer.invoke("desktop-pet:get-assets");
  },
  updateSettings(patch) {
    return ipcRenderer.invoke("desktop-pet:update-settings", patch);
  },
  sendEvent(name, options) {
    return ipcRenderer.invoke("desktop-pet:send-event", name, options);
  },
  openSettings() {
    return ipcRenderer.invoke("desktop-pet:open-settings");
  },
  showContextMenu() {
    return ipcRenderer.invoke("desktop-pet:show-context-menu");
  },
  openAssetsFolder() {
    return ipcRenderer.invoke("desktop-pet:open-assets-folder");
  },
  replaceAsset(stateKey) {
    return ipcRenderer.invoke("desktop-pet:replace-asset", stateKey);
  },
  resetPosition() {
    return ipcRenderer.invoke("desktop-pet:reset-position");
  },
  notifyState(detail) {
    ipcRenderer.send("desktop-pet:state-change", detail);
  },
  onSettings(callback) {
    ipcRenderer.on("desktop-pet-settings", (_event, settings) => callback(settings));
  },
  onEvent(callback) {
    ipcRenderer.on("desktop-pet-event", (_event, name) => callback(name));
  },
});
