"""Write the list of files the app needs offline, and its version, into sw.js.

    python3 tools/stamp_offline.py          # after changing any file the app serves
    python3 tools/stamp_offline.py --check  # fails if sw.js is out of date

The version is a hash of every listed file, so a change to any of them gives
the service worker a new version, which browsers then fetch whole and switch to
at once. tools/check_offline.mjs runs the --check; run this before a release.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# What the reader loads, itself or in its workers. Not the test pages
# (spike.html, voice.html), not Node's own copy of Pyodide, not licences.
PATTERNS = [
    "reader.html", "index.html", "manifest.json", "icons/*.png",
    "js/*.js", "reader.py", "pages.py", "reading.py", "py/*.py",
    "vendor/pyodide/pyodide.js", "vendor/pyodide/pyodide.asm.js", "vendor/pyodide/pyodide.asm.wasm",
    "vendor/pyodide/python_stdlib.zip", "vendor/pyodide/pyodide-lock.json", "vendor/pyodide/*.whl",
    "vendor/piper/piper_phonemize.js", "vendor/piper/piper_phonemize.wasm", "vendor/piper/piper_phonemize.data",
    "vendor/onnxruntime/*.js", "vendor/onnxruntime/*.mjs", "vendor/onnxruntime/*.wasm",
    "vendor/lamejs/lamejs.iife.js",
    "vendor/tesseract/*.js", "vendor/tesseract/*.gz",
    "voices/*.mp3",
    # The tour's document (js/tour.js), so it works with no network too.
    "sample/sample.pdf",
]


def files() -> list[str]:
    found: set[str] = set()
    for pattern in PATTERNS:
        matched = sorted(ROOT.glob(pattern))
        if not matched:
            raise SystemExit(f"nothing matches {pattern}")
        found.update(p.relative_to(ROOT).as_posix() for p in matched if p.is_file())
    return sorted(found)


def stamp() -> tuple[str, list[str]]:
    listed = files()
    digest = hashlib.sha256()
    for name in listed:
        digest.update(name.encode() + b"\0" + (ROOT / name).read_bytes())
    return digest.hexdigest()[:16], listed


def main() -> None:
    version, listed = stamp()
    block = (f"const VERSION = {json.dumps(version)};\n"
             f"const FILES = {json.dumps(listed, indent=2)};\n")
    sw = ROOT / "sw.js"
    text = sw.read_text()
    pattern = re.compile(r"(// --- made by tools/stamp_offline.py[^\n]*\n)(.*?)(// --- end of stamp)", re.S)
    if not pattern.search(text):
        raise SystemExit("sw.js has no stamp markers")
    updated = pattern.sub(lambda m: m.group(1) + block + m.group(3), text)
    if "--check" in sys.argv:
        if updated != text:
            raise SystemExit("sw.js is out of date: run python3 tools/stamp_offline.py")
        print(f"sw.js is stamped {version}, {len(listed)} files")
        return
    sw.write_text(updated)
    print(f"stamped {version}, {len(listed)} files")


if __name__ == "__main__":
    main()
