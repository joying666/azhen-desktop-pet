#!/usr/bin/env python3
"""把一个或多个 MOV 路径转换成 5 个标准桌宠 WebM 文件。"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


STANDARD_STEMS = {
    "working": "任务进行中_无缝循环",
    "done": "任务完成",
    "failed": "任务失败",
    "paused": "任务暂停_休息_无缝循环",
    "water": "喝水提醒",
}

KEYWORDS = {
    "working": ["任务进行中", "进行中", "working", "running", "typing"],
    "done": ["任务完成", "完成", "done", "success", "completed"],
    "failed": ["任务失败", "失败", "failed", "error"],
    "paused": ["任务暂停", "暂停", "休息", "paused", "idle", "rest"],
    "water": ["喝水提醒", "喝水", "water"],
}


def infer_slot(path: Path) -> str | None:
    name = path.stem.lower()
    for slot, keywords in KEYWORDS.items():
        if any(keyword.lower() in name for keyword in keywords):
            return slot
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="根据 MOV 文件名自动转换成标准桌宠 WebM 文件。")
    parser.add_argument("mov_paths", nargs="+", help="一个或多个 MOV 文件路径")
    parser.add_argument("--output-folder", default="08_可替换素材", help="输出文件夹，默认 08_可替换素材")
    parser.add_argument("--green-screen", action="store_true", help="把输入 MOV 当作绿幕视频处理")
    parser.add_argument("--scale", type=int, default=0, help="可选的正方形输出尺寸，例如 960")
    args = parser.parse_args()

    script = Path(__file__).with_name("convert_mov_to_webm.py")
    output_folder = Path(args.output_folder).expanduser().resolve()
    output_folder.mkdir(parents=True, exist_ok=True)

    ok = True
    for raw_path in args.mov_paths:
        source = Path(raw_path).expanduser().resolve()
        if not source.exists():
            print(f"失败：未找到 MOV 文件：{source}", file=sys.stderr)
            ok = False
            continue

        slot = infer_slot(source)
        if not slot:
            print(
                f"失败：无法从文件名判断槽位：{source.name}。请把文件名改成包含“任务完成/任务失败/任务进行中/任务暂停/喝水提醒”等关键词。",
                file=sys.stderr,
            )
            ok = False
            continue

        output = output_folder / f"{STANDARD_STEMS[slot]}.webm"
        command = [sys.executable, str(script), "--input", str(source), "--output", str(output)]
        if args.green_screen:
            command.append("--green-screen")
        if args.scale:
            command.extend(["--scale", str(args.scale)])
        subprocess.run(command, check=True)
        print(f"完成 {slot}：{source.name} -> {output}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
