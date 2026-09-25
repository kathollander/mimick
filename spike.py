"""The spike: does the desktop app's layout analysis run, unmodified, in a tab?

Nothing here is Mimick. It is the smallest harness that can put a real PDF
through ``layout.analyse`` and say whether what comes back is the same shape
the desktop app gets -- regions in reading order, labelled, with the two-column
pages read down rather than across.

If this reads sensibly the foundation is proven and the rest of the port is
interface work. If it does not, the browser version does not happen on these
terms.
"""

import layout


class DocumentShim:
    """What ``layout.analyse`` actually needs from a document.

    It asks for ``page_count`` and ``doc``, and nothing else -- so the whole of
    ``document.py`` can wait. Keeping the shim this small is the point: it says
    exactly how much surface the layout code touches.
    """

    def __init__(self, fitz_doc):
        self.doc = fitz_doc

    @property
    def page_count(self) -> int:
        return self.doc.page_count


def run(pdf_bytes: bytes) -> dict:
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        regions = layout.analyse(DocumentShim(doc))
        pages = []
        for number in sorted(regions):
            entries = []
            for region in regions[number]:
                text = " ".join((region.text or "").split())
                entries.append({
                    "kind": region.kind,
                    "label": region.label,
                    "reason": region.reason,
                    "reads": region.reads,
                    "rect": [round(v, 1) for v in region.rect],
                    "text": text[:110],
                    "chars": region.chars,
                })
            pages.append({"page": number + 1, "regions": entries})
        return {
            "ok": True,
            "page_count": doc.page_count,
            "pymupdf": pymupdf.__doc__.strip().splitlines()[0] if pymupdf.__doc__ else "",
            "pages": pages,
        }
    finally:
        doc.close()
