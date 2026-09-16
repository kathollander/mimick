# Handoff

Where the browser version stands, for a fresh session. Written 16 September 2026.

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
  it on the page, or the sample), scroll, turn pages, zoom 40–400%, in the
  desktop's colours and bar layout. Pyodide runs in `js/document-worker.js`;
  pages are drawn only while on screen or next to it (`js/page-layout.js`).
  `node tools/check_reader.mjs` passes. Nothing reads aloud yet.
- **PyMuPDF is pinned to 1.28.2**, matching the desktop. Bump both repos together.
- **Local only.** No remote. The public GitHub repo is Kat's call.

## Running it

```bash
python3 -m http.server 8731          # then http://localhost:8731/reader.html
node tools/check_spike.mjs
node tools/check_voice.mjs           # these two need en_US-lessac-low from the desktop app
node tools/check_timing.mjs
node tools/check_reading.mjs
node tools/check_reader.mjs
```

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

## Next

**Kat is working through `TESTING.md`**: `reader.html` by hand, and `voice.html`
on an ordinary laptop. Ask what she found before building on either.

**Step 4: the reader**, in three parts:

- **4a, the words on the page -- done.** See above.
- **4b, the pages -- done.** See above.
- **4c, reading on the page -- next.** What it needs, in order:
  1. **Sentences to the page.** A document-worker message that gives each
     sentence's text and its words' indices, pages and rectangles, and one that
     runs `align_marks` for a sentence and the voice's marks. The alignment
     stays in Python -- one copy, the desktop's.
  2. **The voice in the reader.** `js/piper-worker.js` as it is; a Load voice
     control, since the first load is 63 MB. Prefetch several sentences ahead
     as the desktop's `player.py` does (`PREFETCH = 5`), and play through Web
     Audio from the audio clock, as `voice.html` does -- its `read()` is the
     working model, stalls and hidden-tab timer included.
  3. **The highlight.** The current sentence and word drawn over the page from
     their rectangles times the zoom, in the desktop's `SENTENCE_TINT` and
     `WORD_TINT` (`mimick/ui/theme.py`). Keep the spoken word in view.
  4. **Transport.** Play/pause (`Space` on the desktop -- check
     `main_window._build_shortcuts`), speed 1–4×, and click a sentence to read
     from it (`Document.sentence_at_point`).
  A check tool alongside, as roadblock 2 says: the words lit must be the
  page's own words, in order, for every sentence of the sample.

The layout follows the desktop app, Photopea-style; the shortcuts are already
shared (`FUTURE-FEATURES.md`, **Shortcuts**).
