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

Not started. This is the step that decides whether 4× holds; see **Speed, and
the cap** in `FUTURE-FEATURES.md`. Measure the ratio of synthesis time to audio
length, on an ordinary laptop, with and without the `coi-serviceworker` shim —
the gap between those two numbers is the threading roadblock, measured instead
of guessed.
