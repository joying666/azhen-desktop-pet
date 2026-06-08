# Agent 桌宠 Skill

一个开源清洁版桌宠 Skill，用来帮助普通用户替换自己的桌宠 IP 素材。

它的核心思路很简单：**先围绕一个卡通 IP 生成桌宠素材，再把最终素材替换进 5 个标准文件槽位。**

推荐完整链路：

```text
卡通 IP 参考图 -> 纯绿幕静态生图提示词 -> 图生视频提示词 -> 导出 MOV -> 转 WebM -> 替换桌宠素材
```

## 适合谁

- 你已经有一个桌宠壳，想把里面的人物换成自己的 IP。
- 你只有一个卡通 IP，想让 Agent 帮你写静态图提示词和视频提示词。
- 你有 GIF / WebP / WebM / APNG / PNG / MOV 动画，想放进桌宠里。
- 你还没有素材，想让 Agent 先帮你写图片提示词和视频提示词。
- 你想把桌宠状态接到 Claude、Codex、Aider、Goose 或其它 Agent。

## 5 个标准素材

把素材放进桌宠项目的 `08_可替换素材/` 文件夹，并使用下面的文件名：

| 文件名 | 状态含义 |
|---|---|
| `任务进行中_无缝循环.webm` | Agent 正在运行、思考、打字、调用工具 |
| `任务完成.webm` | Agent 完成任务 |
| `任务失败.webm` | Agent 执行失败或报错 |
| `任务暂停_休息_无缝循环.webm` | Agent 等待用户、暂停、空闲、休息 |
| `喝水提醒.webm` | 工作时间提醒喝水 |

也支持 `.gif`、`.webp`、`.apng`、`.png`、`.mp4`，但最推荐透明背景 `.webm`。同名素材优先级为 `.gif -> .webp -> .webm -> .apng -> .png -> .mp4`。

静态生图阶段的图片文件名按当前桌宠工程格式：

| 状态 | 静态图片文件名 |
|---|---|
| 任务进行中 | `任务进行中.png` |
| 任务完成 | `任务完成.png` |
| 任务失败 | `任务失败.png` |
| 任务暂停/休息 | `任务暂停.png` |
| 喝水提醒 | `喝水提醒.png` |

`任务进行中_无缝循环.webm`、`任务暂停_休息_无缝循环.webm` 是动态素材文件名，不是静态图片文件名。

## 三条使用分支

### 分支 A：你已经有 WebM / GIF / WebP / APNG / PNG

直接把文件改成上面的 5 个标准文件名，放到：

```text
08_可替换素材/
```

然后重启桌宠 App。

### 分支 B：你导出了 MOV

如果你的工具能导出透明 MOV，可以先转 WebM：

```bash
python3 scripts/convert_mov_to_webm.py \
  --input "任务完成.mov" \
  --output "08_可替换素材/任务完成.webm"
```

如果你的 MOV 是绿幕背景：

```bash
python3 scripts/convert_mov_to_webm.py \
  --input "任务完成_绿幕.mov" \
  --output "08_可替换素材/任务完成.webm" \
  --green-screen
```

### 分支 C：你还没有素材

让 Agent 使用这个 Skill：

```text
我想做一个 Agent 桌宠，请根据我的角色参考图，帮我设计 5 个标准状态并写图片提示词和视频提示词。
```

Skill 会先问你需要哪些动作，再生成：

- 首帧图提示词
- 图生视频提示词
- MOV/WebM 交付建议
- 5 个标准文件名

生成视频时，可以让第三方工具或设计师先导出 MOV。等你拿到 MOV 文件后，把路径发给 Agent，例如：

```text
这是任务完成的视频路径：/path/to/任务完成.mov，请帮我转成桌宠可用的 WebM。
```

Agent 会把它转成：

```text
08_可替换素材/任务完成.webm
```

如果一次有多个 MOV 路径，也可以批量转换：

```bash
python3 scripts/convert_mov_paths_to_standard_webm.py \
  "任务完成.mov" \
  "任务失败.mov" \
  "任务进行中.mov" \
  --output-folder "08_可替换素材"
```

### 分支 D：你不会使用 Skill，只想复制提示词

打开这份文档：

```text
references/step-by-step-prompts.md
```

它把整个流程拆成普通用户也能复制粘贴的 6 段提示词：

1. 多个不同状态的静态生图元提示词
2. 静态图质检提示词
3. 图生视频提示词
4. MOV 命名和交付提示词
5. MOV 转 WebM 提示词
6. 替换桌宠素材提示词

## 安装成 Skill

复制整个目录到你的 Skill 目录，例如：

```bash
cp -R agent-desktop-pet-skill-open-source ~/.codex/skills/agent-desktop-pet
```

或复制到你的其它 Agent Skill 目录。

## 校验素材

```bash
python3 scripts/validate_replaceable_assets.py "08_可替换素材"
```

## Agent 状态协议

桌宠建议统一接收这些通用事件：

| 事件 | 桌宠状态 |
|---|---|
| `agent.task.running` | 任务进行中 |
| `agent.tool.running` | 任务进行中 |
| `agent.task.done` | 任务完成 |
| `agent.task.failed` | 任务失败 |
| `agent.waiting.user` | 任务暂停/休息 |
| `reminder.water.hourly` | 喝水提醒 |

任何 Agent 只要能执行 hook、notify、shell command、MCP tool 或插件，都可以接入。

## 开源清洁原则

这个版本不包含：

- 私人 API Key
- 本机绝对路径
- 私有角色素材
- 虚拟环境
- 生成缓存
- 平台账号配置

你可以把自己的 IP 作为示例另放到 `examples/`，但不要把用户私有素材误提交到公开仓库。
