"""Open a text, Word, OpenDocument or EPUB file by laying it out as a PDF.

From then on each *is* a PDF, as far as the rest of Mimick is concerned: the
same reading, highlights, notes, Find, contents and Save a copy, with no other
part of the app needing to know where it came from. A ``.txt`` keeps its line
breaks as written, so a poem or a list reads as it looks, and a blank line
starts a paragraph. Word and EPUB are MuPDF's own doing -- it lays them out as
it would HTML -- while an ``.odt`` is turned into HTML here and set with a
``Story``. Headings become the contents panel's entries.

Images, footnotes and complicated tables come out rough. Lists lose their
bullets in Word files and tables lose their borders. This is a reader: none of
it is editable, and nothing is ever written back to the file you opened.

Shared with the browser version through tools/port.sh, so both lay a document
out the same way and a set of notes means the same thing in either.
"""

from __future__ import annotations

import hashlib
import html
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pymupdf

# What can be opened this way, and what to call one when something goes wrong.
CONVERTIBLE = {".txt": "a text file", ".docx": "a Word document",
               ".odt": "an OpenDocument text file", ".epub": "an EPUB book"}


def converted_pdf(path, cache_dir) -> Path:
    """``path`` laid out as a PDF, kept under ``cache_dir`` and made only once.

    Named for the file it came from and the content it had, so opening the same
    document again finds the same PDF -- which is what brings its highlights and
    notes back with it, since those hang off the PDF's own path. Edit the
    original and you get a new PDF and a clean sheet, the old notes staying with
    the version they were made on.
    """
    path = Path(path)
    kind = path.suffix.lower()
    if kind not in CONVERTIBLE:
        raise ValueError(f"Mimick cannot open {kind or 'that kind of'} files")
    data = path.read_bytes()
    stamp = hashlib.sha256(data).hexdigest()[:16]
    folder = Path(cache_dir) / "converted"
    folder.mkdir(parents=True, exist_ok=True)
    # The stem is kept readable so the folder can be understood by a person
    # looking into it, and the stamp makes it unique.
    out = folder / f"{path.stem[:60]}-{stamp}.pdf"
    if out.exists() and out.stat().st_size:
        return out
    title = path.stem
    if kind == ".txt":
        made = text_to_pdf(_read_text(data), title)
    else:
        made = document_to_pdf(data, kind.lstrip("."), title)
    # Written beside and moved into place, so a half-written PDF is never left
    # behind for the next open to find and trust.
    partial = out.with_suffix(".part")
    partial.write_bytes(made)
    partial.replace(out)
    return out


def _read_text(data: bytes) -> str:
    """A text file's characters, whatever it was saved as.

    UTF-8 first, since that is what a text file is now; then UTF-16, which is
    what Windows Notepad used to write and still labels with a byte-order mark;
    then Latin-1, which cannot fail and leaves the odd wrong character rather
    than refusing to open a reading at all.
    """
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return data.decode("latin-1", "replace")


def text_to_pdf(text: str, title: str) -> bytes:
    """``text`` set on A4 pages, one-inch margins, 11pt, titled ``title``."""
    paragraphs = [p for p in text.replace("\r\n", "\n").replace("\r", "\n").split("\n\n") if p.strip()]
    if not paragraphs:
        raise ValueError("the file has no text in it")
    body = "".join(f"<p>{html.escape(p.strip(chr(10)))}</p>" for p in paragraphs)
    css = ("body { font-family: sans-serif; font-size: 11pt; line-height: 1.45; } "
           "p { white-space: pre-wrap; margin: 0 0 9pt 0; }")
    return _story_pdf(body, css, title, "Mimick, from a text file")


def _story_pdf(body: str, css: str, title: str, creator: str) -> bytes:
    """HTML set on A4 pages with one-inch margins; its headings are the outline."""
    story = pymupdf.Story(html=body, user_css=css)
    out = io.BytesIO()
    writer = pymupdf.DocumentWriter(out)
    page = pymupdf.paper_rect("a4")
    where = page + (72, 72, -72, -72)
    toc = []
    def heading(position):
        if position.heading and position.open_close & 1 and position.text:
            toc.append([position.heading, " ".join(position.text.split()), number + 1, position.rect[1]])
    more, number = True, 0
    while more:
        device = writer.begin_page(page)
        more, _ = story.place(where)
        story.element_positions(heading)
        story.draw(device)
        writer.end_page()
        number += 1
    writer.close()
    with pymupdf.open(stream=out.getvalue(), filetype="pdf") as made:
        made.set_metadata({"title": title, "creator": creator})
        _set_toc(made, [[lvl, t, p, {"kind": pymupdf.LINK_GOTO, "page": p - 1, "to": pymupdf.Point(72, y)}] for lvl, t, p, y in toc])
        return made.tobytes(garbage=3, deflate=True)


def _set_toc(doc, toc: list) -> None:
    """Set an outline. A document may skip levels (a Heading 2 with no Heading 1
    before it); an outline may not, so a skipped level is closed up."""
    fixed, last = [], 0
    for entry in toc:
        level = max(1, min(entry[0], last + 1))
        fixed.append([level, *entry[1:]])
        last = level
    if fixed:
        doc.set_toc(fixed)


def _pointing(pdf, level: int, text: str, page: int) -> list:
    """An outline entry pointing at its heading on the page, found by its words, or
    at the top of the page when they cannot be found."""
    if not 0 < page <= pdf.page_count:
        return [level, text, -1]
    hits = pdf[page - 1].search_for(text[:60]) if text.strip() else []
    if not hits:
        return [level, text, page]
    return [level, text, page, {"kind": pymupdf.LINK_GOTO, "page": page - 1, "to": pymupdf.Point(hits[0].x0, hits[0].y0)}]


_ODT = {"text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
      "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
      "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0"}
_T = "{%s}" % _ODT["text"]
_TB = "{%s}" % _ODT["table"]


def _odt_html(data: bytes) -> tuple[str, str]:
    """An .odt's text as simple HTML -- headings, paragraphs, lists, tables --
    and its own title. Footnotes are left out, as the reading cleanup would."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read("content.xml"))
        try:
            meta = ET.fromstring(z.read("meta.xml"))
            name = (meta.findtext(".//{http://purl.org/dc/elements/1.1/}title") or "").strip()
        except (KeyError, ET.ParseError):
            name = ""
    body = root.find("office:body/office:text", _ODT)
    if body is None:
        raise ValueError("this is not an OpenDocument text file")
    def inline(el):
        out = [html.escape(el.text or "")]
        for child in el:
            tag = child.tag
            if tag == _T + "s":
                out.append(" " * int(child.get(_T + "c", "1")))
            elif tag == _T + "tab":
                out.append("\t")
            elif tag == _T + "line-break":
                out.append("<br>")
            elif tag == _T + "note":
                pass
            else:
                out.append(inline(child))
            out.append(html.escape(child.tail or ""))
        return "".join(out)
    def block(el):
        tag = el.tag
        if tag == _T + "h":
            level = min(6, max(1, int(el.get(_T + "outline-level", "1"))))
            return f"<h{level}>{inline(el)}</h{level}>"
        if tag == _T + "p":
            return f"<p>{inline(el)}</p>"
        if tag == _T + "list":
            items = []
            for item in el:
                if item.tag in (_T + "list-item", _T + "list-header"):
                    items.append("<li>" + "".join(block(c) for c in item) + "</li>")
            return "<ul>" + "".join(items) + "</ul>"
        if tag == _T + "section":
            return "".join(block(c) for c in el)
        if tag == _TB + "table":
            rows = []
            for row in el.iter(_TB + "table-row"):
                cells = "".join("<td>" + "".join(block(c) for c in cell) + "</td>" for cell in row.findall(_TB + "table-cell"))
                rows.append(f"<tr>{cells}</tr>")
            return "<table>" + "".join(rows) + "</table>"
        return ""
    return "".join(block(el) for el in body), name


_CSS = ("body { font-family: serif; font-size: 11pt; line-height: 1.45; } p { margin: 0 0 8pt 0; } "
       "h1 { font-size: 18pt; margin: 14pt 0 8pt 0; } h2 { font-size: 14pt; margin: 12pt 0 6pt 0; } "
       "h3, h4, h5, h6 { font-size: 12pt; margin: 10pt 0 5pt 0; } li p { margin: 0 0 3pt 0; } "
       "td { border: 0.5pt solid #999; padding: 3pt; vertical-align: top; }")

# What document_to_pdf takes: CONVERTIBLE without the plain text file, which
# text_to_pdf handles instead. Derived rather than written out a second time, so
# a type cannot be offered in the Open dialog and then refused down here.
KINDS = {suffix.lstrip("."): name for suffix, name in CONVERTIBLE.items()
         if suffix != ".txt"}


def document_to_pdf(data, kind: str, title: str) -> bytes:
    """A Word (``docx``), OpenDocument (``odt``) or EPUB (``epub``) file as A4
    PDF pages, titled by its own title or else ``title``, its headings (or the
    book's table of contents) as the outline."""
    data = data.to_bytes() if hasattr(data, "to_bytes") else bytes(data)
    if kind not in KINDS:
        raise ValueError(f"cannot open .{kind} files")
    creator = f"Mimick, from {KINDS[kind]}"
    if kind == "odt":
        try:
            body, name = _odt_html(data)
        except (zipfile.BadZipFile, KeyError, ET.ParseError):
            raise ValueError(f"this does not open as {KINDS[kind]}") from None
        if not re.sub(r"<[^>]+>", "", body).strip():
            raise ValueError("the file has no text in it")
        return _story_pdf(body, _CSS, name or title, creator)
    try:
        source = pymupdf.open(stream=data, filetype=kind)
    except Exception:
        raise ValueError(f"this does not open as {KINDS[kind]}") from None
    with source:
        if source.is_reflowable:
            source.apply_css("@page { margin: 72pt } body { margin: 0 }")
            source.layout(rect=pymupdf.paper_rect("a4"), fontsize=11)
        toc = source.get_toc(simple=True)
        pdf = pymupdf.open("pdf", source.convert_to_pdf())
        name = ((source.metadata or {}).get("title") or "").strip() or title
    with pdf:
        if not any(page.get_text().strip() for page in pdf):
            raise ValueError("the file has no text in it")
        pdf.set_metadata({"title": name, "creator": creator})
        _set_toc(pdf, [_pointing(pdf, level, text, page) for level, text, page in toc])
        return pdf.tobytes(garbage=3, deflate=True)


