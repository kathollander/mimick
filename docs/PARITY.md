# Desktop features, and which the browser has

Every feature of the desktop app, from its menus, key list and handoff. ✅ done,
🟡 partly, ⬜ not yet, ✖ not coming (and why). Tick as they land.

## Opening and moving around

- ✅ Open a PDF: button, `Ctrl`+`O`, drag and drop
- ✅ Open `.txt`, `.docx`, `.odt`, `.epub` the same ways, laid out as PDFs — *the desktop has these too since 18 September*
- ✅ Open `.md`, `.html`/`.htm`/`.xhtml`, `.rtf`, `.fb2`, and `.pptx`/`.ppsx`/`.odp` a page per slide — 21 September, `ffc4db5`. **This app is ahead here**: the shared `convert.py` has all of it, but the desktop's Open dialog, drag and drop and off-thread conversion are not wired yet, and `.ppt` will be desktop-only when they are, since only LibreOffice can read it. See `../Mimick-linux/docs/MORE-FILE-KINDS.md`
- ✅ **A bar while a file is laid out**, counting a deck's slides — 21 September, `5e927d9`. *The desktop has only a wait cursor, and converts on the UI thread.* The shared `slides.py` already takes the `progress(done, total)` callback that drives it (desktop `8c94f1b`), so the desktop's off-thread work can use it as it stands
- ✅ Open Recent (File ▾, the last five; Chromium only — other browsers give a page no file handles)
- ✅ Continuous scroll, page box, ‹ ›, `Page Up`/`Down`, `Ctrl`+`↑`/`↓`/`Home`/`End`
- ✅ Zoom: − +, slider, % box, `Ctrl`+`+`/`−`/`0`, `Ctrl`+wheel
- ✅ Keep scroll and zoom per document across a reload (`mimick-view:<key>`)
- ✅ **Contents panel** (the PDF's bookmarks) on the left: nested, click to go, right-click to read from there, the section on screen lit; `F9`, **Display ▾**, or the tab on the page's edge — *the desktop has one too since 18 September*
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
- ✅ **Export notes** (File ▾): every highlight and note as a notes document of its own — **Word, OpenDocument, PDF or Markdown** (24 September) — each passage quoted with its page, the note under it as points, a quoted list one bullet a line. Written by the shared `notes_export.py`, so both apps give the same file. **PDF only for the document itself** (17 September): highlights and notes are annotations on rectangles of a page, and a `.docx`, `.odt` or `.txt` copy has no faithful place to put them -- nor is a Word copy of a PDF a good copy of the PDF. People who want their notes elsewhere take the Markdown, which pastes into Word or Docs
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

- ✅ **Recognise text in a scan (OCR)**: Tesseract reads each page, and the words go in as invisible text. Browser: `js/ocr.js`, `reader.add_text_layer`. Desktop (25 September): `mimick/ocr.py`, MuPDF's built-in Tesseract, needing `tesseract-ocr-eng`
- ⬜ **Sleep timer** (Display → Stop reading): minutes, end of page, end of section; pauses between sentences. Browser: `sleepDue` in `js/reader.js`
- ⬜ **How to say words** (a pronunciation list): a word as printed and a sound-alike, applied before the phonemizer, with the timings put back under the printed word so highlighting is unchanged. Browser: `js/pronounce.js`
- ⬜ **Light theme** following the system, and Display → Theme (Night, the default / Day / Match the system). Browser: the token sets at the top of `reader.html`
- ⬜ **Highlight colours for colour-blind readers**: simulated over white at the drawn opacity, Blue and Pink are close for protanopia (ΔE 6.8) and Green and Blue for tritanopia (6.4); every other pair is 12 or more. The four colours are `annotations.COLOURS`, shared, so change them in both or neither -- Kat's call

Features the browser has that the desktop app does not. Add them there too.

The three that changed what the desktop app can do are done, all on 18
September, and each left the browser better for it: two of them turned up bugs
in *this* version that its own checks had been passing over. The hyphen fix in
`ed8c125` is the third -- both apps said "nonstatus" for "non-status" until the
desktop found it.

- ✅ **Open Word, OpenDocument and EPUB files** (`.docx`, `.odt`, `.epub`) — done on the desktop 18 September. The conversion moved out of `reader.py` into the shared `convert.py`, so there is one copy and both lay a document out identically
- ✅ **Open a plain text file** (`.txt`) — done on the desktop 18 September, with the above. The desktop also gained drag and drop, which it had never had for any file type
- ✅ **Contents panel** (`F9`) — done on the desktop 18 September. Building it found that **this version was sending people to the wrong section**: a bookmark's destination point is measured from the bottom of the page, `pages.outline` read it as from the top, and `sample/test-paper.pdf` happens to store it from the top so nothing caught it. On a real journal PDF six of twelve entries were wrong. Fixed in `7acfab8`; `tools/check_outline.py` is the guard
- ✅ **Export notes** — done on the desktop 19 September as Markdown; since 24 September both write Word, OpenDocument, PDF or Markdown from the shared `notes_export.py`
- ✅ **Reading → What repeats** — both, 24 September, from the shared `themes.py`
- ✅ **A progress bar while a deck is laid out** — the desktop's is a `QProgressDialog` off the UI thread (24 September); a PDF itself still opens without one
- ⬜ **All notes, in an order of your own** (dragged; Export notes follows it). Browser: `ordered()` and `draggable()` in `js/notes.js`, 24 September
- ⬜ **A reminder to save to a file every 15 minutes**, which can be turned off. Browser: `remindIfDue` in `js/notes.js`
- ⬜ **Click to read off by default**, and the note editor moved by dragging (the desktop's note dialog is a window of its own, so it moves already -- check whether it remembers where)
- ✅ **Auto-OCR as a scan opens** -- both, 20 pages at once, more asks (desktop 25 September)
- ✅ **Find in document** (`Ctrl`+`F`) — done on the desktop 18 September. The search moved into the shared `document.py` as `Document.find`, and this version's `reader.py` now calls it instead of keeping a second copy that had already drifted
- ⬜ **Reading time in the bottom bar**: how long the document takes at the speed chosen in the Speed box, changing whenever it changes; while reading, what is left. Browser: `showReadingTime` in `js/reader.js`, 15.1 characters a second from `export.py`
- ⬜ **Scanned pages drawn ahead and kept**, if slow pages bite on the desktop (a page of the 598-page scan takes 0.6s there). Browser: `drawAhead` in `js/reader.js`
- ⬜ **The loose Highlight/Add note strip kept inside the window** while dragged and when the window shrinks — check whether the desktop's floating markup bar can be lost the same way

These landed in the browser after this list was last gone through (17 September,
10:08), so they were never checked against the desktop until 18 September. All
four are missing there.

- ⬜ **A guided tour**: **Show me around** on the front page and **Help ▾ → Take the tour**; sixteen steps on the sample poem (since 24 September each waits for Next once done, and Click to read is turned on and off within it), each finished by the reader doing it with the app's own keys and clicks, with Skip and a way out at every step. Browser: `js/tour.js`
- ⬜ **Reading ▾ → Read from this page**, and **Back 10 seconds**. Browser: `04dd461`
- ⬜ **`Ctrl`+`Y` as a second redo**, beside `Ctrl`+`Shift`+`Z`
- ⬜ **A progress bar while a document opens**, so a long book does not look hung. The desktop's only progress bar is the voice downloader's, and it is a busy stripe (`voices_dialog.py:215`, "since size is not reported")

The three items above that said *check the desktop* have now been checked, all
on 18 September, and the answer was no to each:

- **Media keys**: none — no MPRIS anywhere in `mimick/`
- **Voice credits**: `about_dialog.py` carries the AGPL blurb only, nothing per voice
- **MP3 in licence-clean voices only**: `export_dialog.py:72-77` still offers every voice. Half done — the desktop's uncommitted `piper.py` withholds Lessac from the catalogue, but nothing restricts the export list
