# Mimick for the web

A PDF reader that reads aloud in natural voices, highlighting each word as it
speaks it — in a browser tab, with nothing installed and nothing uploaded. Your
document is opened by your own browser and never leaves your machine.

[`reader.html`](reader.html) is the reader. It opens a PDF -- or a Word,
OpenDocument, EPUB or plain text file -- shows it, and reads it aloud in one of
seven natural voices at 0.75× to 4×, with the sentence and the word being said
lit on the page. You can click any sentence to read from there, jump around by
the table of contents, find text, highlight and write notes (and export them),
choose what gets read and what is skipped, teach the voice how to say a name,
and turn a document into an MP3. It keeps your place in each document, has a
light and a dark theme, and answers a keyboard's media keys. Once it has loaded,
it works with no internet connection, and Chrome can install it as an app.

## How to use it

1. **Open a PDF** -- or a Word (`.docx`), OpenDocument (`.odt`), EPUB or `.txt`
   file. Use **File ▾ → Open…**, or `Ctrl`+`O`, or drop the file anywhere on the
   page. It opens in your browser and is not uploaded anywhere. Documents that
   are not PDFs are laid out as pages first; headings, paragraphs and text come
   through well, while lists lose their bullets and tables their borders.
2. **Press `Space`** (or **Read aloud**) to start and pause. The first time,
   the voice downloads once -- about 60 MB -- and is kept, so after that it
   starts straight away, even offline.
3. **Change the voice and speed** in the top bar. The **▶** beside the voice
   plays a sample before you download it.
4. **Click a sentence** to read from there, or select some text and press
   `Enter` to read just that. `←` and `→` go back and forward a sentence.
5. **Find text** with `Ctrl`+`F`; `Enter` goes to the next match.
6. **Highlight** a selection with `Ctrl`+`H`, or highlight it and **write a
   note** with `Ctrl`+`M`. Notes appear beside the page (`Ctrl`+`B` shows or
   hides them), and are kept in this browser as you work.
7. **Save a copy** with `Ctrl`+`S`: the PDF with your highlights and notes in
   it, which other PDF readers can show. **File ▾ → Export notes** gives you
   just the notes, as text you can paste anywhere.
8. **Contents**: a PDF with bookmarks lists them on the left; click one to go
   there. The **‹** at the top of that panel, and the **›** on the notes
   panel, put them away; a tab on the edge of the page brings each back (`F9`
   for contents).
9. **A scan with no text?** Mimick says so; **File ▾ → Recognise text in this
   scan** reads the words off its pages, in the browser (a few seconds a page),
   and remembers them for next time.
10. **A name said wrong?** Select the word, right-click, **How to say…**, and
   write it the way it sounds ("Foucault" as *foo koh*). The list is under
   **Reading ▾ → How to say words…**.
11. **Help ▾ → Keyboard shortcuts** (or `?`) lists everything else.

Mimick skips page numbers, running headers and the reference list by itself.
**Reading ▾ → Show reading order** (`Ctrl`+`R`) shows what it will read and in
what order; click a region to read or skip it.

## Browsers

Built and tested in **Google Chrome** on a Linux desktop; it is meant for
laptops and desktops on any system Chrome runs on. **Brave, Microsoft Edge and other Chromium browsers** run the same
engine and should work the same, but have not been tried.

**Firefox** (154, on Linux) passes a scripted check, though no one has used it by
hand yet: it opens PDFs and Word files, reads aloud with each word lit, finds
text, shows the table of contents, keeps highlights, saves copies and exported
notes as downloads, and keeps itself for offline use. **Safari is untested.**
Where they differ from Chrome: saving a copy or an MP3 downloads it when it is
finished, instead of asking where first, because they have no
`showSaveFilePicker`; Open Recent is Chromium's only; installing as an app is
Chrome's; and the voice runs
faster with several threads, which needs `SharedArrayBuffer` and so the
cross-origin isolation the service worker provides -- if that fails, the voice
still reads, more slowly, on one thread. Phones and tablets are not supported.

## Privacy

Every document you open stays on your computer: it is read by your own
browser, and nothing is uploaded. The only things Mimick downloads are the page
itself, the first time, and each voice you use, once, from
[Hugging Face](https://huggingface.co/rhasspy/piper-voices) -- checked against a
fixed hash, so it cannot be swapped. Your highlights, notes, reading positions
and settings are kept in this browser's storage and nowhere else; clearing the
site's data in the browser removes them. There are no accounts, no analytics
and no tracking. After the first visit Mimick needs no network at all.

## Two test pages

[`spike.html`](spike.html) puts the sample through the desktop app's layout
analysis, and [`voice.html`](voice.html) reads a passage aloud with a Piper
voice, up to 4×. They are for development, not for readers.

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

After changing any file the page serves, run `python3 tools/stamp_offline.py`.
The service worker (`sw.js`) keeps a copy of the whole app for offline use, and
the stamp is how browsers that already have one learn there is a new version.

To check the foundation without a browser:

```bash
node tools/check_spike.mjs
node tools/check_voice.mjs
node tools/check_timing.mjs
node tools/check_reading.mjs
node tools/check_reader.mjs
node tools/check_selecting.mjs    # with serve.py running
node tools/check_notes.mjs        # the same
node tools/check_display.mjs      # the same
node tools/check_order.mjs        # the same
node tools/check_find.mjs         # the same
node tools/check_text.mjs         # the same
node tools/check_offline.mjs      # serves a copy of its own on 8732
node tools/check_convert.mjs      # the same; downloads a voice on its first run
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
