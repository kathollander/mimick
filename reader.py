"""The browser reader's side of Python: one open document, and its sentences
handed to the page. Pages are drawn elsewhere, by ``pages.py``.

Glue, not reading logic. Everything about what a page says comes from the
desktop's ``document.py`` (the package ``mimick``); this only keeps the open
``Document`` between calls from js/document-worker.js and hands back plain
data. Runs in the document worker, never on the page's own thread.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from mimick.document import Document, _merge_rects, align_marks

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


def _open() -> Document:
    if _document is None:
        raise RuntimeError("no document is open")
    return _document


def _rect(rect) -> list[float]:
    return [round(v, 2) for v in rect]


def sentences(start: int = 0, count: int | None = None) -> list[dict]:
    """Sentences from ``start`` -- ``count`` of them, or all the rest -- as the
    page needs them to read and highlight. A long book has fifteen thousand,
    so the page asks for them a stretch at a time.

    ``words`` holds one ``[index, page, rect]`` per word of the sentence, in the
    sentence's own order, so a position ``align`` returns picks one out.
    ``lines`` is the sentence tint: its words' rectangles joined into one box a
    line, page by page, exactly as the desktop's ``PageView`` paints it. A
    sentence can carry on over a page, which is why both say which page.
    """
    out = []
    every = _open().sentences
    for sentence in every[start:len(every) if count is None else start + count]:
        pages = sorted({word.page for word in sentence.words})
        out.append({
            "page": sentence.page,
            "text": sentence.text,
            "words": [[word.index, word.page, _rect(word.rect)] for word in sentence.words],
            "lines": [[page, _rect(box)] for page in pages
                      for box in _merge_rects([w.rect for w in sentence.words if w.page == page])],
        })
    return out


def align(sentence: int, marks: list) -> list[list]:
    """The voice's ``[seconds, word]`` marks for one sentence, as
    ``[seconds, position]`` -- a position into that sentence's ``words``.
    The desktop's own ``align_marks``, so both highlight the same word."""
    target = _open().sentences[sentence]
    return [[when, position] for when, position in
            align_marks(target, [(float(when), str(word)) for when, word in marks])]


def first_sentence_on(page: int) -> int | None:
    """The first sentence that starts on ``page`` or after it, or None."""
    for index, sentence in enumerate(_open().sentences):
        if sentence.page >= page:
            return index
    return None


def sentence_at(page: int, x: float, y: float) -> int | None:
    """The sentence under a point on a page, in PDF points, or None."""
    return _open().sentence_at_point(page, x, y)


def close() -> None:
    global _document
    if _document is not None:
        _document.close()
        _document = None
