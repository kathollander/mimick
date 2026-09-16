# Mimick for the web

A PDF reader that reads aloud in natural voices, highlighting each word as it
speaks it — in a browser tab, with nothing installed and nothing uploaded. Your
document is opened by your own browser and never leaves your machine.

**Nothing works yet.** This repository is at the spike stage: enough to prove
the foundation, and no reader on top of it. What runs today is
[`index.html`](index.html), which loads MuPDF into the page and puts the sample
paper through the desktop app's layout analysis.

This is the browser version of **[Mimick](https://github.com/kathollander/mimick)**,
the installed Linux and Windows app. That one is the original and still where
the reading is worked on; see *Which way the work flows* below.

Written by Claude Code, arranged by Kat Hollander
([github.com/kathollander](https://github.com/kathollander)). AGPL-3.0, because
MuPDF is — and because this is served over a network, that licence is why the
source lives here in public, linked from the page itself.

## Running it

Any static file server will do; it cannot be opened as a `file://` URL because
the page fetches its own Python.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To check the foundation without a browser:

```bash
node tools/check_spike.mjs
```

That runs the layout analysis under Pyodide and compares every region against
what the desktop app produced from the same PDF. It must match exactly.

## Which way the work flows

`py/` holds three modules copied from the desktop app — `layout.py`,
`citations.py` and `speech.py`, about 700 lines that decide what on a page is
worth reading and in what order. They are the hardest-won code in either
project and there is **one copy that matters**, the one in `mimick`.

**Fix things there, then bring them across:**

```bash
tools/port.sh ../Mimick
```

Never edit `py/` here. An edit made here is lost the next time that script
runs, and before it is lost it makes the two versions read documents
differently — which `tools/check_spike.mjs` is there to catch.
`py/PORTED-FROM.txt` records which commit the copies came from.

## What is vendored, and why

`vendor/` holds Pyodide and the PyMuPDF WebAssembly wheel, served from this
site rather than from a CDN. Whoever controls a CDN can run code in a tab that
has the reader's documents open in it, so there is no CDN. The wheel's SHA-256
is checked against PyPI's before it goes in, and its version is pinned to the
desktop app's — see [`docs/PORT-LOG.md`](docs/PORT-LOG.md) for what turned up
when it was not.

## Where the plan lives

In the desktop repository, at
[`docs/FUTURE-FEATURES.md`](https://github.com/kathollander/mimick/blob/main/docs/FUTURE-FEATURES.md)
— the decision, the eight voices, the roadblocks and the build order.
