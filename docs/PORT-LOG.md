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
