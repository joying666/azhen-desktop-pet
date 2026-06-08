# 阿真桌面宠物

阿真桌面宠物是一个基于 Electron 的 Agent 状态桌宠。它可以根据通用 Agent 事件切换动作，也可以在设置页逐个替换每个状态的动态素材。

## 支持的平台

- macOS: 本机可直接 `npm start` 运行，也可以本地构建 DMG/ZIP
- Windows: 通过 GitHub Actions 的 Windows runner 构建 portable EXE

## 状态槽位

| 槽位 | 对应动作 | 默认事件 |
|---|---|---|
| `working` | 任务进行中 | `agent.task.running` |
| `done` | 任务完成 | `agent.task.done` |
| `failed` | 任务失败 | `agent.task.failed` |
| `paused` | 任务暂停/休息 | `agent.waiting.user` |
| `water` | 喝水提醒 | `reminder.water.hourly` |

## 素材替换

源码默认素材在 `app/08_可替换素材/`。打包后的 App 会在第一次启动时复制一份到系统用户数据目录，后续通过设置页替换 WebM/GIF/WebP 时会写入用户数据目录，不需要重新打包。

支持格式优先级：

```text
.webm -> .gif -> .webp -> .apng -> .png -> .mp4
```

每个状态都可以在设置页单独点击 `替换`，选择 WebM、GIF、WebP、APNG、PNG 或 MP4。手动切换状态后，该动作会保持并循环播放。设置页也可以选择全屏应用时是否隐藏桌宠。

也可以用本地接口替换：

```bash
curl "http://127.0.0.1:17876/assets/replace?state=done&path=/path/to/任务完成.gif"
```

## 本地开发

```bash
npm install
npm start
```

语法检查：

```bash
npm run check
```

## 构建

macOS:

```bash
npm run dist:mac
```

Windows:

```bash
npm run dist:win
```

Windows 默认输出 portable `.exe`，下载后可直接运行，不需要安装。仓库已经配置 `.github/workflows/build.yml`，推送到 GitHub 后会自动在 Windows runner 上构建 Windows 产物。

## Skill

更新后的桌宠 Skill 放在：

```text
skills/agent-desktop-pet/
```

它包含：

- 卡通 IP 参考图到静态首帧提示词
- 图生视频提示词
- MOV 转透明 WebM
- 可替换素材校验
- 通用 Agent 事件协议
