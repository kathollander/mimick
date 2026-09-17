"""What the reader reads: the desktop's ``Document``, summarised for comparison.

The browser reader takes its sentences and word rectangles from the desktop
app's own ``document.py``, run unchanged under Pyodide as the package
``mimick``. This turns one opened document into plain data, so that
tools/check_reading.mjs can hold the browser's reading to the desktop's.

The baseline is made by running this against the desktop package itself, from
the desktop repo:

    .venv/bin/python ../mimick-web/reading.py ../mimick-web/sample/sample.pdf \
        > ../mimick-web/sample/expected-reading.json
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from mimick.document import Document, align_marks


def _rect(rect) -> list[float]:
    return [round(v, 2) for v in rect]


def summarise(document: Document) -> dict:
    sentences = []
    for sentence in document.sentences:
        text = sentence.text
        # Marks as the voice gives them: one per whitespace-split word of the
        # text, at made-up times. Where they land is what is being compared.
        marks = [(float(i), word) for i, word in enumerate(text.split())]
        sentences.append({
            "page": sentence.page,
            "text": text,
            "words": [[w.index, w.text, _rect(w.rect), w.spoken, w.joins_next]
                      for w in sentence.words],
            "aligned": [position for _, position in align_marks(sentence, marks)],
        })
    return {
        "pages": document.page_count,
        "words": len(document.words),
        "readable": sum(1 for w in document.words if w.readable),
        "sentences": sentences,
    }


def read(pdf_bytes: bytes, name: str = "document.pdf") -> dict:
    """Open ``pdf_bytes`` both ways the desktop can -- cleaned up for reading,
    and as extracted -- and summarise each."""
    folder = Path(tempfile.mkdtemp())
    path = folder / name
    path.write_bytes(pdf_bytes)
    out = {}
    for label, clean in (("clean", True), ("raw", False)):
        document = Document(path, clean_text=clean)
        try:
            out[label] = summarise(document)
        finally:
            document.close()
    path.unlink()
    folder.rmdir()
    return out


if __name__ == "__main__":
    json.dump(read(Path(sys.argv[1]).read_bytes()), sys.stdout, ensure_ascii=False,
              sort_keys=True, separators=(",", ":"))
