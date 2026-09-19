#!/usr/bin/env bash
# Bring the shared reading logic across from the desktop app.
#
# Work flows ONE WAY: fix it in mimick, then run this. Nothing in py/ should
# ever be edited here -- an edit made here is lost the next time this runs, and
# worse, it makes the two copies disagree about what a page says out loud.
#
#     tools/port.sh ../Mimick-linux
#
set -euo pipefail
SRC="${1:-../Mimick-linux}"
[ -d "$SRC/mimick" ] || { echo "No mimick package at $SRC" >&2; exit 1; }

for name in layout.py citations.py speech.py document.py annotations.py convert.py; do
    cp "$SRC/mimick/$name" "py/$name"
    echo "  $name"
done
git -C "$SRC" rev-parse HEAD > py/PORTED-FROM.txt
echo "ported from $(cat py/PORTED-FROM.txt)"
