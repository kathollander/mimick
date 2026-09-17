# Handoff

Where the browser version stands, for a fresh session. Written 16 September 2026;
last updated late that night, after highlights, notes and the Display switches
went in.

## Releasing

Kat means to release in a fresh session. **Start with the desktop repo's
`docs/HANDOFF.md`, section Releasing**, which covers both versions. For this
one, in short: check the voice licences (**Next**, item 0), delete `sample
readings/`, and Kat makes the GitHub repository.

## The 17 September review: done

Every item of the code review was worked through on the night of 17 September;
every check in **Running it** passes. In brief:

1. ✅ **The sample was not renamed -- it was replaced.** `sample/sample.pdf` is a
   four-page poem Kat made, not the old journal article, so every reference was
   changed *and* the desktop baselines (`expected-native.json`,
   `expected-reading.json`) were regenerated from the desktop repo, by the
   commands at the top of `check_spike.mjs` and `reading.py` (the ported `py/`
   matches the desktop's HEAD exactly). A poem has nothing for the cleanup, the
   reading order or the footnote switch to leave out, so
   **`tools/make_test_paper.py` makes `sample/test-paper.pdf`**: a three-page
   article of our own words with a running header, page numbers, two footnotes,
   a reference list and a note already in the file. `check_display`,
   `check_order`, `check_notes` and `check_convert` use it; `check_selecting`,
   `check_reader`, `check_spike` and `check_reading` use the poem.
2. ✅ `voice.html` loads Norman. `check_voice` and `check_timing` stay on the
   Lessac model already on this machine (Norman is not in `~/.cache/mimick/piper`),
   as **Running it** says; Lessac is never offered to a user.
3. ✅ Nothing else assumes Kathleen; `PARITY.md` says seven voices, Norman by default.
4. ✅ **Swept.** The working tree names no document of Kat's (the book's title
   is gone from `PORT-LOG.md`, `TESTING.md` and here), no home paths, no email,
   no screenshots. Kept on purpose: "Kat Hollander" and `github.com/kathollander`
   as the credit in `README.md` and About. **For Kat -- the history still has:**
   every commit's author email (`git log --format='%ae'`); the book's title in
   the diffs of `PORT-LOG.md`, `TESTING.md` and `HANDOFF.md`; and the old
   journal article, `sample/mdpi-sample.pdf` (CC BY 4.0, so redistributable
   with credit, but no longer wanted). Rewriting history, or starting the public
   repo from a fresh single commit, is her call.
5. ✅ `voices/README.md`'s table now says what the prose says, a line a voice.
6. ✅ `reader.py` `_source` drops a second copy read the wrong way before using it.
7. 🟡 The second copy still costs a whole second read. The dialog now says so
   while it works ("Reading the document again with the cleanup off -- on a long
   book this takes a while…"), and Cancel closes the window; the worker cannot
   be interrupted mid-read. Building only the pages asked for is left; noted in `PARITY.md`.
8. ✅ The tooltip says "For this conversion only".
9. ✅ `textsFor`'s parameter is `tidy`.
10. ✅ `forget_alternate` is sent only when the box was switched away from
    Display, and a failure is logged to the console.
11. ✅ `check_convert` reads the texts straight from the document worker
    (`r.inWorker` in `tools/cdp.mjs`, through the DevTools protocol) and asserts
    the reference list is there verbatim and not when tidied.

**Then [`ROADMAP.md`](ROADMAP.md), Ship 1, in its order.** That is the list
for getting this to Kat's classmates; it takes over from **Next** below as
the thing to work on. Where the roadmap says *your call*, decide and write
the reason down rather than stopping to ask.

## Read first

1. [`../README.md`](../README.md) — what this is, how to run it, which way work flows.
2. [`PORT-LOG.md`](PORT-LOG.md) — what each step cost and found.
3. [`PARITY.md`](PARITY.md) — every desktop feature, and which the browser has. **The to-do list.**
4. [`TESTING.md`](TESTING.md) — the checklist for what only a person can judge.
   Sweep it for personal information before it goes public (*To do first*, item 4).
5. [`ROADMAP.md`](ROADMAP.md) — what to build, in order, to ship to classmates.
6. The plan, in the desktop repo: `../Mimick/docs/FUTURE-FEATURES.md`. The
   desktop handoff, `../Mimick/docs/HANDOFF.md`, has the traps that apply to
   the shared reading code.

## Decided

- **Piper voices only**, no Microsoft voices. **English only** for now.
- **Speed caps at 4×**, not the desktop's 5×.
- **Seven voices** (Lessac removed 17 September), listed in `piper.RECOMMENDED` in the desktop repo. Ship
  their sample clips; fetch a model on first use and keep it in IndexedDB. Two
  of them hold many speakers (109 and 904); a picker for those comes after the
  reader works.
- **Laptop and desktop only.**
- **Work flows one way:** fix in `../Mimick`, then `tools/port.sh ../Mimick`.
  Never edit `py/` here.
- **Nothing from a CDN.** Everything is in `vendor/`.
- **No voice nicknames**, for now (17 September). Seven voices need no
  renaming, and Kat finds most voices beyond them mid at best.
- **Not a commercial venture.** Free, open source (AGPL-3.0), free to edit.
  Voice licences: see **Next**, item 0.

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
- **Step 4c, reading on the page: done.** One voice, `en_US-lessac-low`;
  speed 0.75–4×, changed at once; the sentence and word lit; the place in each
  document remembered. Scans are drawn ahead by page workers and kept.
- **Step 5 is under way: the desktop's features, one group at a time**, from
  `PARITY.md`. Done: right-click, selecting and the text cursor, highlights and
  notes (panel, movable strip, undo, kept in the browser, Download a copy), the
  Display switches, and Help. Not done: see **Next**.
- **PyMuPDF is pinned to 1.28.2**, matching the desktop. Bump both repos together.
- **Local only.** No remote. The public GitHub repo is Kat's call.
- **`sample readings/` is Kat's own documents**, git-ignored because they are
  not ours to redistribute, and **to be deleted before this goes anywhere near
  public**. Use them for testing until then: a 598-page scanned book
  and a 212-page curriculum.

## How the page fits together

| File | Holds |
| --- | --- |
| `reader.html` | The layout, styles, dialogs. Dark only, in the desktop's colours. |
| `js/reader.js` | Opening, pages, zoom, the reading controls, selecting and the cursor, the right-click and Display menus, every key. |
| `js/read-aloud.js` | The player: prefetch, Web Audio, speed, which word is lit. No DOM. |
| `js/notes.js` | Highlights on the page, the notes panel, note editor, undo, the movable strip, the Notes menu. |
| `js/notes-store.js`, `js/page-store.js` | IndexedDB: notes (never evicted), drawn scan pages (evicted). |
| `js/document-worker.js` + `reader.py` | Pyodide with the desktop's `document.py` and `annotations.py`: sentences, words, the cursor's steps, highlights. The page asks through one generic `call` message for most of it. |
| `js/page-worker.js` + `pages.py` | Drawing pages, without annotations. |
| `js/piper-worker.js`, `piper-core.js`, `timing.js` | The voice. |
| `serve.py` | The test server. Use it, not `http.server` -- trap 10. |
| `tools/cdp.mjs` | Headless Chrome with real input, shared by the three page checks. |

## Running it

```bash
python3 serve.py                     # then http://localhost:8731/reader.html
node tools/check_spike.mjs
node tools/check_voice.mjs           # these two need en_US-lessac-low from the desktop app, still on this machine
node tools/check_timing.mjs
node tools/check_reading.mjs
node tools/check_reader.mjs
node tools/check_selecting.mjs       # needs serve.py running; starts its own headless Chrome
node tools/check_notes.mjs           # the same
node tools/check_display.mjs         # the same
node tools/check_order.mjs           # the same
node tools/check_find.mjs            # the same
node tools/check_convert.mjs         # the same; downloads a voice on its first run
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

**Kat to test first:** the three newest sections at the top of `TESTING.md`
-- *Display switches, and Help*, *Highlights and notes*, *Speed, right-click,
selecting and the cursor*. Nothing in them has been used by hand yet; every
one is covered by a Chrome check, which says it works, not that it feels right.
She may leave notes in `docs/TESTING DONE.txt` (untracked, hers -- do not commit
it); read it at the start of a session.

**What happened on 16 September, in order** (`git log` has the rest):

1. Speed changed only from the next sentence, and Kat's Chrome was running old
   scripts anyway (trap 10). Speed now applies mid-sentence; `serve.py` added.
2. Right-click menu, selecting, the text cursor.
3. Highlights and notes. Decisions: notes are kept in IndexedDB as plain data
   (`reader.snapshot` / `restore`), not as a PDF -- a scanned book would be
   ~100 MB a save; the PDF is only made for Download a copy. Pages are drawn
   without annotations and the page draws highlights live. The browser has no
   menu bar, so **Notes ▾ / Display ▾ / Help ▾** in the header stand in.
4. Display switches (`reader.set_reading` holds the place by word) and Help.
   A pause in the first 60 ms of reading used to be undone; fixed.

**17 September.** Two fixes from testing: keys pressed in the ~60 ms before
the note editor opens no longer reach the page (an Enter there started
reading), and `Esc` on a new note no longer leaves a stale status line. Then
**Show reading order**: `reader.py`'s `regions`, `toggle_region`,
`set_region_choices` and `reset_regions`; the `order` block in `reader.js`.
Choices are kept in `localStorage` as `mimick-order:<document key>`, by the
desktop's region key, and put back after open and after the cleanup is
switched (which analyses the pages again). Unlike the desktop, the overlay
shows a footnote as read when **Read footnotes** is on -- it asks
`Document._region_reads`, where the desktop's `page_view` asks `region.reads`.
Putting corrections back rebuilds the sentences a second time, which on the
598-page book costs as much again as opening; passing them in at open would
need `Document` to take them, in the desktop repo.

**Later on 17 September: the voice picker.** The eight voices, their hashes
and the pinned revision are in `js/voices.js`, which the page and
`piper-worker.js` both load. Hashes came from the Hugging Face API's LFS
`oid` for each `.onnx` (it reproduces lessac's exactly) and from hashing each
`.onnx.json`. Sample clips ship in `voices/`, with their licences -- **Lessac
and Kusal need checking before going public.** `MimickReadAloud.setVoice`
drops the voice worker and carries on from the sentence playing. The voice box
sits in the right of the top bar; the title now gives way when the bar is
short of room, and the labels hide below 1150px -- the first try put the box
on the left and pushed the bar under **Read aloud**, so ▶ started reading.

**Later still, 17 September: Convert to MP3** (`js/convert.js`, `js/mp3-worker.js`,
`reader.convert_texts`). A voice worker of its own makes each sentence and
`vendor/lamejs` (LGPL, credited in About as LAME asks) encodes it as it comes.
In Chrome `showSaveFilePicker` is asked for inside the Convert click -- it must
be, or the browser refuses -- and the file is written a sentence at a time;
cancelled or failed, the writable is aborted, so nothing half-made is left.
Elsewhere, and in the headless check, it downloads at the end. **Open…**
became **File ▾** to make room without widening the top bar. Estimates use the
desktop's 15.1 characters a second; converting is guessed at 4× real time,
which ran about 12× here, so the first estimate is long until the job times
itself.

**Reading time**, asked for by Kat: the bottom bar's left corner shows how
long the document takes at the speed in the top bar's **Speed** box, and
nothing else, changing whenever that box does; while reading, what is left at
it. From `reader.sentence_lengths` and the desktop's 15.1 characters a second.
Against a real conversion of the sample's page 1 it ran about 15% long for
Lessac. **The desktop app has no such estimate** -- it is on the list in
`PARITY.md`, **For the desktop**.

**Later on 17 September, from Kat's testing (committed in `b57de56`):**
- The voice box shows `Name (accent) — note`, as Convert's does. Below 1150px
  it is held to 11em (`reader.html`); the list still opens in full.
- Convert to MP3: **Clean up text for reading** is a checkbox, ticked as
  Display has it; changing it affects that file only. `reader.convert_texts`
  takes `clean_text`, and `_source` reads a second copy of the PDF the other way
  (`doc.tobytes()`, the reader's region choices put back) -- the desktop's
  `ExportDialog._source`. `forget_alternate` drops it when the dialog closes.
- The estimate reads "Conversion from text to audio: …" and "Finished Audio
  Length: … approximately."; the save line is "You choose where to save it
  next." The sentence count moved to `#convert-time`'s `data-sentences`, which
  `check_convert.mjs` reads.
- Lessac and her clip are gone. Seven voices; Norman is the default (set after, see the review above).
- `check_display`, `check_convert`, `check_reader` passed at the time, before
  the sample PDF was renamed (review item 1); desktop
  `check_voices`, `check_shortcuts`, `check_caret` pass. `TESTING.md` has the
  new items under **Convert to MP3** and **The voice**.

**Known:** on a page printed sideways the highlight runs across the lines
instead of along them. It comes from the shared reading code, so fix it in the
desktop repo if at all.

**Next, in order.**

0. **The voice licences: checked 17 September, decided.** Lessac is
   gone from both apps (its Blizzard 2013 licence is research only, and cannot
   be passed on); the desktop withholds it from the catalogue (`piper.WITHHELD`).
   Norman is clean; Kathleen and Southern English sit on Ryan (CC BY-NC-SA),
   fine while Mimick is not commercial. **Still open:** Joe, Kusal, VCTK and
   LibriTTS were fine-tuned from Lessac, so its terms may carry into them --
   **Kat keeps them**, accepting the risk for a free tool for students and
   accessibility. Also still to do: credit CC BY / BY-SA /
   BY-NC-SA voices in About. The dev checks `check_voice.mjs` and
   `check_timing.mjs` (and the desktop's `check_timing.py`) still use the Lessac
   model already on this machine.
1. ~~Show reading order~~ -- done 17 September; see below.
2. **Read aloud while a long document is still opening.** Read aloud is greyed
   out until every sentence is built -- 45s for the 598-page book. `Document`
   builds them all in its constructor, in the desktop's shared `document.py`,
   so reading early means building page by page (change it there, then port).
   Word indices must stay what a full build gives (desktop trap 9) -- and
   highlights are now keyed to them too.
3. ~~The voice picker~~ -- done 17 September. Nicknames: not wanted for now.
4. **Keep scroll and zoom per document across a reload**, and **Forget this
   document** (notes, drawn pages, position).
5. ~~Convert to MP3~~ -- done 17 September, bar two small things in `PARITY.md`. Then **Open Recent** (Chrome can keep file handles), which goes in **File ▾**.

The layout follows the desktop app, Photopea-style; the shortcuts are shared
(`FUTURE-FEATURES.md`, **Shortcuts**).

**State to leave tidy:** `serve.py` may still be running on 8731 from the last
session (started in the background); it is harmless, and restarting it is
`python3 serve.py`. Nothing is pushed anywhere -- this repo has no remote.
