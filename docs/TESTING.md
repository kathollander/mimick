# Testing checklist

Things only a person can judge. The check tools in `tools/` cover the rest; run
them first (see `HANDOFF.md`).

Start the page server from this folder, then open the links below in Chrome:

```bash
python3 serve.py
```

Tick what works, and write down anything that doesn't -- what you did, what you
expected, what happened.

## The reader — http://localhost:8731/reader.html

**Checked by Kat on 16 September**, all working. What came of it: the sample
button is gone; Page Up and Page Down no longer move the zoom slider after it
has been dragged; a 598-page scanned book took 258s to open, and now takes 35s
(`HANDOFF.md`, **Next**). The 212-page curriculum opens in about 11s.

**Opening**
- [x] The page says "Getting ready…", then "Ready" within about 10 seconds
- [x] **Open…** opens a PDF of your own
- [x] `Ctrl`+`O` does the same
- [x] Dragging a PDF onto the page opens it (the page gets a blue outline while you drag)
- [x] Dropping something that isn't a PDF says so, and doesn't break anything
- [x] Opening a second PDF replaces the first cleanly
- [x] A two-column paper and a long one (50+ pages) both open

**Moving around**
- [x] Scrolling is smooth, and pages fill in quickly as they come into view
- [x] The page number at the bottom keeps up as you scroll
- [x] ‹ and › turn one page; they grey out on the first and last page
- [x] Typing a page number and pressing Enter jumps there
- [x] `Page Up` / `Page Down` turn pages
- [x] `Ctrl`+`↑` / `↓` turn pages; `Ctrl`+`Home` / `End` go to the first and last

**Zoom**
- [x] − and + zoom out and in; the slider and the % box follow
- [x] Dragging the slider zooms
- [x] Typing a % and pressing Enter zooms to it
- [x] `Ctrl`+`+`, `Ctrl`+`−`, `Ctrl`+`0` zoom the page, not the whole browser
- [x] `Ctrl`+scroll wheel (or pinch on a trackpad) zooms the page, not the browser
- [x] You stay at the same spot in the document after zooming
- [x] Text is sharp at every zoom once the page has redrawn (a moment of blur is expected)
- [x] Zoomed in past the window width, you can scroll sideways

**Overall**
- [x] It looks and feels like the desktop app
- [x] Resizing the window keeps your place
- [x] Nothing is missing that you'd want before reading aloud goes on top

## Open Recent

Added 17 September. Chrome, Edge or Brave only.

- [ ] **File ▾ → Open…** (and `Ctrl`+`O`) opens the system's own open window, showing PDFs and documents
- [ ] After opening two files, **File ▾** lists both under *Open recent*, newest first
- [ ] Close the browser, open it again: choosing a recent file asks permission once, then opens it
- [ ] A file dropped on the page appears in the list too
- [ ] Rename or move a listed file: choosing it says it cannot be found, and it leaves the list
- [ ] **Clear recent files** empties it; **Forget this document** takes that one out

## Keeping your place, and Forget this document

Added 17 September.

- [ ] Scroll a long PDF to the middle and zoom in; reload the tab and open it again: same page, same zoom
- [ ] A different PDF still opens at its own place
- [ ] **File ▾ → Forget this document…** says what it will remove, and warns to save a copy first if there are notes
- [ ] Cancel changes nothing; **Forget it** closes the document and says so
- [ ] Opened again, it starts at the top with none of your highlights, and Read aloud starts from the beginning

## Word, OpenDocument and EPUB

Added 17 September. Try real ones: a reading in Word, something saved from
LibreOffice or Google Docs as `.odt`, and an EPUB without DRM.

- [ ] A `.docx`, `.odt` and `.epub` each open (File ▾, `Ctrl`+`O`, and dropped), laid out as pages
- [ ] Headings show in the contents panel and go to the right place
- [ ] Reading aloud, highlights and notes work, and come back when the file is opened again
- [ ] Anything badly wrong: missing text, pictures, footnotes, tables -- note the file type and what happened
- [ ] A long EPUB (a whole book) opens in reasonable time

## Voice credits

- [ ] **Help ▾ → About Mimick** has a *Voices* table; every link opens the right dataset or licence

## Media keys

Added 17 September. Needs a keyboard with media keys, or a headset with buttons.

- [ ] Play/pause on the keyboard starts reading a document you have open, and pauses it
- [ ] Next and previous skip a sentence
- [ ] They still work with another tab in front, and with the browser minimised
- [ ] Chrome's media button (top right of the toolbar) shows the document's title and "Mimick · voice", and its controls work
- [ ] A Bluetooth headset's play/pause button works
- [ ] Nothing audible comes from the silent audio Mimick plays to get the keys

## Save a copy, and Export notes

Added 17 September.

- [ ] `Ctrl`+`S` opens Chrome's save window, named "… (notes).pdf"; saved, the PDF opens elsewhere with the highlights and notes in it
- [ ] Closing the save window does nothing and says nothing wrong
- [ ] **File ▾ → Save a copy (PDF)…** and **Notes ▾ → Save a copy with your notes (PDF)…** do the same
- [ ] **File ▾ → Export notes…** saves "… (notes).md"; opened in a text editor it reads well: title, each note under its page (and section, if the PDF has bookmarks), the passage quoted, your heading and note
- [ ] Pasted into Google Docs or Word it is still readable

## A PDF with no text

Added 17 September.

- [ ] A scanned PDF with no text layer opens, shows its pages, and the bottom bar says it has no text to read and may be a scan
- [ ] Hovering the greyed **Read aloud** says the same
- [ ] In **Show reading order**, skipping every region says "Nothing here is set to be read"; clicking one back makes Read aloud work again

## Contents panel, and the panel tabs

Added 17 September. Use a PDF with bookmarks -- a textbook or a thesis; most
exported from Word have them -- and one without (the poem, `sample/sample.pdf`).

- [ ] Opening a PDF with bookmarks shows them on the left, straight away, before "sentences to read" appears
- [ ] Nested entries are indented; ▾ / ▸ open and close a level
- [ ] Clicking an entry goes to its heading, near the top of the view, and lights it
- [ ] Scrolling lights the section you are in, and a long list follows along
- [ ] Right-click an entry → **Start reading from here** reads from that heading
- [ ] The **‹** hides the panel and the page widens; the **Contents** tab on the left edge brings it back
- [ ] `F9` and **Display ▾ → Contents panel** do the same; hidden stays hidden after a reload
- [ ] The notes panel's **›** hides it; the **Notes** tab on the right edge brings it back
- [ ] A PDF without bookmarks shows no panel, and the tab is greyed with a tooltip saying why
- [ ] With both panels hidden the page sits in the middle and nothing overlaps the tabs
- [ ] On a narrow window (about 1000px) both panels together still leave room to read

## How long it takes to read

Added 17 September.

- [ ] Open a PDF: the bottom-left corner says how long it takes to read at the speed in the **Speed** box, and only that
- [ ] Changing **Speed** changes it straight away, every time
- [ ] While it reads, it says how long is left at the current speed, and counts down
- [ ] Roughly right: time a few minutes of reading against what it said

## Convert to MP3

Added 17 September. Reload the page first.

- [ ] **File ▾** in the top left has **Open…** and **Convert to MP3…**; Open still works, and so do `Ctrl`+`O` and dropping a PDF
- [ ] **Convert to MP3…** shows the file name, voice, speed and what to convert, with how long converting takes and how long the audio runs
- [ ] Changing the speed, voice or pages changes the estimate
- [ ] With text selected first, it offers **Selected text** and starts on it
- [ ] **Convert** asks where to save the file, then shows progress in the bottom-left corner
- [ ] You can keep reading while it converts
- [ ] The time left shown is about right
- [ ] When it finishes, the MP3 plays in another player, sounds right, and is the speed you chose
- [ ] **Cancel** stops it, and leaves no file behind
- [ ] Closing the tab while it converts asks you first
- [ ] Try the scanned book, or a long curriculum, over a few pages

## The voice

Added 17 September. Reload the page first.

- [ ] The **Voice** box, top right, lists eight voices; Lessac is chosen to start with
- [ ] Hovering over the box says what the chosen voice is like
- [ ] ▶ plays a short sample of the chosen voice straight away, before anything downloads; ■ stops it
- [ ] Choosing a voice you haven't used says how big it is to download
- [ ] **Read aloud** with a new voice downloads it (the status line counts the MB), then reads
- [ ] The second time, that voice starts at once
- [ ] Changing voice while it reads carries on in the new voice, from the start of that sentence
- [ ] VCTK and LibriTTS (the two bigger downloads) read too
- [ ] The voice you chose is still chosen after a reload
- [ ] Nothing in the top bar overlaps, at full width or in a narrower window
- [ ] Which voices you like best -- worth noting for the default

## Reading order

Added 17 September. Reload the page first.

- [ ] `Ctrl`+`R` (or **Display ▾ → Show reading order**) outlines each part of the page: numbered in blue where it's read, greyed and labelled where it's skipped
- [ ] The numbers run in the order you'd read the page, down each column
- [ ] Clicking a numbered part greys it out, and reading then skips it; clicking it again puts it back
- [ ] Clicking doesn't start reading or select anything while the outlines are showing
- [ ] Doing it while it reads carries on from about the same place
- [ ] Highlights stay on the same words
- [ ] Close the tab and open the same PDF again: your changes are still there
- [ ] **Display ▾ → Reset reading order** undoes all of them
- [ ] `Ctrl`+`R` again hides the outlines, and clicking reads as before
- [ ] On a two-column paper and on the scanned book, the outlines look sensible

## Display switches, and Help

Added 16 September, late.

- [ ] **Display ▾ → Click to read** off: clicking a sentence no longer reads; right-click → *Start reading from here* still does. Back on: clicking reads again
- [ ] **Clean up text for reading** off: the status line says "reading the PDF verbatim" and the reference list gets read. Back on: it's skipped again
- [ ] **Skip citations while reading** off: citations like "(Smith 2020)" are read out. Back on: passed over
- [ ] **Read footnotes** is greyed out on a paper without footnotes; on one with them, turning it off skips them
- [ ] Flipping any of these while it reads carries on from about the same place
- [ ] Highlights stay on the same words after flipping them
- [ ] The switches are remembered when you open the next PDF
- [ ] Pausing straight after pressing Read aloud stays paused
- [ ] **Help ▾ → Keyboard shortcuts** (or the `?` key) lists the keys, and every one listed works
- [ ] **Help ▾ → About Mimick** and **Source code** open

## Highlights and notes

Added 16 September, late. Reload the page first. Try it on your own PDFs, not
only the sample.

**Highlighting**
- [ ] Select some words, then press `Ctrl`+`H`: they turn yellow, and a card quoting them appears in the panel on the right
- [ ] The **Highlight** button does the same; the round button beside it picks another colour for the next one
- [ ] A thin coloured line joins each highlight to its card
- [ ] `Ctrl`+`Z` takes the highlight back; `Ctrl`+`Shift`+`Z` puts it back

**Notes**
- [ ] Select words and press `Ctrl`+`M` (or **+ Add note**): the note box opens
- [ ] Typing in it changes the card in the panel as you type
- [ ] A heading, and a different colour, both show once saved
- [ ] `Ctrl`+`Enter` saves; **Cancel** or `Esc` leaves things as they were
- [ ] Press `Ctrl`+`M` and start typing straight away, fast: nothing starts reading, and the box opens ready for you
- [ ] `Esc` on a brand-new note keeps the highlight, and the line at the bottom says "Highlighted" rather than still saying words are selected
- [ ] Double-clicking a highlight, or its card, opens its note again
- [ ] `Ctrl`+`Z` undoes a change to a note

**Picking one out**
- [ ] Clicking a highlight lights up its card, and a small × appears in the page margin beside it
- [ ] Clicking that × (or the × on the card) deletes it; `Ctrl`+`Z` brings it back, note and all
- [ ] With one picked out and nothing selected, `Ctrl`+`C` copies its words
- [ ] Right-clicking a highlight or a card offers: copy the passage, the note or both; edit; **Read this passage**; delete
- [ ] **Read this passage** reads just that highlight
- [ ] `Ctrl`+`J` and `Ctrl`+`K` (or ‹ › in the panel) go to the next and previous note, turning pages as needed

**The panel**
- [ ] It shows the notes for the page you're looking at, and changes as you scroll
- [ ] **Highlights** and **Notes** at the top switch each kind on and off; their numbers are right
- [ ] ⚙ lets you change the typeface, the size and your name; the cards change as you choose
- [ ] Notes get bigger and smaller as you zoom
- [ ] `Ctrl`+`B` hides and shows the panel

**The Highlight / Add note buttons**
- [ ] Drag them by the ⋯ handle: onto the page they float; to the top or bottom edge they become a strip; onto the panel they go back in
- [ ] Dragged loose, they stop at the edge of the window: you can't drag them off it, and making the window smaller keeps them in view
- [ ] Hiding the panel moves them to the top rather than hiding them
- [ ] `Ctrl`+`Shift`+`H` hides and shows them
- [ ] **Display ▾** in the top bar lists the same choices
- [ ] Where you left them is remembered after a reload

**Keeping them**
- [ ] The bottom of the panel says "Kept in this browser" with a time
- [ ] Close the tab, open the reader again and open the same PDF: your highlights and notes are back
- [ ] `Ctrl`+`S` (or **Download a copy**) downloads "… (notes).pdf"
- [ ] That file opens in another PDF reader (Okular, Firefox, Acrobat…) with your highlights and notes in it
- [ ] Opening that downloaded file in the reader shows them too
- [ ] A PDF that already had highlights from another program shows them

**Menus**
- [ ] **Notes ▾** lists everything above with its keys, and greys out what can't be done yet

## Speed, right-click, selecting and the cursor

Added the evening of 16 September. **Stop the old page server and start
`python3 serve.py` instead**, then reload -- the old server let Chrome keep old
copies of the scripts, which may be why speed seemed to do nothing.

- [ ] Changing **Speed** while it reads changes it straight away, mid-sentence
- [ ] Right-click a sentence → **Start reading from here** reads from it
- [ ] Drag across words selects them (pale blue); double-click selects a sentence
- [ ] `Ctrl`+`A` selects the page; `Esc` clears
- [ ] `Ctrl`+`C` copies the selection; paste it somewhere to check
- [ ] `Enter`, or right-click → **Read the selection**, reads only the selection
- [ ] While reading, a thin blue cursor follows the voice; paused, it blinks
- [ ] Paused: `←` `→` move it a word, `↑` `↓` a line, `Home` `End` to the line's ends, `Ctrl`+`←` `→` a sentence
- [ ] Holding `Shift` with any of those selects
- [ ] While reading, `←` `→` still skip a sentence

## Reading aloud, and scanned books — http://localhost:8731/reader.html

Added 16 September. Reload the page first (`Ctrl`+`Shift`+`R`) so the browser
picks up the new version.

**A long scanned book**
- [ ] The first pages show within a few seconds, before "sentences to read" appears
- [ ] The status line counts "drawing pages ahead", and scrolling past those pages shows them at once
- [ ] Every page you scroll to loads -- none stays blank
- [ ] Close the tab, reopen the book: pages already drawn show at once
- [ ] Zoomed right in, a page sharpens after a moment

**Reading**
- [ ] **Read aloud** is greyed out until the sentences are ready, then works
- [ ] The first time, it downloads the voice (about 60 MB) and says so, then reads
- [ ] It starts at the top of the page you are looking at
- [ ] The sentence is tinted blue and the word being said is lit, in time with the voice
- [ ] The page scrolls along as it reads
- [ ] `Space` pauses and carries on; so does the button
- [ ] ↶ / ↷ and `←` / `→` go back and forward a sentence
- [ ] Changing **Speed** while it reads takes effect from the next sentence or two
- [ ] Clicking a sentence reads from there; dragging to scroll does not
- [ ] Reading carries on with the tab in the background
- [ ] Opening another PDF stops the reading

## The voice — http://localhost:8731/voice.html

- [ ] **Load** is ready within a few seconds (the first ever load downloads 63 MB)
- [ ] **Measure** ends with "4× holds"
- [ ] **Read at 1×**, then 2×, 3×, 4×, one after another, all finish without an error
- [ ] Each word lights up as you hear it, at every speed
- [ ] 4× is still understandable
- [ ] **Stop** stops straight away

**On an ordinary laptop** (2–4 cores), the same list — this is the test that
says whether 4× holds on the computers most people have. Note the laptop's
model and what **Measure** says.

## The desktop app

- [ ] With an offline voice, the highlight keeps up with the voice, especially
      straight after a comma or full stop
- [ ] At 4–5×, the highlight still keeps up
- [ ] On a paper with footnotes, `Ctrl`+`R` shows the footnotes as read (numbered) while **Read footnotes** is on, and clicking one skips it
