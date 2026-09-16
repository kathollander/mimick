# Mimick for the web

A PDF reader that reads aloud in natural voices, highlighting each word as it
speaks it — in a browser tab, with nothing installed and nothing uploaded. Your
document is opened by your own browser and never leaves your machine.

**It reads aloud, with one voice so far.** [`reader.html`](reader.html) opens a
PDF, shows it, and reads it with the word being said lit on the page. Scanned
books are drawn ahead in the background and kept in the browser, so they scroll
quickly. Two test pages prove the foundation: [`index.html`](index.html) puts the
sample paper through the desktop app's layout analysis, and
[`voice.html`](voice.html) reads a passage aloud with a Piper voice, up to 4×.

This is the browser version of **[Mimick](https://github.com/kathollander/mimick)**,
the installed Linux and Windows app. That one is the original and still where
the reading is worked on; see *Which way the work flows* below.

Written by Claude Code, arranged by Kat Hollander
([github.com/kathollander](https://github.com/kathollander)). AGPL-3.0, because
MuPDF is — and because this is served over a network, that licence is why the
source lives here in public, linked from the page itself.

## Running it

It cannot be opened as a `file://` URL, because the page fetches its own
Python. Serve the folder:

```bash
python3 serve.py
# then open http://localhost:8731/reader.html
```

Any static server works, but `serve.py` tells the browser to check for new
files every time. `python3 -m http.server` does not, and Chrome then keeps
running old copies of the scripts after they change.

To check the foundation without a browser:

```bash
node tools/check_spike.mjs
node tools/check_voice.mjs
node tools/check_timing.mjs
node tools/check_reading.mjs
node tools/check_reader.mjs
node tools/check_selecting.mjs    # with serve.py running
node tools/check_notes.mjs        # the same
```

The first compares every region of the sample against what the desktop app
found, and the last every sentence and word. The second checks the voice pronounces things as the desktop's does, and
that speeding it up keeps its pitch.

## Which way the work flows

`py/` holds five modules copied from the desktop app — `document.py`,
`layout.py`, `citations.py`, `speech.py` and `annotations.py`, about 1,700 lines
that decide what on a page is worth reading, in what order, which word is
where, and how highlights are written into a PDF. They are the hardest-won code in either
project and there is **one copy that matters**, the one in `mimick`.

**Fix things there, then bring them across:**

```bash
tools/port.sh ../Mimick
```

Never edit `py/` here. An edit made here is lost the next time that script
runs, and before it is lost it makes the two versions read documents
differently — which `tools/check_spike.mjs` and `tools/check_reading.mjs` are
there to catch.
`py/PORTED-FROM.txt` records which commit the copies came from.

## What is vendored, and why

`vendor/` holds Pyodide, the PyMuPDF WebAssembly wheel, espeak-ng and ONNX
Runtime, served from this site rather than from a CDN. Whoever controls a CDN can run code in a tab that
has the reader's documents open in it, so there is no CDN. The wheel's SHA-256
is checked against PyPI's before it goes in, and its version is pinned to the
desktop app's — see [`docs/PORT-LOG.md`](docs/PORT-LOG.md) for what turned up
when it was not. Voices are the one thing fetched from elsewhere, from Hugging
Face, pinned to a revision and checked against a hash before use.

## Where the plan lives

For picking the work up, start with [`docs/HANDOFF.md`](docs/HANDOFF.md).

In the desktop repository, at
[`docs/FUTURE-FEATURES.md`](https://github.com/kathollander/mimick/blob/main/docs/FUTURE-FEATURES.md)
— the decision, the eight voices, the roadblocks and the build order.
