# Roadmap

What the browser version needs, in the order it should happen. Written 17
September 2026, after the code review of that day. `PARITY.md` is the list of
desktop features; this is the list of what a free read-aloud reader needs
whether or not the desktop app has it.

**The goal is to ship fast.** Kat's classmates include neurodivergent readers
who could use this for their readings now. Ship 1 is the smallest thing that
is safe to hand them; everything else waits. Do not start a Ship 2 item while
a Ship 1 item is open.

Work through each item, tick it here, and note in `HANDOFF.md` anything the
next session needs to know. Where an item says *your call*, decide, do it, and
write the reason down -- do not stop to ask.

## Ship 1 -- to classmates

**0. ✅ The review fixes** in `HANDOFF.md`, *To do first*. Broken sample path,
`voice.html`, the default voice, the personal-information sweep, the licence
table. Nothing below until these are done and every check passes.

**1. ✅ Find in document, `Ctrl`+`F`.** Done 17 September: `js/find.js`, `reader.find` / `found_on`, `tools/check_find.mjs`. Non-negotiable. A box in the top bar (or
a strip under it, as Chrome's own); typing highlights every match on the
page, `Enter` / `Shift`+`Enter` move between them, the page scrolls to the
current one, a count ("3 of 41"), `Esc` closes. Match case off by default.
The worker already holds every sentence's words and rectangles
(`reader.py`), so the search is over that text and the highlights reuse the
selection drawing in `js/reader.js`. Right-click a match → *Start reading
from here* should work, since a match is a place on the page.

**2. ✅ Works offline, installs as an app.** Done 17 September: `sw.js` (one worker, isolation headers and the cache), `js/offline.js`, `manifest.json`, `icons/`, `tools/stamp_offline.py`, `tools/check_offline.mjs`; see `HANDOFF.md`, *Offline*. Today nothing is cached:
`coi-serviceworker.js` only sets the isolation headers, and the 62 MB in
`vendor/` is fetched again whenever Chrome's cache lets go of it. Voice
models are already kept in IndexedDB. Needed: a service worker that
precaches `reader.html`, `js/`, `vendor/`, `voices/*.mp3` and `py/` on
first load, with a version stamp so an update replaces them all at once and
never mixes old and new scripts (trap 10); a `manifest.json` with a name and
icon so Chrome offers **Install**; and a line in the bottom bar or About
saying "Ready to work offline" once the cache is full. Keep the isolation
headers -- the two can be one worker or two, *your call*. Test by loading
once, stopping `serve.py`, reloading.

**3. ✅ Browser support, and a How to use.** Done 17 September, in `README.md` and About; Firefox and Safari still untried by hand. In `README.md` and in About: built
and tested on Chrome; Brave, Edge and other Chromium browsers work the same.
Firefox and Safari are untested -- `showSaveFilePicker` does not exist there
(the code already falls back to a download) and the page needs
`SharedArrayBuffer`, which needs the isolation headers; note what a user
would see. Then a **How to use** section, short: open a file, press Space,
change the voice and speed, click a sentence, highlight, notes, download a
copy, and that the first voice is a one-time 60 MB download. Screenshots are
fine if they show the sample PDF, not a real reading.

**4. ✅ Privacy, in About and the README.** Done 17 September. One paragraph: every document stays
on this computer; nothing is uploaded; the only network use is downloading a
voice from Hugging Face once, and the page itself. Notes and positions are
kept in this browser's storage and nowhere else. (Item 2 makes this stronger:
after first load, no network at all.)

**5. ✅ Plain text, `.txt`.** Done 17 September: `reader.text_to_pdf` (a PyMuPDF `Story`, line breaks kept), `openText` in `js/reader.js`, known by a hash of the text so notes come back; `tools/check_text.mjs`. Open it the same way as a PDF (button, `Ctrl`+`O`,
drop). Turn it into pages so the rest of the reader needs no change: PyMuPDF
can lay text out as a PDF in the worker (`fitz.Story` or
`Page.insert_htmlbox`), and then it *is* a PDF as far as `document.py` is
concerned, highlights and notes included. Same pipeline for item 8 later.

**6. ✅ A PDF with no text.** Done 17 September: the status line and Read aloud's tooltip say so; a PDF with words but nothing set to be read says how to choose (and the reading order now works on it); `tools/check_scan.mjs`. A scanned PDF without a text layer opens with zero
sentences and a greyed-out Read aloud, and says nothing. Detect it after open
and say "This PDF has no text to read -- it may be a scan without OCR."
OCR itself is Ship 3.

**7. ✅ Save, in File ▾.** Done 17 September: **Save a copy (PDF)…** and **Export notes…** (Markdown), in File ▾ and Notes ▾; PDF only for the document, reason in `PARITY.md`. Chrome's save window where it exists, a download elsewhere (`saveFile` in `js/notes.js`). Today `Ctrl`+`S` is *Download a copy*, a PDF with the
highlights and notes as annotations. Make File ▾ say what it does: **Save a
copy (PDF)**. Other output formats -- `.docx`, `.odt`, `.txt` -- are *your
call*, with this guidance: notes and highlights are PDF annotations tied to
rectangles on a page, and there is no faithful way to carry them into a
flowing document; a `.docx` "copy" of a PDF is also a poor copy of the
original. The likely right answer is PDF only for the document, plus
**Export notes** as Markdown or plain text (the passage, the note, the page)
for people who want their notes elsewhere. If you go another way, write the
reason in `PARITY.md`.

**8. ✅ Media keys.** Done 17 September: `mediaState` and `mediaKeys` in `js/reader.js`, `tools/check_media.mjs`. The Media Session API: play/pause/next/previous from a
keyboard's media keys and the browser's own media controls. About ten lines
in `js/reader.js` beside the existing key handling; the "next" and
"previous" actions are the existing ↶ ↷.

**9. ✅ Voice credits in About.** Done 17 September, from each voice's `MODEL_CARD` at the pinned revision., as the licences ask (CC BY, BY-SA, BY-NC-SA):
voice name, dataset, licence, link. `voices/README.md` is the source once
item 0 has fixed its table.

Then Kat makes the repository public and sends the link.

## Ship 2 -- the next month

- ✅ **Word, OpenDocument and EPUB, read-only.** Done 17 September, without
  `mammoth.js`: MuPDF 1.28 opens `.docx` and `.epub` itself (laid out on A4,
  then `convert_to_pdf`), and `.odt` is turned into HTML in `reader.py` and set
  with a `Story`. Headings become the contents panel. Lists lose their bullets
  in Word files and tables lose their borders. `tools/check_documents.mjs`.
  *The original plan, kept for the record:*
  **Word and OpenDocument, `.docx` and `.odt`, read-only.** Same path as
  `.txt`: convert to a PDF in the worker, then it is a PDF. `.docx` is a zip
  of XML; `mammoth.js` turns it into clean HTML, which `insert_htmlbox` can
  lay out; `.odt` is the same shape with different XML and no ready library.
  Images, tables and footnotes will be rough at first; say so in the README.
  Not editable, ever -- this is a reader.
- **Read aloud while a long document is still opening** (`HANDOFF.md`,
  *Next*, item 2). 45 s of a greyed-out button on a big book is the first
  thing a new user with a big file hits. Needs a change in the desktop's
  `document.py`, then a port.
- ✅ **The PDF's outline** (table of contents) in a side panel. Done 17 September,
  ahead of its turn because Kat asked for it: `js/contents.js`, `F9`, a tab on
  the page's left edge.
- ✅ **Open Recent** in File ▾. Done 17 September: `js/recent.js`, `tools/check_recent.mjs`.
- ✅ **Keep scroll and zoom per document**, and **Forget this document**. Done 17 September; `tools/check_forget.mjs`.
- **Export notes** as Markdown, if item 7 did not already do it.
- 🟡 **The page's own accessibility.** Done 17 September: light theme
  (follows the system; Display ▾ → Theme overrides), reduced motion, a name in
  words on every control (`tools/check_access.mjs`). Colour-blind check of the
  highlights: measured, not changed -- see `HANDOFF.md`. Still to do: a real
  keyboard-only and screen-reader pass with a classmate who uses them, and the
  panels' own keyboard navigation (arrow keys in the contents tree).
  *The plan:* A light theme following
  `prefers-color-scheme`; honour `prefers-reduced-motion`; visible focus
  rings and `aria-label`s on every control so the page can be driven by
  keyboard and screen reader; check the four highlight colours are
  distinguishable to colour-blind readers. Ask a classmate who uses these to
  try it.
- **A pronunciation list**, per user: a word and how to say it, applied
  before the phonemizer. Names and jargon are where voices stumble.

## Ship 3 -- later

- **OCR for scanned PDFs** in the browser (`tesseract.js`), producing a text
  layer the reader can use. Slow; run it page by page ahead of the reading.
- ✅ **EPUB** -- done with Word, above. *Was:* Reflowable; would need its own page maker, or the same
  convert-to-PDF path at a fixed page size.
- **Other languages.** Piper has many; the cleanup in `document.py` and the
  reading-time constant are English-tuned.
- **A sleep timer** and **skip back 10 seconds**.
- **Firefox and Safari** properly, if people ask.
