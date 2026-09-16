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
# The sentences made from a selection, read by the same path as the document's.
_selection: list = []
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


def _sentences(source: str) -> list:
    return _selection if source == "selection" else _open().sentences


def sentences(start: int = 0, count: int | None = None, source: str = "document") -> list[dict]:
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
    every = _sentences(source)
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


def align(sentence: int, marks: list, source: str = "document") -> list[list]:
    """The voice's ``[seconds, word]`` marks for one sentence, as
    ``[seconds, position]`` -- a position into that sentence's ``words``.
    The desktop's own ``align_marks``, so both highlight the same word."""
    target = _sentences(source)[sentence]
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


# -- selecting, and the text cursor -------------------------------------------
#
# The desktop's rules, from MainWindow and PageView. The cursor sits *in front
# of* a word, so one past the last word is a place too; ``trailing`` says a
# cursor at the start of a line means the end of the line before it.


def select_range(first: int, last: int) -> int:
    """Make the selection's sentences, for reading; how many there are."""
    global _selection
    _selection = _open().sentences_from_range(first, last)
    return len(_selection)


def selection_text(first: int, last: int) -> str:
    return _open().selection_text(first, last)


def selection_boxes(first: int, last: int) -> list[list]:
    """The selection tint: ``[page, rect]``, one box a line, as PageView paints it."""
    words = _open().words[max(0, first):last + 1]
    pages = sorted({w.page for w in words})
    return [[page, _rect(box)] for page in pages
            for box in _merge_rects([w.rect for w in words if w.page == page])]


def word_at(page: int, x: float, y: float, dragging: bool = False) -> int | None:
    """The word under a point. While dragging, a little looser, and the nearest
    word on the line when the point is between words."""
    document = _open()
    word = document.word_at_point(page, x, y, pad=4.0 if dragging else 1.5)
    if word is None and dragging:
        word = document.nearest_word_on_line(page, x, y)
    return None if word is None else word.index


def sentence_span(index: int) -> list[int] | None:
    """The first and last word of the sentence a word is in."""
    document = _open()
    if not 0 <= index < len(document.words) or document.words[index].sentence < 0:
        return None
    words = document.sentences[document.words[index].sentence].words
    return [words[0].index, words[-1].index]


def page_span(page: int) -> list[int] | None:
    """The first and last word on a page."""
    words = _open().page_words.get(page) or []
    return [words[0].index, words[-1].index] if words else None


def caret_step(caret: int, trailing: bool, step: str, direction: int) -> list:
    """Where a cursor lands: ``[caret, trailing]``. MainWindow._caret_step."""
    document = _open()
    last = len(document.words)
    if step == "word":
        return [max(0, min(caret + direction, last)), False]
    here = max(0, min(caret - 1 if trailing else caret, last - 1))
    if step == "line":
        return [document.word_on_next_line(here, direction), False]
    if step == "line end":
        first, final = document.line_ends(here)
        return [final + 1, True] if direction > 0 else [first, False]
    return [document.sentence_step(here, direction), False]


def caret_place(caret: int, trailing: bool) -> list | None:
    """Where the cursor is drawn: ``[page, x, top, bottom]``. PageView.caret_rect."""
    words = _open().words
    if not words or not 0 <= caret <= len(words):
        return None
    at_end = caret == len(words) or (trailing and caret > 0)
    word = words[caret - 1 if at_end else caret]
    x0, y0, x1, y1 = word.rect
    return [word.page, round(x1 if at_end else x0, 2), round(y0, 2), round(y1, 2)]


def close() -> None:
    global _document, _selection
    _selection = []
    if _document is not None:
        _document.close()
        _document = None
