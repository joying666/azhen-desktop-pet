# MOV 转 WebM 分支

当用户已经从动画、视频或设计工具导出 `.mov` 文件时，使用这个分支。

## 收到 MOV 路径后的处理

当用户把 MOV 路径发给你时，直接进入转换流程：

1. 检查路径是否存在。
2. 根据文件名判断槽位，例如 `任务完成.mov` -> `任务完成.webm`。
3. 如果无法判断，询问用户这个 MOV 对应 `working`、`done`、`failed`、`paused`、`water` 中的哪个槽位。
4. 将输出写入 `08_可替换素材/`。
5. 转换完成后校验素材。

标准槽位对应关系：

| 槽位 | 输入 MOV 常见文件名 | 输出 WebM |
|---|---|---|
| working | `任务进行中.mov`、`任务进行中_无缝循环.mov` | `任务进行中_无缝循环.webm` |
| done | `任务完成.mov` | `任务完成.webm` |
| failed | `任务失败.mov` | `任务失败.webm` |
| paused | `任务暂停.mov`、`任务暂停_休息.mov` | `任务暂停_休息_无缝循环.webm` |
| water | `喝水提醒.mov` | `喝水提醒.webm` |

## 分支 1：MOV 已经带透明通道

这通常出现在 ProRes 4444 或带 alpha 通道的动画导出文件中。

```bash
python3 scripts/convert_mov_to_webm.py \
  --input "source.mov" \
  --output "08_可替换素材/任务完成.webm"
```

## 分支 2：MOV 是绿幕背景

使用色键抠绿转换：

```bash
python3 scripts/convert_mov_to_webm.py \
  --input "source_green.mov" \
  --output "08_可替换素材/任务完成.webm" \
  --green-screen \
  --key-color 0x00FF00 \
  --similarity 0.18 \
  --blend 0.04
```

如果边缘仍有绿色残留，可以降低 `--blend` 或微调 `--similarity`。如果角色或道具里的重要绿色细节被误抠，降低 `--similarity`。

## 批量命名

把每个源 MOV 转成下面这些标准输出文件名之一：

```text
08_可替换素材/任务进行中_无缝循环.webm
08_可替换素材/任务完成.webm
08_可替换素材/任务失败.webm
08_可替换素材/任务暂停_休息_无缝循环.webm
08_可替换素材/喝水提醒.webm
```

如果用户一次提供多个 MOV 路径，可以用批量脚本：

```bash
python3 scripts/convert_mov_paths_to_standard_webm.py \
  "任务进行中.mov" \
  "任务完成.mov" \
  "任务失败.mov" \
  "任务暂停.mov" \
  "喝水提醒.mov" \
  --output-folder "08_可替换素材"
```

批量脚本会根据文件名中的关键词自动判断槽位。无法判断时，要求用户改名或补充对应关系。

## 环境要求

- 已安装 `ffmpeg`，并且可以在命令行直接调用。
- 优先使用 1:1 正方形源文件。
- 透明 WebM 推荐使用带 alpha 的 VP9 编码。
