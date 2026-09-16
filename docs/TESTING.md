# Testing checklist

Things only a person can judge. The check tools in `tools/` cover the rest; run
them first (see `HANDOFF.md`).

Start the page server from this folder, then open the links below in Chrome:

```bash
python3 -m http.server 8731
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
