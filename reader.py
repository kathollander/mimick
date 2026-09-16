"""The browser reader's side of Python: one open document, and its pages drawn.

Glue, not reading logic. Everything about what a page says comes from the
desktop's ``document.py`` (the package ``mimick``); this only keeps the open
``Document`` between calls from js/document-worker.js and hands pages back as
pixels. Runs in the document worker, never on the page's own thread.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pymupdf

from mimick.document import Document

_document: Document | None = None
_folder = Path(tempfile.mkdtemp())


def open_document(pdf_bytes: bytes, name: str) -> dict:
    """Open a PDF, closing whatever was open, and describe it."""
    global _document
    close()
    # Document wants a path; Pyodide's file system gives it one. The name is
    # kept so the title falls back to it, as on the desktop.
    path = _folder / (Path(name).name or "document.pdf")
    path.write_bytes(pdf_bytes)
    try:
        _document = Document(path)
    finally:
        path.unlink(missing_ok=True)
    return {
        "title": _document.title,
        "pages": [list(_document.page_size(n)) for n in range(_document.page_count)],
        "sentences": len(_document.sentences),
        "words": len(_document.words),
    }


def render(page: int, scale: float) -> tuple[int, int, bytes]:
    """One page as RGB pixels at ``scale`` pixels per PDF point."""
    if _document is None:
        raise RuntimeError("no document is open")
    pixmap = _document.doc.load_page(page).get_pixmap(
        matrix=pymupdf.Matrix(scale, scale), alpha=False)
    return pixmap.width, pixmap.height, pixmap.samples


def close() -> None:
    global _document
    if _document is not None:
        _document.close()
        _document = None
