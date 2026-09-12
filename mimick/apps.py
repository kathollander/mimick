"""Showing a finished file in the file manager."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def open_with_default(path: Path) -> bool:
    """Hand a path to whatever the desktop uses for it."""
    if not shutil.which("xdg-open"):
        return False
    try:
        subprocess.Popen(["xdg-open", str(path)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def reveal(path: Path) -> bool:
    """Show a file in the file manager, selected where that is supported."""
    if shutil.which("gdbus"):
        try:
            subprocess.Popen(
                ["gdbus", "call", "--session",
                 "--dest", "org.freedesktop.FileManager1",
                 "--object-path", "/org/freedesktop/FileManager1",
                 "--method", "org.freedesktop.FileManager1.ShowItems",
                 f"['file://{path}']", ""],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except (OSError, subprocess.SubprocessError):
            pass
    return open_with_default(path.parent)
