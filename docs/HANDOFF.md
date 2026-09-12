# Handoff

Everything a fresh session needs to pick Mimick up. Written 11 September 2026,
at the end of the evening the project was built.

## What Mimick is

A PDF reader for Linux that reads aloud in natural voices, highlighting each
word as it speaks it. It exists because Linux had no equivalent of Edge's Read
Aloud. Written by Claude Code, arranged by Kat Hollander
([github.com/kathollander](https://github.com/kathollander)). AGPL-3.0, because
MuPDF is.

Read [`../README.md`](../README.md) first — it is the user-facing description
and is kept accurate. Then [`ROADMAP.md`](ROADMAP.md) for what is planned and
the traps in this codebase.

## Running it

```bash
./install.sh                 # venv + deps + desktop entry; safe to re-run
.venv/bin/python -m mimick "Testing/Big Ideas from Atleo and Boron 2022.pdf"
```

**Always set `MIMICK_CONFIG_DIR` when testing**, or the test overwrites the
settings actually in use:

```bash
QT_QPA_PLATFORM=offscreen MIMICK_CONFIG_DIR=/tmp/mimick-test \
    .venv/bin/python tools/check_shortcuts.py
.venv/bin/python tools/check_reading.py Testing/
```

## How it fits together

| File | Holds |
| --- | --- |
| `mimick/document.py` | PDF → words → sentences. Word order, hyphen rejoining, run breaking. |
| `mimick/layout.py` | Recursive XY-cut. Decides which regions are body, aside or furniture. |
| `mimick/citations.py` | Regexes for in-text citations, so `[51]` is not read aloud. |
| `mimick/speech.py` | Cleanup before the voice: ligatures, stranded accents, masthead and declarations. |
| `mimick/player.py` | Playback: prefetch queue, transport, word-timing alignment. |
| `mimick/engines/` | `edge.py` (online, word timings), `piper.py` (offline), `kokoro.py`. |
| `mimick/export.py` | MP3 conversion; streams PCM to a temp file, two workers. |
| `mimick/annotations.py` | Highlights and notes as real PDF annotations. |
| `mimick/ui/page_view.py` | The canvas: its own scroll area, page cache, notes panel, plan overlay. |
| `mimick/ui/main_window.py` | Everything else. The big one. |
| `tools/` | `check_shortcuts.py`, `check_reading.py`. Run both after changes. |

**The reading pipeline**, in order: `layout.analyse` cuts each page into regions
and labels them, then marks the reference list and everything after it →
`Document._build_sentences` walks regions in reading order, taking words from
readable ones and passing each through `speech.normalise` → runs break at region
boundaries (except a paragraph carrying to the next page) → a run that is
labelled boilerplate is dropped whole → `chunk_into_sentences` splits on
punctuation and drops runs that are not language → `citations.mark_words` plus a
strip of the assembled text removes in-text citations.

**There is one text pipeline, not two.** Live reading and MP3 conversion both
consume `Document.sentences`; the export dialog filters that list by page range,
and, when its cleanup checkbox disagrees with the open document, takes the list
from a second `Document` opened the other way and closed again by
`ExportDialog.release()` (a `Sentence` holds only strings and rectangles, so it
outlives the PDF it came from). Anything done to the spoken text therefore has to be done in
`document.py` or below, never in `export.py`, or the two paths drift. The
`clean_text` setting (**Display → Clean up text for reading**) and
`skip_citations` both gate behaviour inside `Document` for exactly that reason.
Reading a *selection* goes through `Document.sentences_from_range`, which is
easy to forget — it silently ignored citation skipping until it was fixed.

## Traps that cost real time tonight

**1. PySide6 delivers worker signals on the worker thread.** A plain function, a
bound method, and a `@Slot`-decorated method with `Qt.QueuedConnection` all ran
inside the worker. Calling `QThread.wait()` from such a handler deadlocks
outright — the app froze mid-conversion. The export uses
`QCoreApplication.postEvent` with a custom `ExportEvent`, which Qt *does*
guarantee lands in the receiving object's thread. **Reuse that pattern for any
new worker.**

**2. `QDialog.close()` routes through `reject()`.** `ExportProgressDialog`
overrode `reject()` to mean *cancel*, so closing it on completion only asked it
to stop and left it on screen saying "Stopping…". Every exit now goes through
`finish()`, which sets a flag first.

**3. String literals are inconsistent about escapes.** Some hold `…`
literally, others the character `…`. Pattern-matching on those fails *silently*
— three separate edits tonight appeared to succeed and did nothing, once
leaving a method with a line deleted and its replacement never written.
**Read the actual bytes first, assert that the pattern matched, and prefer
line-anchored edits.**

**4. Do not size a widget to the whole document.** Sixty pages is ~64,000px,
past where Qt coordinates behave. `PageView` is a `QAbstractScrollArea` that
paints only the visible band.

**5. `_ends_sentence` must strip punctuation from both ends.** It only stripped
trailing punctuation, so `"(p."` did not match the abbreviation `p` and the
splitter cut `(p. 21)` in half — 45 times in a 12-page paper. The voice said
"pee" and the page number was lost. Relatedly, `citations.mark_words` matches a
word that *begins* inside a citation rather than one wholly contained by it,
because `"21)."` reaches a character past the closing bracket.

**6. A dead playback thread is silent, not loud.** `align_marks` used `spoken`
as both the list of words and the loop variable over `clip.marks`, so
`spoken[offset][1]` indexed a single character and raised `IndexError` on the
first word of the first sentence. That killed the `mimick-play` thread before a
sample reached the speakers: no sound, no dialog, no clue. `Player._run`
swallows nothing, but nothing watches the thread either. **When playback does
nothing, drive `Player` directly from a script** — the traceback prints there,
where it never reaches the interface.

**7. `Player.configure` must clamp the playhead.** It replaces the sentence list
without touching `_index`, and a rebuild can shrink that list by a quarter.
`_run`'s `while self._index < len(self._sentences)` then exits at once — silent
again. It now clamps; callers that rebuild should still hold the reader's place
by *word* index, as `_toggle_clean_text` does, because sentence numbers mean
nothing across a rebuild.

**8. `VoiceLoader` is deleted out from under its own attribute.**
`loader.finished.connect(loader.deleteLater)` leaves `self._voice_loader`
pointing at a wrapper whose C++ object is gone, and any call on it raises
`RuntimeError: Internal C++ object already deleted`. The reference is cleared on
`finished` now, and `closeEvent` guards anyway.

**9. Word indices must stay stable.** Annotations store `first_word`/`last_word`.
Word order comes from region order, which does not change when a region is
included or excluded — that is why `set_region_reads` can rebuild safely. The
same rule is why `speech.normalise` may rewrite a word but must never drop one:
`clean_text` would otherwise shift every index after the first word it removed,
and the export dialog could not reuse a selection made against the open
document. Both builds give 8,395 words with identical rectangles.

**10. The applications-menu launcher is not the terminal launcher.**
`python -m mimick` resolves the package through the *working directory*. In a
terminal that is the project folder, so it works; from the menu it is `$HOME`,
so it died instantly with `No module named mimick` and no window -- the app
simply did not open. The package is not installed into the venv (there is no
`pyproject.toml`), so `install.sh` writes a launcher that sets `PYTHONPATH`.
Setting the path rather than `cd`-ing keeps a relative filename argument
resolving against wherever the user actually is. **Test the installed launcher
from `$HOME`, not from the project folder** -- from the project folder the bug
is invisible.

## State on disk

- `~/.config/mimick/settings.json` — voice, speed, zoom, reading positions,
  per-document reading-order corrections, preview phrases.
- `~/.cache/mimick/piper/` — downloaded voices (~60 MB each).
- `~/.cache/mimick/piper-samples/` — preview clips (~90 KB each).

## Where it stands

Working and tested: reading with online and offline voices, word-sync
highlighting, speed to 3×, selection reading, highlights and margin notes saved
as PDF annotations, MP3 conversion with estimates and working cancellation,
layout analysis with a visible editable reading order, citation skipping, and
the reading cleanup — reference lists, masthead and declarations left out,
ligatures and stranded accents repaired — switchable in **Display** and
overridable for a single conversion in the Convert to MP3 window.

Not done: see [`ROADMAP.md`](ROADMAP.md). The release checklist there is the
next thing to work through. The single most valuable task is **trying it on more
real documents** — `tools/check_reading.py` makes that quick.

Published at **<https://github.com/kathollander/mimick>** (public, AGPL-3.0),
pushed on 12 September 2026. Commit as `kathollander <kathoacct@pm.me>`, which
is what the initial LICENSE commit used.

`Testing/*.mp3` is git-ignored: conversions run to 26 MB and regenerate in
seconds. The sample PDF is kept — it is MDPI, CC BY 4.0, and the docs and both
check tools point at it.
