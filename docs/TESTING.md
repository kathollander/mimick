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

**A scanned book** (*Constructing meaning*)
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
