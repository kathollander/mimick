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

**Opening**
- [ ] The page says "Getting ready…", then "Ready" within about 10 seconds
- [ ] **Try the sample paper** opens it, and the title shows at the top
- [ ] **Open…** opens a PDF of your own
- [ ] `Ctrl`+`O` does the same
- [ ] Dragging a PDF onto the page opens it (the page gets a blue outline while you drag)
- [ ] Dropping something that isn't a PDF says so, and doesn't break anything
- [ ] Opening a second PDF replaces the first cleanly
- [ ] A two-column paper and a long one (50+ pages) both open

**Moving around**
- [ ] Scrolling is smooth, and pages fill in quickly as they come into view
- [ ] The page number at the bottom keeps up as you scroll
- [ ] ‹ and › turn one page; they grey out on the first and last page
- [ ] Typing a page number and pressing Enter jumps there
- [ ] `Page Up` / `Page Down` turn pages
- [ ] `Ctrl`+`↑` / `↓` turn pages; `Ctrl`+`Home` / `End` go to the first and last

**Zoom**
- [ ] − and + zoom out and in; the slider and the % box follow
- [ ] Dragging the slider zooms
- [ ] Typing a % and pressing Enter zooms to it
- [ ] `Ctrl`+`+`, `Ctrl`+`−`, `Ctrl`+`0` zoom the page, not the whole browser
- [ ] `Ctrl`+scroll wheel (or pinch on a trackpad) zooms the page, not the browser
- [ ] You stay at the same spot in the document after zooming
- [ ] Text is sharp at every zoom once the page has redrawn (a moment of blur is expected)
- [ ] Zoomed in past the window width, you can scroll sideways

**Overall**
- [ ] It looks and feels like the desktop app
- [ ] Resizing the window keeps your place
- [ ] Nothing is missing that you'd want before reading aloud goes on top

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
