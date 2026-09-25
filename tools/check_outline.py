#!/usr/bin/env python3
"""Check that the contents panel's positions land on the headings themselves.

    python3 tools/check_outline.py [document.pdf ...]

``pages.outline`` gives the panel a y for each entry, and the panel scrolls
there and decides from it which section you are in. That y used to be the
bookmark's own destination point, which cannot be used: the PDF specification
measures it from the *bottom* of the page, and real files disagree. A journal
PDF like Atleo and Boron's *Big Ideas* stores it from the bottom and
sample/test-paper.pdf stores it from the top, so either reading puts half the
entries of one of them in the wrong section -- clicking "Positionality and
Methods" scrolled to 89% down a page whose heading is at 12%.

So the y is measured off the page's own words instead, and this checks the
property that makes that right: **the words printed at that y are the heading**.
It holds whatever convention a file used, which is the point -- no fixture can
cover every kind of broken bookmark, but this invariant cannot be satisfied by
a misread coordinate.

Needs no browser. The desktop's tools/check_contents.py covers the same rule
from the other side, over one file of each convention.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# py/ is the desktop's shared code, imported as the package `mimick`, exactly
# as js/python.js arranges it in the browser.
_package = types.ModuleType("mimick")
_package.__path__ = [str(ROOT / "py")]
sys.modules["mimick"] = _package

import pymupdf                                             # noqa: E402

import pages                                               # noqa: E402
from mimick.document import _heading_key                   # noqa: E402

failures: list[str] = []


def check(claim: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {claim}{'' if ok else f'  -- {detail}'}")
    if not ok:
        failures.append(f"{claim}: {detail}")


def words_at(path: Path, page_number: int, y: float) -> str:
    """What is printed on the line at ``y``, as one string."""
    with pymupdf.open(path) as doc:
        page = doc[page_number]
        line = [w for w in page.get_text("words", sort=True) if abs(w[1] - y) < 2.0]
    return " ".join(word[4] for word in line)


def check_document(path: Path) -> None:
    print(f"\n{path.name}")
    info = pages.open_pages(path.read_bytes(), path.name)
    entries = info["outline"]
    pages.close()
    if not entries:
        print("  --    no table of contents, nothing to check")
        return
    check("it has a table of contents", True, "")

    wrong, placed = [], 0
    for _level, title, page, y, _open in entries:
        if page < 0 or y is None:
            continue          # goes nowhere, or no heading found: top of page
        placed += 1
        printed = _heading_key(words_at(path, page, y))
        wanted = _heading_key(title)
        # The line may carry more than the heading, so it is enough that one
        # begins with the other -- but there has to *be* a line. Without the
        # emptiness test this passes on a y that points at blank paper, since
        # everything starts with the empty string, and that is exactly what a
        # misread coordinate produces.
        if not printed or not (printed.startswith(wanted) or wanted.startswith(printed)):
            wrong.append(f"{title!r} -> p{page + 1} y={y}, which says {printed[:40]!r}")
    check(f"all {placed} placed entries land on their own heading", not wrong,
          "; ".join(wrong[:3]))

    # Going down the contents must never go back up the document. Only the
    # entries that were placed: one whose heading could not be found has no
    # position to be out of order, and falls back to the top of its page, which
    # would look like going backwards past anything else on that page.
    order = [(page, y) for _l, _t, page, y, _o in entries if page >= 0 and y is not None]
    check(f"and the {len(order)} of them run forwards through the document",
          order == sorted(order), f"{order}")


def main() -> int:
    given = [Path(argument) for argument in sys.argv[1:]]
    documents = given or [p for p in sorted((ROOT / "sample").glob("*.pdf"))]
    if not documents:
        print("No documents to check.")
        return 2
    for path in documents:
        check_document(path)

    print()
    if failures:
        print(f"{len(failures)} failure(s):")
        for line in failures:
            print(f"  {line}")
        return 1
    print("Every contents entry points at its own heading.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
