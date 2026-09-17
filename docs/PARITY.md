# Desktop features, and which the browser has

Every feature of the desktop app, from its menus, key list and handoff. ✅ done,
🟡 partly, ⬜ not yet, ✖ not coming (and why). Tick as they land.

## Opening and moving around

- ✅ Open a PDF: button, `Ctrl`+`O`, drag and drop
- ⬜ Open Recent
- ✅ Continuous scroll, page box, ‹ ›, `Page Up`/`Down`, `Ctrl`+`↑`/`↓`/`Home`/`End`
- ✅ Zoom: − +, slider, % box, `Ctrl`+`+`/`−`/`0`, `Ctrl`+wheel
- ⬜ Keep scroll and zoom per document across a reload
- 🟡 Remember the reading position per document (sentence only)

## Reading aloud

- ✅ Read aloud / pause, `Space`, ↶ ↷, `←` `→` while reading
- ✅ Word and sentence lit, page follows
- ✅ Speed 0.75–4×, applied straight away (desktop goes to 5×)
- ✅ Click a sentence to read from it
- ✅ **Display → Click to read** on/off
- ✅ Right-click → *Start reading from here*
- ✅ Select text and press `Enter` (or right-click → *Read the selection*)
- ⬜ Read aloud while a long document is still opening
- ✅ Voice picker: the seven voices, with a sample of each; Norman by default
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
- ✅ Saving: kept in the browser as you work, and **Download a copy** (`Ctrl`+`S`) — the desktop's companion PDF
- ✅ Menus: **Notes ▾** and **Display ▾** in the top bar, standing in for the desktop's menu bar

## What gets read

- ✅ **Show reading order** (`Ctrl`+`R`): regions drawn, click to include or skip, remembered per document; Reset
- ✅ **Skip citations** switch
- ✅ **Read footnotes** switch, greyed out where there are none
- ✅ **Clean up text for reading** switch

## Audio and the rest

- 🟡 Convert to MP3: document, page range or selection, with estimates and cancel. Not yet: opening the file's folder afterwards. Switching its cleanup away from Display reads the whole PDF a second time (the desktop's `ExportDialog._source`), which on a long book takes as long as opening it, and cannot be stopped part way; building only the pages asked for would fix it
- ✅ Keyboard shortcuts window (**Help ▾**, or `?`)
- ✅ About window, and a link to the source
- ⬜ Forget this document (clear what the browser keeps)

## For the desktop

Features the browser has that the desktop app does not. Add them there too.

- ⬜ **Reading time in the bottom bar**: how long the document takes at the speed chosen in the Speed box, changing whenever it changes; while reading, what is left. Browser: `showReadingTime` in `js/reader.js`, 15.1 characters a second from `export.py`
- ⬜ **Scanned pages drawn ahead and kept**, if slow pages bite on the desktop (a page of the 598-page scan takes 0.6s there). Browser: `drawAhead` in `js/reader.js`
- ⬜ **The loose Highlight/Add note strip kept inside the window** while dragged and when the window shrinks — check whether the desktop's floating markup bar can be lost the same way
