"""The browser reader's side of Python: one open document, and its sentences
handed to the page. Pages are drawn elsewhere, by ``pages.py``.

Glue, not reading logic. Everything about what a page says comes from the
desktop's ``document.py`` (the package ``mimick``); this only keeps the open
``Document`` between calls from js/document-worker.js and hands back plain
data. Runs in the document worker, never on the page's own thread.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

import pymupdf

from mimick.annotations import AnnotationStore, _write_range
from mimick import layout
from mimick.convert import KINDS, document_to_pdf, text_to_pdf  # noqa: F401
from mimick.document import Document, _merge_rects, align_marks
from mimick.notes_export import notes_file
from mimick import themes

_document: Document | None = None
_store: AnnotationStore | None = None
# The sentences made from a selection, read by the same path as the document's.
_selection: list = []
# The reader's own reading-order corrections, by region key, as last handed over.
_choices: dict[str, bool] = {}
# The document read with the cleanup the other way, for a conversion that
# overrides Display; made when first asked for, dropped when the dialog closes.
_alternate: Document | None = None
_folder = Path(tempfile.mkdtemp())


def open_document(pdf_bytes: bytes, name: str, skip_citations: bool = True,
                  clean_text: bool = True, read_footnotes: bool = True) -> dict:
    """Open a PDF, closing whatever was open, and describe it. The switches are
    the desktop's Display menu, as the reader last left them."""
    global _document, _store
    close()
    # Document wants a path; Pyodide's file system gives it one. The name is
    # kept so the title falls back to it, as on the desktop.
    path = _folder / (Path(name).name or "document.pdf")
    path.write_bytes(pdf_bytes)
    try:
        _document = Document(path, skip_citations=bool(skip_citations), clean_text=bool(clean_text),
                             read_footnotes=bool(read_footnotes))
    finally:
        path.unlink(missing_ok=True)
    try:
        _store = AnnotationStore(_document)
    except Exception:
        # A document whose annotations cannot be read is still worth reading aloud.
        _store = None
    return {
        "title": _document.title,
        "pages": [list(_document.page_size(n)) for n in range(_document.page_count)],
        "sentences": len(_document.sentences),
        "words": len(_document.words),
        "has_footnotes": _document.has_footnotes,
        "textless": pages_without_text(),
    }


def set_reading(switch: str, on: bool, anchor: int = -1) -> dict:
    """Flip one of the reading switches and rebuild the sentences.

    Sentence numbers mean nothing across a rebuild, so the reader's place is
    held by a word -- ``anchor`` -- whose index does not change, and the answer
    says which sentence now reaches it (MainWindow._sentence_for_word). Word
    indices, and with them every highlight, stay where they were."""
    document = _open()
    setter = {"skip_citations": document.set_skip_citations, "clean_text": document.set_clean_text,
              "read_footnotes": document.set_read_footnotes}[switch]
    setter(bool(on))
    if switch == "clean_text" and _apply_choices(document):
        # The cleanup analyses the pages again, which forgets the reader's corrections.
        document.rebuild()
    return _rebuilt(document, anchor)


def _rebuilt(document: Document, anchor: int) -> dict:
    """What the page needs after a rebuild, and the sentence that reaches ``anchor``."""
    resume = 0
    if anchor >= 0:
        resume = next((s.index for s in document.sentences if s.words and s.words[-1].index >= anchor),
                      max(len(document.sentences) - 1, 0))
    return {"sentences": len(document.sentences), "words": len(document.words), "resume": resume}


# -- the reading order --------------------------------------------------------
#
# The desktop's plan overlay and MainWindow._apply_region_choices. A region is
# known to the page by its key, page and rectangle rounded -- Settings._region_key
# -- which survives reopening and the cleanup being switched. Word indices do not
# move when a region is read or skipped (desktop trap 9), so highlights stay put.


def _region_key(page: int, rect) -> str:
    return f"{page}:" + ":".join(str(int(round(value))) for value in rect)


def regions(page: int) -> list[dict]:
    """A page's regions in reading order: whether each is read, as the build
    decides it (footnotes by their switch), and the number it is read in."""
    document = _open()
    out, number = [], 0
    for region in document.regions.get(page) or []:
        reads = document._region_reads(region)
        number += reads
        out.append({"key": _region_key(page, region.rect), "rect": _rect(region.rect), "reads": reads,
                    "number": number if reads else None, "label": region.label, "reason": region.reason})
    return out


def region_counts() -> list[int]:
    """How many regions are read, and how many skipped, in the whole document."""
    document = _open()
    every = [document._region_reads(r) for rs in document.regions.values() for r in rs]
    return [sum(every), len(every) - sum(every)]


def _apply_choices(document: Document) -> int:
    """Put the corrections onto freshly analysed regions; how many changed."""
    changed = 0
    for page, found in document.regions.items():
        for region in found:
            want = _choices.get(_region_key(page, region.rect))
            if want is not None and want != document._region_reads(region):
                region.kind = layout.BODY if want else layout.SKIPPED
                region.reason = "you chose to read this" if want else "you chose to skip this"
                changed += 1
    return changed


def set_region_choices(choices: dict) -> dict:
    """The corrections kept from last time, put back just after opening."""
    global _choices
    document = _open()
    _choices = {str(key): bool(value) for key, value in choices.items()}
    changed = _apply_choices(document)
    if changed:
        document.rebuild()
    return {**_rebuilt(document, -1), "restored": changed}


def toggle_region(page: int, key: str, anchor: int = -1) -> dict | None:
    """Read a region that was skipped, or skip one that was read."""
    document = _open()
    region = next((r for r in document.regions.get(page) or [] if _region_key(page, r.rect) == key), None)
    if region is None:
        return None
    reads = not document._region_reads(region)
    document.set_region_reads(region, reads)
    _choices[key] = reads
    return {**_rebuilt(document, anchor), "reads": reads}


def reset_regions(anchor: int = -1) -> dict:
    """Forget the corrections and analyse the pages afresh, as a fresh open would."""
    document = _open()
    _choices.clear()
    document.regions = layout.analyse(document, skip_references=document.clean_text)
    document.rebuild()
    return _rebuilt(document, anchor)


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


def sentence_lengths() -> list[int]:
    """How many characters each sentence has, for how long reading it takes."""
    return [len(sentence.text) for sentence in _open().sentences]


def convert_texts(scope: str, first: int = 0, last: int = 0, clean_text: bool | None = None) -> list[str]:
    """What a conversion to MP3 speaks, sentence by sentence: the whole document,
    pages ``first`` to ``last`` (from 0), or the words ``first`` to ``last``.
    The desktop's ExportDialog.sentences, as text, which is all the voice needs.
    ``clean_text`` overrides Display's cleanup for this conversion alone."""
    document = _source(clean_text)
    if scope == "selection":
        return [s.text for s in document.sentences_from_range(first, last)]
    if scope == "pages":
        low, high = sorted((first, last))
        return [s.text for s in document.sentences if low <= s.page <= high]
    return [s.text for s in document.sentences]


def _source(clean_text: bool | None) -> Document:
    """The open document, or a second copy of it read with the cleanup the other
    way -- ExportDialog._source. Word indices are the same in both, so a
    selection still names the same passage."""
    global _alternate
    document = _open()
    if clean_text is None or bool(clean_text) == document.clean_text:
        return document
    if _alternate is not None and _alternate.clean_text != bool(clean_text):
        forget_alternate()           # a copy left from an earlier conversion, read the wrong way
    if _alternate is None:
        path = _folder / "alternate.pdf"
        path.write_bytes(document.doc.tobytes())
        try:
            _alternate = Document(path, skip_citations=document.skip_citations,
                                  clean_text=bool(clean_text), read_footnotes=document.read_footnotes)
        finally:
            path.unlink(missing_ok=True)
        if _apply_choices(_alternate):
            _alternate.rebuild()
    return _alternate


def forget_alternate() -> None:
    """Let go of the second copy, if there is one."""
    global _alternate
    if _alternate is not None:
        _alternate.close()
        _alternate = None


def first_sentence_on(page: int) -> int | None:
    """The first sentence that starts on ``page`` or after it, or None."""
    for index, sentence in enumerate(_open().sentences):
        if sentence.page >= page:
            return index
    return None


def first_sentence_from(page: int, y: float | None = None) -> int | None:
    """The first sentence that starts at ``y`` on ``page`` or below it, or on a
    later page, or None: where a table of contents entry points."""
    for index, sentence in enumerate(_open().sentences):
        first = sentence.words[0] if sentence.words else None
        at = first.page if first is not None else sentence.page
        if at > page or (at == page and (y is None or first is None or first.rect[3] > y)):
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


# -- plain text, Word, OpenDocument and EPUB -------------------------------------
#
# All of this is mimick/convert.py now, ported in with the rest of the shared
# code, so both versions lay a document out the same way and a set of notes
# means the same thing in either. text_to_pdf, document_to_pdf and KINDS are
# imported at the top of this file and stay callable as reader.<name>, which is
# how js/reader.js asks for them.


# -- recognised text, for scans ---------------------------------------------------
#
# A scanned PDF has pictures of pages and no words. js/ocr.js reads the words off
# each page with Tesseract; this writes them back into the PDF as invisible
# text, each word stretched over the box it was found in, so the rest of the
# reader -- reading, highlights, Find, Save a copy -- sees an ordinary PDF, and
# other PDF readers can search the saved copy too.


def pages_without_text() -> list[int]:
    """Pages that are a picture and no words: scanned, and worth recognising."""
    document = _open()
    return [number for number in range(document.page_count)
            if not document.page_words.get(number) and document.doc[number].get_images()]


def add_text_layer(found: list) -> bytes:
    """``found`` is ``[[page, [[text, x0, y0, x1, y1], ...]], ...]`` in PDF points,
    a line's words sharing its top and bottom. Answers the PDF with the words in."""
    doc = _open().doc
    font = pymupdf.Font("helv")
    height_per_size = font.ascender - font.descender
    for number, words in found:
        page = doc.load_page(int(number))
        derotate = page.derotation_matrix
        for text, x0, y0, x1, y1 in words:
            text = str(text).strip()
            if not text or x1 <= x0 or y1 <= y0:
                continue
            size = (y1 - y0) / height_per_size
            width = font.text_length(text, size)
            if size <= 0 or width <= 0:
                continue
            start = pymupdf.Point(x0, y1 + font.descender * size) * derotate
            page.insert_text(start, text, fontsize=size, fontname="helv", render_mode=3,
                             rotate=page.rotation,
                             morph=(start, pymupdf.Matrix((x1 - x0) / width, 1)))
    return doc.tobytes(garbage=3, deflate=True)


# -- finding text --------------------------------------------------------------
#
# Ctrl+F. The searching itself is ``Document.find`` in the desktop's
# ``document.py``, so both versions look for a word the same way; this holds the
# last search's matches for ``found_on`` to draw. A match is a run of whole
# words -- ``[first, last, page]`` -- so it is lit, selected and read like a
# selection.
#
# This file had its own copy of the index until 18 September, written before the
# desktop had one at all. The two then disagreed about a word broken across a
# line -- the desktop learnt to keep a hyphen the word owns, and this did not --
# which meant a phrase could be read one way and searched for another. One copy,
# in the file both apps share, is the only arrangement that cannot drift.

_found: list[list[int]] = []


def find(query: str, match_case: bool = False) -> dict:
    """Every place ``query`` is written: ``[first word, last word, page]``, in
    document order. Spaces in the query match any spacing."""
    global _found
    matches, more = _open().find(query, bool(match_case))
    _found = [list(match) for match in matches]
    return {"matches": _found, "more": more}


def found_on(page: int) -> list[list]:
    """The last search's matches drawn on ``page``: ``[match number, [rects]]``."""
    words = _open().words
    out = []
    for number, (first, last, starts_on) in enumerate(_found):
        # Words run page by page, so matches do too.
        if starts_on > page:
            break
        if words[last].page < page:
            continue
        chosen = [w.rect for w in words[first:last + 1] if w.page == page]
        if chosen:
            out.append([number, [_rect(box) for box in _merge_rects(chosen)]])
    return out


# -- highlights and notes ---------------------------------------------------
#
# The desktop's AnnotationStore, on the open document. Every change answers
# with the whole list, in the store's order (page, then down the page), so the
# page never has to keep its own copy in step. An annotation is known to the
# page by its PDF object number, ``xref``.
#
# What the browser keeps between visits is ``snapshot``: every highlight as
# plain data, a few hundred bytes each. Writing the whole PDF after every change
# would mean a hundred megabytes a time for a scanned book, so the PDF is only
# made when it is downloaded.


def _live() -> AnnotationStore:
    if _store is None:
        raise RuntimeError("this document's highlights cannot be read")
    return _store


def _item(xref: int):
    for item in _live().items:
        if item.xref == xref:
            return item
    return None


def _author_of(item) -> str:
    page = _open().doc.load_page(item.page)
    for annot in page.annots():
        if annot.xref == item.xref:
            return (annot.info or {}).get("title") or ""
    return ""


def annotations() -> list[dict]:
    """Every highlight, in order down the document."""
    if _store is None:
        return []
    return [{
        "xref": item.xref, "page": item.page, "rects": [_rect(r) for r in item.rects],
        "text": item.text, "title": item.title, "note": item.note,
        "colour": [round(c, 3) for c in item.colour],
        "first": item.first_word, "last": item.last_word, "top": round(item.top, 2),
    } for item in _store.items]


def annotation_add(first: int, last: int, colour: list, note: str = "", title: str = "",
                   author: str = "") -> dict:
    """Highlight words ``first`` to ``last``: the new one's xref, and the list."""
    item = _live().add(first, last, tuple(colour), note=note, title=title, author=author)
    return {"xref": item.xref if item else None, "annotations": annotations()}


def annotation_set(xref: int, note: str, title: str, colour: list) -> list[dict]:
    """Change a highlight's note, heading and colour."""
    item = _item(xref)
    if item is not None:
        _live().set_note(item, note, title)
        if any(abs(a - b) >= 0.02 for a, b in zip(item.colour, colour)):
            _live().set_colour(item, tuple(colour))
    return annotations()


def annotation_remove(xref: int) -> list[dict]:
    item = _item(xref)
    if item is not None:
        _live().remove(item)
    return annotations()


def snapshot() -> list[dict]:
    """Every highlight as plain data, to be kept by the browser."""
    return [{**entry, "author": _author_of(_item(entry["xref"]))} for entry in annotations()]


def restore(saved: list) -> list[dict]:
    """Put back the highlights kept by ``snapshot``, in place of the file's own.

    The snapshot was taken of this same document, file highlights and all, so
    it replaces them rather than adding to them. Rectangles are put back as
    they were saved rather than worked out again from the word indices, so a
    highlight stays where it was drawn even if the reading code changes."""
    store = _live()
    doc = _open().doc
    for number in range(doc.page_count):
        page = doc.load_page(number)
        for annot in list(page.annots(types=(pymupdf.PDF_ANNOT_HIGHLIGHT,))):
            page.delete_annot(annot)
    for entry in saved:
        page = doc.load_page(int(entry["page"]))
        annot = page.add_highlight_annot(quads=[pymupdf.Rect(*r).quad for r in entry["rects"]])
        annot.set_colors(stroke=tuple(entry["colour"]))
        annot.set_info(content=entry.get("note") or "", title=entry.get("author") or store.author,
                       subject=entry.get("title") or "")
        annot.update()
        if int(entry.get("first", -1)) >= 0:
            _write_range(_open(), annot.xref, int(entry["first"]), int(entry["last"]))
    store.reload()
    store.dirty = False
    return annotations()


def notes_document(kind: str, title: str, name: str, sections: list, order: list | None = None) -> bytes:
    """Every highlight and note as a notes document of their own -- ``kind`` is
    docx, odt, pdf or md -- written by the desktop's own notes_export, so the
    two apps give the same file. ``sections`` holds the contents-panel section
    of each highlight, in the order ``annotations`` lists them: the page knows
    the outline, and Python does not. ``order``, if given, is the reader's own
    order of them, as positions in that same list (All notes, dragged)."""
    items = list(_store.items) if _store is not None else []
    under = {id(item): section for item, section in zip(items, list(sections or []))}
    order = [int(i) for i in (order or []) if 0 <= int(i) < len(items)]
    if len(order) == len(items) and len(set(order)) == len(items):
        items = [items[i] for i in order]
    return notes_file(kind, title, name, items, lambda item: under.get(id(item)) or None)


def repeats() -> dict:
    """Reading ▾ → What repeats: the phrases and words the document keeps
    using, from the desktop's themes.py, each with ``where`` -- its pages as a
    reader writes them."""
    found = themes.repeats(_open().sentences)
    for entries in found.values():
        for entry in entries:
            entry["where"] = themes.page_ranges(entry["pages"])
    return found


def notes_pdf() -> bytes:
    """The document with its highlights, as a PDF of its own, checked that it
    opens again with the same pages and highlights -- AnnotationStore.save_as,
    without a file to write to."""
    doc = _open().doc
    data = doc.tobytes(garbage=3, deflate=True)
    count = lambda d: sum(len(list(d.load_page(n).annots(types=(pymupdf.PDF_ANNOT_HIGHLIGHT,))))
                          for n in range(d.page_count))
    with pymupdf.open(stream=data, filetype="pdf") as written:
        if written.page_count != doc.page_count or count(written) != count(doc):
            raise OSError("the PDF just made did not come back with every page and highlight")
    return data


def set_author(name: str) -> None:
    """The name saved with each new highlight, which other PDF readers show."""
    _live().author = name or "Mimick"


def close() -> None:
    global _document, _selection, _store, _found
    forget_alternate()
    _selection = []
    _found = []
    # The search index is the document's own now, and goes with it.
    _choices.clear()
    _store = None
    if _document is not None:
        _document.close()
        _document = None
