#!/usr/bin/env python3
"""校验桌宠的 08_可替换素材 文件夹。"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


SLOTS = [
    ("working", "任务进行中_无缝循环", True),
    ("done", "任务完成", False),
    ("failed", "任务失败", False),
    ("paused", "任务暂停_休息_无缝循环", True),
    ("water", "喝水提醒", False),
]
EXTENSIONS = [".gif", ".webp", ".webm", ".apng", ".png", ".mp4"]


def find_asset(folder: Path, stem: str) -> Path | None:
    for ext in EXTENSIONS:
        candidate = folder / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def ffprobe(path: Path) -> dict[str, str]:
    if not shutil.which("ffprobe"):
        return {}
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,pix_fmt:stream_tags=alpha_mode:format=duration",
            "-of",
            "json",
            str(path),
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        return {}
    data = json.loads(result.stdout or "{}")
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    tags = stream.get("tags") or {}
    return {
        "codec": str(stream.get("codec_name") or ""),
        "width": str(stream.get("width") or ""),
        "height": str(stream.get("height") or ""),
        "pix_fmt": str(stream.get("pix_fmt") or ""),
        "alpha_mode": str(tags.get("alpha_mode") or ""),
        "duration": str(fmt.get("duration") or ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="校验标准桌宠可替换素材。")
    parser.add_argument("folder", help="08_可替换素材 文件夹路径")
    args = parser.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    print(f"# 素材校验：{folder}")
    if not folder.exists():
        print("失败：文件夹不存在")
        return 1

    ok = True
    for slot, stem, should_loop in SLOTS:
        asset = find_asset(folder, stem)
        if not asset:
            print(f"失败 {slot}：缺少 {stem} ({', '.join(EXTENSIONS)})")
            ok = False
            continue
        info = ffprobe(asset) if asset.suffix.lower() in {".webm", ".mp4", ".mov"} else {}
        loop_note = "应为循环状态" if should_loop else "应为一次性状态"
        detail = " ".join(f"{k}={v}" for k, v in info.items() if v)
        print(f"通过 {slot}：{asset.name} ({loop_note}) {detail}".rstrip())

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
