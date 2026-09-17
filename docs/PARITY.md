# Desktop features, and which the browser has

Every feature of the desktop app, from its menus, key list and handoff. ✅ done,
🟡 partly, ⬜ not yet, ✖ not coming (and why). Tick as they land.

## Opening and moving around

- ✅ Open a PDF: button, `Ctrl`+`O`, drag and drop
- ✅ Open `.txt`, `.docx`, `.odt`, `.epub` the same ways, laid out as PDFs — *the desktop has none*
- ✅ Open Recent (File ▾, the last five; Chromium only — other browsers give a page no file handles)
- ✅ Continuous scroll, page box, ‹ ›, `Page Up`/`Down`, `Ctrl`+`↑`/`↓`/`Home`/`End`
- ✅ Zoom: − +, slider, % box, `Ctrl`+`+`/`−`/`0`, `Ctrl`+wheel
- ✅ Keep scroll and zoom per document across a reload (`mimick-view:<key>`)
- ✅ **Contents panel** (the PDF's bookmarks) on the left: nested, click to go, right-click to read from there, the section on screen lit; `F9`, **Display ▾**, or the tab on the page's edge — *the desktop has none*, see **For the desktop**
- 🟡 Remember the reading position per document (sentence only)

## Reading aloud

- ✅ Read aloud / pause, `Space`, ↶ ↷, `←` `→` while reading
- ✅ **Media keys** and the browser's media controls: play/pause, next and previous sentence, stop — *check the desktop has them*
- ✅ Word and sentence lit, page follows
- ✅ Speed 0.75–4×, applied straight away (desktop goes to 5×)
- ✅ Click a sentence to read from it
- ✅ **Display → Click to read** on/off
- ✅ Right-click → *Start reading from here*
- ✅ Select text and press `Enter` (or right-click → *Read the selection*)
- ⬜ Read aloud while a long document is still opening
- ✅ Voice picker: the seven voices, with a sample of each; Norman by default
- ✅ **Choosing voices on purpose** (17 September): Norman comes with the app; the voice box lists it and the voices kept, and *Select a new voice…* opens a picker like the desktop's *Offline voices*, with samples, tick boxes to download several, Remove, and which voices can make MP3s. *For the desktop:* it has the dialog, but not the MP3 marking or the MP3 rule below
- ✅ **Convert to MP3 uses only voices with no licence question** (Norman, for now), with a note saying why — *the desktop's export offers every voice*
- ✖ Nicknames for voices — not wanted for now: seven voices need no renaming (17 September)
- ✖ Microsoft online voices, Kokoro — a web page cannot reach them

## Selecting and the text cursor

- ✅ Drag to select, double-click for a sentence, `Ctrl`+`A` for the page, `Esc` clears
- ✅ `Ctrl`+`C` copies the selection, broken words rejoined
- ✅ Text cursor that follows the voice and blinks when paused
- ✅ `←` `→` word, `↑` `↓` line, `Home`/`End` line ends, `Ctrl`+`←`/`→` sentence
- ✅ `Shift` with any of those selects

## Highlights and notes

- ✅ Highlight in four colours (`Ctrl`+`H`)
- ✅ Highlight and write a note (`Ctrl`+`M`), heading, colour, author name
- ✅ Notes panel beside the page (`Ctrl`+`B`), filters for highlights / notes, counts, lines to the highlights
- ✅ Highlight/Note strip that can be dragged to the panel, top, bottom or loose (`Ctrl`+`Shift`+`H`)
- ✅ Click a highlight to pick it out; × removes it; double-click edits
- ✅ Right-click a highlight or card: copy passage / note / both, read, edit, delete
- ✅ `Ctrl`+`C` on a picked-out highlight
- ✅ `Ctrl`+`J` / `Ctrl`+`K` next and previous note
- ✅ `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` undo and redo
- ✅ Note appearance: typeface, size, your name
- ✅ Saving: kept in the browser as you work, and **Save a copy (PDF)** (`Ctrl`+`S`, File ▾, Notes ▾) — the desktop's companion PDF; Chrome asks where, other browsers download it
- ✅ **Export notes** (File ▾): every highlight and note as Markdown — page, section, passage, heading, note. *The desktop has none.* **PDF only for the document itself** (17 September): highlights and notes are annotations on rectangles of a page, and a `.docx`, `.odt` or `.txt` copy has no faithful place to put them -- nor is a Word copy of a PDF a good copy of the PDF. People who want their notes elsewhere take the Markdown, which pastes into Word or Docs
- ✅ Menus: **Notes ▾**, **Reading ▾** and **Display ▾** in the top bar, standing in for the desktop's menu bar, and a strip of quick switches under ⌄

## What gets read

- ✅ **Show reading order** (`Ctrl`+`R`): regions drawn, click to include or skip, remembered per document; Reset
- ✅ **Skip citations** switch
- ✅ **Read footnotes** switch, greyed out where there are none
- ✅ **Clean up text for reading** switch

## Audio and the rest

- 🟡 Convert to MP3: document, page range or selection, with estimates and cancel. Not yet: opening the file's folder afterwards. Switching its cleanup away from Display reads the whole PDF a second time (the desktop's `ExportDialog._source`), which on a long book takes as long as opening it, and cannot be stopped part way; building only the pages asked for would fix it
- ✅ Keyboard shortcuts window (**Help ▾**, or `?`)
- ✅ About window, and a link to the source; **voice credits** (dataset, licence, link, and the voice each was trained on) — *check the desktop credits them too*
- ✅ **Forget this document** (File ▾): asks first, then closes it and removes its highlights, place, zoom, reading-order choices and drawn pages

## For the desktop

- ⬜ **Recognise text in a scan (OCR)**: Tesseract reads each page, and the words go in as invisible text. Browser: `js/ocr.js`, `reader.add_text_layer`. The desktop could use Tesseract natively through PyMuPDF (`get_textpage_ocr`)
- ⬜ **Sleep timer** (Display → Stop reading): minutes, end of page, end of section; pauses between sentences. Browser: `sleepDue` in `js/reader.js`
- ⬜ **How to say words** (a pronunciation list): a word as printed and a sound-alike, applied before the phonemizer, with the timings put back under the printed word so highlighting is unchanged. Browser: `js/pronounce.js`
- ⬜ **Light theme** following the system, and Display → Theme (Night, the default / Day / Match the system). Browser: the token sets at the top of `reader.html`
- ⬜ **Highlight colours for colour-blind readers**: simulated over white at the drawn opacity, Blue and Pink are close for protanopia (ΔE 6.8) and Green and Blue for tritanopia (6.4); every other pair is 12 or more. The four colours are `annotations.COLOURS`, shared, so change them in both or neither -- Kat's call

Features the browser has that the desktop app does not. Add them there too.

- ⬜ **Open Word, OpenDocument and EPUB files** (`.docx`, `.odt`, `.epub`): laid out as PDFs, then read as them. Browser: `document_to_pdf` in `reader.py`
- ⬜ **Open a plain text file** (`.txt`): laid out as a PDF, then read as one, notes and all. Browser: `text_to_pdf` in `reader.py`
- ⬜ **Contents panel** (`F9`): the PDF's own bookmarks on the left, nested, the section on screen lit, click to go and right-click to read from there; hidden by its ‹ and brought back by a tab on the page's edge (the notes panel got the same › and tab). Browser: `js/contents.js`, `pages.outline`, `reader.first_sentence_from`
- ⬜ **Export notes** as Markdown. Browser: `notesText` in `js/notes.js`
- ⬜ **Find in document** (`Ctrl`+`F`): every match lit, Enter / Shift+Enter / F3 between them, Match case, Esc leaves the match selected. Browser: `js/find.js`, and `find` / `found_on` in `reader.py`, which fold curly quotes, dashes and ligatures and rejoin words hyphenated across a line
- ⬜ **Reading time in the bottom bar**: how long the document takes at the speed chosen in the Speed box, changing whenever it changes; while reading, what is left. Browser: `showReadingTime` in `js/reader.js`, 15.1 characters a second from `export.py`
- ⬜ **Scanned pages drawn ahead and kept**, if slow pages bite on the desktop (a page of the 598-page scan takes 0.6s there). Browser: `drawAhead` in `js/reader.js`
- ⬜ **The loose Highlight/Add note strip kept inside the window** while dragged and when the window shrinks — check whether the desktop's floating markup bar can be lost the same way
