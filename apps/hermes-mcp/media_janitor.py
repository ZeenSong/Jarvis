"""Bounded cleanup for temporary images produced during Jarvis conversations."""

from __future__ import annotations

import os
import time
from pathlib import Path


MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def prune(root: Path, now: float | None = None, ttl_seconds: int = 12 * 60 * 60, max_files: int = 256, max_bytes: int = 512 * 1024 * 1024) -> dict[str, int]:
    now = time.time() if now is None else now
    root.mkdir(parents=True, exist_ok=True)
    files = [path for path in root.iterdir() if path.is_file() and path.suffix.lower() in MEDIA_SUFFIXES]
    removed = 0
    for path in files[:]:
        try:
            stat = path.stat()
        except FileNotFoundError:
            files.remove(path)
            continue
        if now - stat.st_mtime > ttl_seconds or stat.st_size > 16 * 1024 * 1024:
            path.unlink(missing_ok=True)
            files.remove(path)
            removed += 1
    files.sort(key=lambda path: path.stat().st_mtime if path.exists() else 0, reverse=True)
    total = sum(path.stat().st_size for path in files if path.exists())
    for path in files[max_files:]:
        if path.exists():
            total -= path.stat().st_size
            path.unlink(missing_ok=True)
            removed += 1
    files = [path for path in files[:max_files] if path.exists()]
    for path in sorted(files, key=lambda candidate: candidate.stat().st_mtime):
        if total <= max_bytes:
            break
        total -= path.stat().st_size
        path.unlink(missing_ok=True)
        removed += 1
    return {"files": len([path for path in root.iterdir() if path.is_file()]), "bytes": total, "removed": removed}


def main() -> None:
    root = Path(os.environ.get("MEDIA_ROOT", "/opt/data/media/tmp"))
    ttl = int(os.environ.get("MEDIA_TTL_SECONDS", str(12 * 60 * 60)))
    max_files = int(os.environ.get("MEDIA_MAX_FILES", "256"))
    max_bytes = int(os.environ.get("MEDIA_MAX_BYTES", str(512 * 1024 * 1024)))
    interval = int(os.environ.get("MEDIA_INTERVAL_SECONDS", "300"))
    while True:
        try:
            result = prune(root, ttl_seconds=ttl, max_files=max_files, max_bytes=max_bytes)
            print(f"media_janitor files={result['files']} bytes={result['bytes']} removed={result['removed']}", flush=True)
        except Exception as error:
            print(f"media_janitor error={error}", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    main()
