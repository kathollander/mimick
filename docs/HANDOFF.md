# Handoff

Where the browser version stands, for a fresh session. Written 16 September 2026,
and updated that evening after Kat tested the reader, and again once it read aloud.

## Read first

1. [`../README.md`](../README.md) — what this is, how to run it, which way work flows.
2. [`PORT-LOG.md`](PORT-LOG.md) — what each step cost and found.
3. [`TESTING.md`](TESTING.md) — the checklist for what only a person can judge.
4. The plan, in the desktop repo: `../Mimick/docs/FUTURE-FEATURES.md`. The
   desktop handoff, `../Mimick/docs/HANDOFF.md`, has the traps that apply to
   the shared reading code.

## Decided

- **Piper voices only**, no Microsoft voices. **English only** for now.
- **Speed caps at 4×**, not the desktop's 5×.
- **Eight voices**, listed in `piper.RECOMMENDED` in the desktop repo. Ship
  their sample clips; fetch a model on first use and keep it in IndexedDB. Two
  of them hold many speakers (109 and 904); a picker for those comes after the
  reader works.
- **Laptop and desktop only.**
- **Work flows one way:** fix in `../Mimick`, then `tools/port.sh ../Mimick`.
  Never edit `py/` here.
- **Nothing from a CDN.** Everything is in `vendor/`.

## Where it stands

- **Step 1, the spike: done.** `node tools/check_spike.mjs` passes — the sample
  reads into the same 71 regions as the desktop app, in Node and in Chrome.
- **Step 2, Piper in a worker: done.** `voice.html`. 6.5× real time at 4
  threads, 3.5× on one, in Chrome on this 12-core machine; 4× reads with no
  stalls when threaded. `node tools/check_voice.mjs` passes. Details and
  findings in `PORT-LOG.md`.
- **Step 3, word timing: done.** Exact, from the model's own phoneme durations
  (`js/timing.js`). `node tools/check_timing.mjs` passes; `voice.html` now
  highlights each word of the passage as it is spoken.
- **Step 4a, the words on the page: done.** The desktop's `document.py` runs
  unchanged under Pyodide (`js/python.js`, `reading.py`), and so does
  `align_marks`, moved into it for the purpose. `node tools/check_reading.mjs`
  passes: 272 sentences and 8,395 words, identical to the desktop's to the
  rectangle, both with the cleanup on and off.
- **Step 4b, the pages: done.** `reader.html`: open a PDF (button, Ctrl+O, drop
  it on the page), scroll, turn pages, zoom 40–400%, in the
  desktop's colours and bar layout. Pyodide runs in `js/document-worker.js`;
  pages are drawn only while on screen or next to it (`js/page-layout.js`).
  `node tools/check_reader.mjs` passes. **Kat has
  tested it by hand** (`TESTING.md`): everything on the list works.
- **Step 4c, reading on the page: done.** See **Next**.
- **PyMuPDF is pinned to 1.28.2**, matching the desktop. Bump both repos together.
- **Local only.** No remote. The public GitHub repo is Kat's call.
- **`sample readings/` is Kat's own documents**, git-ignored because they are
  not ours to redistribute, and **to be deleted before this goes anywhere near
  public**. Use them for testing until then: a 598-page scanned book
  (*Constructing meaning*) and a 212-page curriculum.

## Running it

```bash
python3 serve.py                     # then http://localhost:8731/reader.html
node tools/check_spike.mjs
node tools/check_voice.mjs           # these two need en_US-lessac-low from the desktop app
node tools/check_timing.mjs
node tools/check_reading.mjs
node tools/check_reader.mjs
node tools/check_selecting.mjs       # needs serve.py running; starts its own headless Chrome
node tools/check_notes.mjs           # the same
```

**A headless Chrome, driven from Node, is the easiest way to test the page**,
and works when the Claude in Chrome extension is not connected. Start
`google-chrome --headless=new --remote-debugging-port=9333
--user-data-dir=<scratch folder>`, open a tab through
`http://localhost:9333/json/new?<url>` (a PUT), and talk to its
`webSocketDebuggerUrl` with Node's own `WebSocket`: `DOM.setFileInputFiles` on
`#file` opens a PDF, `Input.dispatchKeyEvent` and `Input.dispatchMouseEvent`
give real keys and clicks, `Runtime.evaluate` reads the state back. That is
how the Page Up bug below was found. Stop it by process ID -- `pkill -f` with
the port in the pattern also matches, and kills, the shell running it.

Claude in Chrome drives these pages: click by screen position, not by element
reference. A reading at 1× outlasts the 45-second limit on one script call, so
start it and read the log afterwards -- and never start a second driver script
on a page where one may still be running; they stop each other's playback.

**The tab Claude drives counts as hidden.** No animation frames, no scroll
events from a script, and after a few minutes timers fire about once a minute,
so a scripted test of the reader crawls or stalls. Test it with real input
instead -- the scroll, click and key actions, then a screenshot, which makes the
page draw -- or ask Kat to bring the tab to the front.

## Traps so far

1. **`<audio>` never starts in a tab that has not been in front.** Play through
   Web Audio. See `PORT-LOG.md`.
2. **Speed-up is ours.** Web Audio raises pitch with rate; `stretch` in
   `js/piper-core.js` keeps it, and keeps length exactly input / rate.
3. **The browser's espeak-ng pronounces some numbers slightly differently.**
   `KNOWN_DRIFT` in `tools/check_voice.mjs`; do not add to it without listening.
4. **A word's mark comes before its sound, by up to about 125 ms.** Correct:
   stops and breathy consonants start quiet. Do not "fix" marks to loudness.
5. **No animation frames in a hidden tab.** Anything that follows playback
   must also work from a timer.
6. **The phonemizer leaks its stack on every call** and dies after a few
   dozen. `createPhonemizer` replaces it before then; call it through that,
   never `callMain` directly.
7. **One voice session runs one sentence at a time.** The worker queues its
   messages; overlapping runs crash ONNX Runtime on threads, and only when the
   timing lines up.
8. **Make the `AudioContext` in the click or key press.** `read-aloud.js`'s
   `prepare()` is called there for that reason; one made after waiting on a
   worker may never make a sound.
9. **Every message to a worker with an id must be answered**, errors included.
   The page waits on each; one that is never answered stops everything queued
   behind it without a word.
10. **`python3 -m http.server` lets Chrome keep old scripts.** It sends no
    caching headers, so Chrome guesses, and ran last hour's `read-aloud.js`
    after an edit -- `Ctrl`+`Shift`+`R` does not help, because
    `coi-serviceworker.js` reloads the page once more. Use `serve.py`. When a
    change seems to do nothing, check the script actually loaded first.
11. **Clear Chrome's cache in a headless test** (`Network.clearBrowserCache`),
    and remember `localStorage` survives between runs: a saved speed or
    reading position changes what the next run does.

## Next

**Done on 16 September, after Kat's test** (`PORT-LOG.md` has the detail):

- **Pages are drawn apart from the reading**, by two or three page workers, so
  a long book shows its pages in seconds and builds sentences meanwhile.
- **Scans are drawn ahead.** A document whose pages take over 400ms is drawn
  page by page in the background at 150 dpi and kept in IndexedDB; reopening
  it is instant. The PDF is never changed.
- **A page that fails to draw no longer stops the rest** -- the likeliest
  cause of Kat's blank pages, which could not be reproduced here.
- **Step 4c is done: it reads aloud.** One voice, `en_US-lessac-low`. Read
  aloud / Pause, ↶ ↷, `Space`, `←` `→`, speed 0.75–4×, click a sentence to
  read from it, the sentence and word lit, the page following, and the place
  in each document remembered.

**Done on 16 September, evening, after Kat's test of reading aloud:**

- **[`PARITY.md`](PARITY.md) lists every desktop feature** and which the
  browser has. Work down it.
- **Speed changes at once**, mid-sentence, from the word reached. Clips are
  kept at the model's own pace too, so nothing is made again. The likelier
  reason Kat heard no change was trap 10: her browser was running old scripts.
- **Right-click menu:** *Start reading from here*, *Read the selection*, *Copy*.
- **Selecting and the text cursor**, as on the desktop: drag, double-click,
  `Ctrl`+`A`, `Esc`, `Ctrl`+`C`, `Enter` reads it; the cursor follows the voice,
  blinks when paused, and the arrows (with `Ctrl` for sentences and `Shift` to
  select) move it. `reader.py` answers every where-is-this-word question with
  the desktop's own `document.py`, through one `call` message.
  `tools/check_selecting.mjs` drives all of it in Chrome with real clicks and keys.

**Done later on 16 September: highlights and notes**, everything in
`PARITY.md`'s section of that name. `js/notes.js` is the desktop's page_view
notes, note_dialog and markup_bar; the highlights themselves are the desktop's
`annotations.py`, now ported too, in the document worker. `tools/check_notes.mjs`
drives all of it in Chrome (36 checks), `tools/cdp.mjs` is what both Chrome
checks share. Three decisions worth knowing:

- **Notes are kept in IndexedDB as plain data** (`reader.snapshot`), not as a
  PDF: a scanned book's PDF is ~100 MB a save. The PDF is made only for
  **Download a copy**. Reopening the same bytes calls `reader.restore`, which
  replaces the file's own highlights with the snapshot, rectangles as saved.
- **Page workers now draw pages without annotations** (`pages.py`,
  `annots=False`); the page draws highlights itself, from the live list. Scans
  kept in `mimick-pages` from before this still have any highlights the PDF
  itself carried baked in -- harmless, and gone once the store evicts them.
- **Header menus.** The browser has no menu bar, so **Notes ▾** and
  **Display ▾** hold what the desktop's menus did. Later switches (reading
  order, footnotes, citations, click to read) belong in **Display ▾**.

**Kat to test:** the new sections at the top of `TESTING.md`.

**Known:** on a page printed sideways the highlight runs across the lines
instead of along them. It comes from the shared reading code, so fix it in the
desktop repo if at all.

**Kat asked on 16 September, and neither exists yet:**

- **Read aloud while a long document is still opening.** Read aloud is greyed
  out until every sentence is built -- 45s for the 598-page book. `Document`
  builds them all in its constructor, in the desktop's shared `document.py`,
  so reading early means building page by page (change it there, then port)
  and letting the player start on pages already built. Word indices must stay
  what a full build gives (desktop trap 9).
- **Right-click.** The desktop's page menu -- *Start reading from here*, read
  the selection, copy, delete a highlight (`main_window.build_page_menu`) --
  is not in the browser; a right-click gets the browser's own menu. *Start
  reading from here* can come now; the rest needs selection first.

**Next, in order:**

1. **Reading while a long document opens**, above.
2. **The voice picker** -- the other seven voices in `piper.RECOMMENDED`. Each
   needs its hashes in `piper-worker.js`'s `VOICES`, and a sample clip.
3. **Keep the reader's place across a reload** (scroll and zoom, not only the
   sentence), which `FUTURE-FEATURES.md`'s **Shortcuts** asks for.
4. The rest of `PARITY.md`.

The layout follows the desktop app, Photopea-style; the shortcuts are already
shared (`FUTURE-FEATURES.md`, **Shortcuts**).
