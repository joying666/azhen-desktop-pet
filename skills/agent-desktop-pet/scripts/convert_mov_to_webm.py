#!/usr/bin/env python3
"""将透明或绿幕 MOV 转成带 alpha 通道的 VP9 WebM。"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


def build_filter(args: argparse.Namespace) -> str:
    filters: list[str] = []
    if args.fps:
        filters.append(f"fps={args.fps}")
    if args.scale:
        filters.append(f"scale={args.scale}:{args.scale}:flags=lanczos")
    if args.green_screen:
        filters.append(f"colorkey={args.key_color}:{args.similarity}:{args.blend}")
    filters.append("format=yuva420p")
    return ",".join(filters)


def main() -> int:
    parser = argparse.ArgumentParser(description="将 MOV 转成桌宠可用的透明 WebM。")
    parser.add_argument("--input", required=True, help="源 MOV 文件")
    parser.add_argument("--output", required=True, help="输出 WebM 文件")
    parser.add_argument("--green-screen", action="store_true", help="把输入文件当作绿幕视频处理，并抠掉绿色背景")
    parser.add_argument("--key-color", default="0x00FF00", help="绿幕颜色，例如 0x00FF00")
    parser.add_argument("--similarity", type=float, default=0.18, help="色键相似度")
    parser.add_argument("--blend", type=float, default=0.04, help="色键边缘混合强度")
    parser.add_argument("--fps", type=int, default=24, help="输出帧率")
    parser.add_argument("--scale", type=int, default=0, help="可选的正方形输出尺寸，例如 960")
    parser.add_argument("--crf", type=int, default=32, help="VP9 CRF，数值越低质量越高")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        raise SystemExit("未找到 ffmpeg。请先安装 ffmpeg。")

    source = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"未找到输入文件：{source}")
    output.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-an",
        "-vf",
        build_filter(args),
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-crf",
        str(args.crf),
        "-b:v",
        "0",
        str(output),
    ]
    subprocess.run(command, check=True)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
