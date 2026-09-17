"""A short journal-style paper of our own, for the checks that need one.

The sample (sample/sample.pdf) is a poem: one column of plain text, nothing to
leave out. The reading cleanup, the reading order and the footnote switch only
show themselves on a page laid out like an article -- a running header and page
numbers, notes at the foot of the page, a reference list at the end -- so this
makes one, with a highlight and note already on page 2, as a file marked up in
another reader would have. Every word of it is written here, so it can ship with the source.

Run from the desktop repo, whose venv has PyMuPDF:

    .venv/bin/python ../mimick-web/tools/make_test_paper.py ../mimick-web/sample/test-paper.pdf
"""

from __future__ import annotations

import sys

import pymupdf

WIDTH, HEIGHT = 595.28, 841.89
LEFT, RIGHT = 72, WIDTH - 72
BODY_SIZE, NOTE_SIZE = 11, 8

HEADER = "Journal of Reading Aloud 2026, 4, 12"
TITLE = "Listening to the Page: How Students Use Text to Speech"

PAGES = [
    {
        "body": [
            TITLE,
            "Abstract: Many students listen to their course readings rather than reading them silently. "
            "This short paper describes how a small group of students used a text to speech reader over one term, "
            "what they chose to hear and what they skipped, and why the order in which a page is read matters "
            "as much as the voice that reads it (Rivera and Okafor, 2021).",
            "1. Introduction",
            "Reading a long article is tiring for anyone, and for some readers it is the hardest part of study. "
            "Hearing the text while following it on the page can make the work lighter. The words stay in front of "
            "the reader, and the voice keeps the pace steady when attention drifts [1]. A reader who loses the "
            "thread can look back at the line that is lit and find the place again.",
            "Students in our group said the voice mattered less than they expected. What mattered more was that "
            "the reader left out what they did not want to hear: page numbers, running headers, and the long "
            "list of references at the end of every paper.",
        ],
        "notes": ["1 The group met once a week and kept short diaries of what they read."],
    },
    {
        "body": [
            "2. What Students Chose to Hear",
            "Most students listened at a faster speed than normal speech, and raised it as the term went on. "
            "Several said a faster voice held their attention better, because there was less time for the mind "
            "to wander between sentences (Chen, 2019). Others slowed it down for dense passages and sped up again "
            "for summaries.",
            "Footnotes divided the group. Some wanted every note read, in case it held something important; "
            "others found that a note read in the middle of a paragraph broke the sense of the sentence around "
            "it. A switch to turn notes on or off suited both [2].",
            "Highlighting while listening was common. Students paused the voice, marked a passage, wrote a short "
            "note beside it, and carried on. Those notes became the start of their essay plans.",
        ],
        "notes": ["2 One student kept notes on for the first reading and off for the second."],
    },
    {
        "body": [
            "3. Discussion",
            "A reader that reads everything on the page in the order it was printed is hard to listen to. "
            "A page number read aloud in the middle of a sentence, or a journal title repeated at the top of "
            "every page, makes the text harder to follow than silence would. Leaving these out is not a luxury "
            "for a listener; it is what makes listening possible at all.",
            "4. Conclusions",
            "Text to speech helps students most when it reads what a person would read and passes over the rest. "
            "The reading order should be visible, and the listener should be able to change it when the reader "
            "gets it wrong.",
            "References",
            "1. Rivera, A.; Okafor, B. Listening and reading together. J. Study Skills 2021, 8, 101-115.",
            "2. Chen, L. Speed and attention in audio learning. Learn. Res. Q. 2019, 14, 22-37.",
            "3. Novak, P. Page furniture and the listener. Doc. Des. Rev. 2018, 3, 5-19.",
        ],
        "notes": [],
    },
]


def main(out: str) -> None:
    doc = pymupdf.open()
    doc.set_metadata({"title": TITLE, "author": "Mimick test", "creator": "tools/make_test_paper.py"})
    for number, spec in enumerate(PAGES):
        page = doc.new_page(width=WIDTH, height=HEIGHT)
        page.insert_text((LEFT, 40), HEADER, fontsize=8, fontname="helv")
        page.insert_text((RIGHT - 40, 40), f"{number + 1} of {len(PAGES)}", fontsize=8, fontname="helv")
        y = 90
        for paragraph in spec["body"]:
            heading = len(paragraph) < 70 and not paragraph[0].isdigit() or paragraph[:2] in ("1.", "2.", "3.", "4.") and len(paragraph) < 40
            size = 15 if paragraph == TITLE else BODY_SIZE
            font = "hebo" if heading else "helv"
            box = pymupdf.Rect(LEFT, y, RIGHT, HEIGHT - 150)
            spare = page.insert_textbox(box, paragraph, fontsize=size, fontname=font, lineheight=1.3)
            if spare < 0:
                raise SystemExit(f"page {number + 1} is too full")
            used = box.height - spare
            y += used + (8 if heading else 14)
        note_y = HEIGHT - 120
        for note in spec["notes"]:
            box = pymupdf.Rect(LEFT, note_y, RIGHT, note_y + 40)
            spare = page.insert_textbox(box, note, fontsize=NOTE_SIZE, fontname="helv")
            note_y += box.height - spare + 6
        if number == 1:
            # A highlight with a note, made elsewhere: the reader has to find it.
            quads = page.search_for("Highlighting while listening was common.", quads=True)
            annot = page.add_highlight_annot(quads)
            annot.set_info(content="Already in the file.", title="Another reader", subject="")
            annot.update()
    doc.save(out, garbage=3, deflate=True)


if __name__ == "__main__":
    main(sys.argv[1])
