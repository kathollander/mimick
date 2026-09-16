# Port log

What each step of the build order actually cost, and what it found. The plan
itself lives in the desktop repository, in `docs/FUTURE-FEATURES.md`.

## Step 1 — the spike: MuPDF and `layout.analyse` in a tab

**Done, 16 September 2026. It works, and it matches the desktop app exactly.**

`node tools/check_spike.mjs`:

```
  ok    the document opens at all
  ok    with the same number of pages  — 12 vs 12
  ok    and the same number of regions  — 71 vs 71
  ok    every region matches the desktop app exactly
  ok    something is actually read  — 37 readable regions
```

71 regions across 12 pages, identical in kind, reason, rectangle, character
count and text to what the desktop app produces from the same PDF. The
two-column pages are still cut down rather than across, so trap 12 survives the
move intact.

### What it took, and what it did not

`layout.analyse` needs **three attributes** of a document: `page_count`, and
`doc` holding the MuPDF object. That is all. `spike.py` is a nine-line shim
supplying them, which means the whole of `document.py` can wait until there is
an interface to want it. The 700 lines of layout, citation and speech code
moved across with **not one character changed**.

Timings in Node, on the machine this was written on:

| | |
| --- | --- |
| Pyodide starting | 1.15s |
| PyMuPDF loading | 0.75s |
| 12 pages analysed | 1.15s |

A browser will be slower than Node, and this says nothing about synthesis
speed, which is step 2 and the question that can still say no.

### The one real finding: MuPDF versions drift silently

The first run failed. Not loudly — 71 regions out of 71, every rectangle right,
every label right, and **12 of them one character longer than the desktop's**.

Pyodide 0.29.5 bundles PyMuPDF **1.26.3**. The desktop app is on **1.28.2**.
Two minor versions apart is enough to change how a character is extracted from
a page, in a way that shows up nowhere except in a `chars` count nobody would
be looking at. On the live path it would move word indices — and word indices
are what every highlight and note is stored against (desktop trap 9).

So the wheel is **pinned**, not taken from whatever the runtime happens to
bundle: `pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl`, fetched
from PyPI, SHA-256 verified, and vendored. With the versions matched the
comparison is exact.

**The lesson for every step after this one:** the browser and the desktop can
agree on everything visible and still disagree by a character, and a character
is enough. `tools/check_spike.mjs` compares the whole structure against a
desktop baseline for that reason, and anything added to the port should extend
it rather than be checked by eye.

## Step 2 — Piper in a worker

**Done, 16 September 2026. 4× holds — with threads. Without them it very nearly
does, and that gap is the service worker's whole value.**

`voice.html` runs `en_US-lessac-low` in a Web Worker, speeds it up without
changing pitch, and plays it through Web Audio. Measured in Chrome 153 on this
machine (12 cores), over an eight-sentence passage at 4×, first sentence left
out as warm-up:

| Threads | Speech made per second of work | Reading at 4× |
| --- | --- | --- |
| 1, no service worker | 3.5× | 2 stalls, 0.2s in all |
| 1, with it | 3.7× | — |
| 2 | 6.3× | — |
| 4 | 6.5× | no stalls |
| 12 | 8.4× | — |

The 1-with, 2 and 12 rows were measured before the speed-up existed; it adds
about 1% to the work, so they stand. At 1× both ways run without a stall. Checked without ears, since this machine
was muted: every sentence carries sound, and each plays for exactly its
sped-up length (10.5s of 10.5s expected at 4×; 40.8s of 40.8s at 1×).

**So `coi-serviceworker` stays**, and two threads are enough. The real question
is still an ordinary laptop, which this is not: a single thread here only just
misses 4×, so a slow laptop without threads would stall often, and one with
two cores and threads is probably fine. Worth a run on one before the reader is
built on this.

### What it is made of

| File | What it is |
| --- | --- |
| `js/piper-core.js` | Phonemize, run the model, speed up. Shared by the worker and the check tool. |
| `js/piper-worker.js` | Fetches the voice, checks its hash, keeps it in the browser's Cache Storage. |
| `voice.html` | The measurement page. `?coi=0` removes the service worker. |
| `tools/check_voice.mjs` | Phonemes against the desktop's, pitch held when sped up, audio not silent. |
| `tools/phoneme_baseline.py` | Makes `sample/expected-phonemes.json` from the desktop app's Piper. |

Vendored, and pinned:

| Package | Version | Files | Licence |
| --- | --- | --- | --- |
| `@diffusionstudio/piper-wasm` | 1.0.0 | `vendor/piper/` — espeak-ng as WebAssembly, 18 MB with its data | MIT; espeak-ng GPL-3.0 |
| `onnxruntime-web` | 1.30.0 | `vendor/onnxruntime/` — the plain threaded SIMD build, 14 MB | MIT |
| `coi-serviceworker` | 0.1.7 | `coi-serviceworker.js`, at the root so its scope covers the site | MIT |

The voice itself is not vendored. It comes from `rhasspy/piper-voices` pinned to
revision `1162a917`, and its SHA-256 is the same as the desktop app's
downloaded copy. A download is cached only after its hash matches.

### What it found

**Chrome will not start an `<audio>` element in a tab that has never been in
front.** The first version played through `<audio>` because its
`preservesPitch` gives fast speech at normal pitch for nothing. In a tab opened
behind another window, `play()` never settled and `readyState` stayed at 0 --
no error, no sound, the reader simply waited forever. Web Audio runs regardless.
People will start a document and switch tabs, so **the reader plays through Web
Audio.**

**Web Audio cannot keep pitch, so we speed speech up ourselves.** `stretch` in
`piper-core.js` is WSOLA, the browser's stand-in for the desktop's ffmpeg
`atempo` (desktop trap 13). It costs 3–30 ms a sentence. The check tool holds a
220 Hz tone at 220 Hz ±3% at 1.5×, 2× and 4×, and holds the length to exactly
the input divided by the rate. That exactness matters for step 3: word timings
will scale by the rate and nothing else.

**The browser's espeak-ng is older than the desktop's, and it is audible in
numbers.** Every sentence in the baseline gives identical phoneme ids except
where a number is spoken: "four" and "forty" take a different vowel, and
"ninety" loses a glide. Same words, a shade apart in sound. These are listed as
`KNOWN_DRIFT` in the check tool; anything else still fails. Closing it means
building a newer espeak-ng to WebAssembly ourselves -- not now.

**Clicking by element reference does nothing on these pages** in Claude in
Chrome; clicking by screen position works. And after `?coi=0` the service
worker removes itself with a reload, which swallows a click made just before
it.

## Step 3 — word timing, with a check tool

**Done, 16 September 2026. Word timings are exact, not estimated.**

The desktop app spreads a sentence's length over its words by letter count
(`estimate_marks`). A Piper model already decides how long every phoneme lasts
and simply does not output it. Piper 1.8 ships a patch that exposes it
(`piper/patch_voice_with_alignment.py`); `patchForAlignment` in `js/timing.js`
makes the same change to the model's bytes in memory, after the hash check,
without touching the stored file. The rest of `timing.js` turns phoneme
durations into word start times.

`node tools/check_timing.mjs`:

```
  ok    exposing them changes not one sample of the audio  — 62976 vs 62976 samples
  ok    the durations add up to the sentence  — 62976 vs 62976 samples
  ok    "1,204" takes the four groups it is spoken as
  ok    "of the", run together, share one group in order
  ok    a mark for every word, in order, inside the sentence
  ok    after every comma, the word highlighted is the word heard  — 6 of 6; the desktop's estimate manages 4
          sound returns, ms after the mark:     in +5, how +98, but +124, and +42, write +14, then +41
          and after the desktop's estimate:     -91, +98, +179, +275, +259, +14
  ok    at 4× the marks are exactly a quarter
  ok    and at 4× too, in the sped-up audio
```

In Chrome, reading the passage at 4×: 128 of 128 words highlighted in order,
never jumping back, at worst 32 ms after the voice reached each word, exact
timings in 8 of 8 sentences. Timing costs about 30 ms a sentence; 4× still
holds at 6.1× real time on 4 threads.

### What it found

**Espeak's word breaks are not the text's.** It runs "of the" into one spoken
group and says "1,204" as four. `alignWords` phonemizes each word alone, in one
call, to learn how many sounds and groups it makes by itself, then matches
words to groups by shortest path. Several words sharing a group split its time
by their sound counts; that is the only estimate left.

**"On the mark" is the wrong test.** Checked against the audio, the sound after
a pause comes back 5–124 ms after the word's mark, never before. That is
phonetics, not error: "but" opens with the silent closure of /b/, "how" with
breath too quiet to measure. The test that matters for a highlight is whether
the word lit is the word being heard, and that holds for every case. The
offsets are printed so they can be watched.

**Hidden tabs get no animation frames.** The page highlights from the audio
clock, via `requestAnimationFrame` when visible and a timer when not. While
audio plays the timer is not slowed much -- the 32 ms above was measured in a
hidden tab.

**The desktop app has exact timing too**, since 16 September:
`mimick/engines/timing.py` there is this file in Python, with its own
`tools/check_timing.py`.

### Found by using it: the page broke after a few readings

**Fixed 16 September.** Measure, then 1×, 2× and 3× in a row, and 3× cut off
with "memory access out of bounds". Two faults, one behind the other.

**The phonemizer runs out of stack.** Every `callMain` copies its arguments
onto a WebAssembly stack of about 24 KB and never takes them back: ~190 bytes
plus the length of the text, per call. When it is full espeak aborts, and every
call after fails. Step 3 doubled the calls per sentence, so it went on the 55th
-- measure and two readings are 48. `createPhonemizer` now counts what it has
used and makes a fresh phonemizer (about 55 ms) at 12 KB. `check_voice.mjs`
makes 800 calls; before the fix it failed at 70.

**Two sentences were in the model at once.** The page asks for a passage at a
time and the worker's async handler started each request as it arrived.
Nothing broke while phonemizing returned straight away and kept the runs in
step; once a fresh phonemizer could take 55 ms, two runs overlapped and ONNX
Runtime on threads failed with "null function" or "unaligned accesses". The
worker now takes one message at a time. None of the Node checks can see this --
it needs the worker and threads -- so it was found, and checked, in Chrome:
eight passages requested at once, then Measure, 1×, 2×, 3× and 4× in a row,
all without an error.

## Step 4a — the words on the page

**Done, 16 September 2026.** The reader's sentences and word rectangles come
from the desktop's own `document.py`, run unchanged under Pyodide as the package
`mimick` (`js/python.js`). Nothing in it needed changing: it asks for a path, and
Pyodide has a file system to give it one.

One change was made on the desktop side first: `align_marks`, which puts the
voice's words onto the page's, moved from `player.py` into `document.py`.
`player.py` imports sounddevice and Qt; the function needed neither.

`node tools/check_reading.mjs` compares everything against the desktop's own
output for the sample: 272 sentences cleaned up and 396 as extracted, 8,395
words each way, every index, text and rectangle, and where the voice's words
land. All identical. Opening the sample both ways takes 4.3s in Node, against
1.2s natively.

## Step 4b — the pages

**Done, 16 September 2026.** `reader.html` opens a PDF and shows it: scrolling,
page number and arrows, Page Up/Down, Ctrl+Up/Down/Home/End, zoom by buttons,
slider, typed percentage, Ctrl +/−/0 and Ctrl-wheel or pinch. The desktop's
colours and bottom bar; open by button, Ctrl+O, dropping a file, or the sample.

**How it is built.** `js/document-worker.js` holds Pyodide, MuPDF and an open
`Document` (through `reader.py`), one message at a time. The page asks it for
one page at a time -- on screen first, nearest the middle first, then one either
side -- and gets back an `ImageBitmap`. Pages that leave that band give their
pixels back. A page drawn at the old zoom stays up, stretched, until the sharper
one arrives. No page is drawn with more than 12 million pixels.

**Numbers, in Chrome here.** Python ready in 5.4s from a cold tab; the sample
opens in 1.4s; a page draws in about 80 ms at 150%. In Node, opening is the
same 1.4s.

`node tools/check_reader.mjs` covers the layout arithmetic (positions, which
page is where, what counts as on screen, holding your place through a zoom,
the pixel cap) and opening and drawing the sample under Pyodide. It found one
real bug: a view whose top sat in the gap between two pages jumped up to 16px on
every zoom, because the gap was kept as a fraction of the page below.

### What it found

**Scripted testing does not work in the tab Claude drives.** It counts as
hidden: no animation frames, so the page's updates never ran; no scroll events
for a script's scroll; and before long, timers throttled to once a minute. The
page now updates from a timer when hidden, as trap 5 says it must -- but the
reliable test is real input and a screenshot. Scrolling to page 2, zooming to
190% and keeping the place, and typing 12 into the page box were all checked
that way.

## Step 4c, part 1 — sentences to the page

**Done, 16 September 2026.** `reader.py` gains `sentences`, `align` and
`sentence_at`; `js/document-worker.js` answers them as `sentences`, `align` and
`sentenceAt`. The tint's line boxes are made in Python with the desktop's own
`_merge_rects`, page by page, so a sentence carried over a page break is tinted
on both.

`node tools/check_reader.mjs` now goes through all 272 sentences of the sample:
the words match the desktop's baseline to the rectangle, 6,749 of 6,750 marks
light a word and always in order, every word sits inside its tint, and a click
on a word finds its sentence. The 25 spoken words that never light are the
second halves of hyphenated words and lone punctuation, as on the desktop.
