"""The browser reader's page drawing: one open PDF, and its pages as pixels.

Runs in each js/page-worker.js, apart from the document worker, so pages can be
drawn while ``Document`` is still building sentences -- which on a long book
takes half a minute -- and so several pages can be drawn at once. Only MuPDF;
nothing here decides what a page says.
"""

from __future__ import annotations

from pathlib import Path

import pymupdf

_doc: pymupdf.Document | None = None


def open_pages(pdf_bytes: bytes, name: str) -> dict:
    """Open a PDF, closing whatever was open, and give its title and page sizes.

    The title is worked out as the desktop's ``Document.title`` does, so the
    header does not change when the sentences arrive."""
    global _doc
    close()
    _doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    title = ((_doc.metadata or {}).get("title") or "").strip() or Path(name).stem
    return {"title": title, "pages": [[page.rect.width, page.rect.height] for page in _doc],
            "outline": outline()}


def outline() -> list[list]:
    """The PDF's own table of contents, as ``[level, title, page, y, open]``.

    ``page`` counts from 0, or is -1 for an entry that goes nowhere in this file
    (a web link, a broken bookmark); ``y`` is where on the page it points, in
    points from the top, or None for the top. ``open`` is whether the file asks
    for the entry's children to be shown. A damaged outline gives none rather
    than stopping the document opening."""
    if _doc is None:
        return []
    try:
        toc = _doc.get_toc(simple=False)
    except Exception:
        return []
    out = []
    for level, title, number, dest in toc:
        page = number - 1 if 0 < number <= _doc.page_count else -1
        y = None
        point = dest.get("to") if isinstance(dest, dict) else None
        if page >= 0 and point is not None:
            height = _doc[page].rect.height
            y = round(min(max(float(point.y), 0.0), height), 1)
        is_open = not (isinstance(dest, dict) and dest.get("collapse"))
        out.append([int(level), " ".join(str(title).split()), page, y, is_open])
    return out


def render(page: int, scale: float) -> tuple[int, int, bytes]:
    """One page as RGB pixels at ``scale`` pixels per PDF point."""
    if _doc is None:
        raise RuntimeError("no document is open")
    if not 0 <= page < _doc.page_count:
        raise IndexError(f"there is no page {page + 1}")
    # Highlights are drawn by the page over the top, from the document worker's
    # copy, which is the one that changes; drawn in here too they would double up
    # and never go away when deleted.
    pixmap = _doc.load_page(page).get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False,
                                             annots=False)
    return pixmap.width, pixmap.height, pixmap.samples


def close() -> None:
    global _doc
    if _doc is not None:
        _doc.close()
        _doc = None
