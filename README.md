# Mimick

**Linux's answer to Edge Read Aloud!** Mimick-ing natural sounding human
voices, read any pdf out loud slow or fast with no hassle.

> ### Heads up: this is brand new, and AI-written
>
> Mimick was written with AI, by Claude Code with me steering, and **may have
> major flaws and bugs.** It works — I've been reading with it — but it has not
> had the months of real-world use that shake the awkward stuff out.
>
> Please keep backups of anything precious, and use **Save As** rather than
> **Save** on documents you can't replace.
>
> [Bug reports](#found-a-bug) very welcome.

---

## What this does

**Read aloud in natural voices** — Using Microsoft's natural speech service
(online) or Piper (offline), choose from over 40+ voices to be serenaded by.

**Follow Along** — As Mimick reads, you will see the text highlighted on the
page for you to follow along with.

**Read at your speed** — Slow down the syllables or speed up reading that pesky
syllabus with options from 0.75 to x3 reading speed.

**Highlight and Annotate** — With four colours, highlight what you don't wanna
forget and make notes on what piques your interest. These are saved as regular
PDF annotations so other PDF readers can see them too.

**Convert to Audio** — Turn any PDF document into an .mp3 for on the go
listening. In the car, at home… just port the .mp3 to your device and playback.

**Offline Voices** — When the internet just isn't cooperating, don't worry!
Piper voices have your back.

**Keeps your place** — When you leave a doc, returning means picking up where
you left off from.

---

## Installing

1. Open this folder in a terminal. (In Files, right-click the folder and choose
   **Open in Terminal**.)
2. Type this and press Enter:

   ```
   ./install.sh
   ```

3. Enter your password if asked. Wait a few minutes.

That's it — Mimick is in your applications menu. Press the Super (Windows) key
and type *Mimick*.

The installer keeps everything inside this folder and your own home directory.
It doesn't touch your system Python or anything else. It's safe to run again if
something breaks.

---

## Using it

- **Open a PDF** — File → Open PDF (`Ctrl`+`O`), or right-click any PDF and
  choose *Open With → Mimick*.
- **Press Space** to start reading. Press it again to pause.
- **Scroll** continuously, like any reader. Pages render as you reach them, so a
  300-page book stays quick.
- **Speed** — top left. 2× is popular for getting through readings.
- **Voice** — top right, with *Preview* for a sample.

### Two ways to choose what gets read

**Click a sentence.** Reading starts from there. Clicking a margin or a gap does
nothing, so you can't set it off by accident.

**Select the text you want.** Drag across a passage and press **Enter** —
Mimick reads just that and stops, then hands the document back so Space carries
on where you were. Double-click selects a sentence; `Ctrl`+`A` the page; `Esc`
clears it.

If you'd rather clicking never started playback, set **Display → Click to read**
to *off*. Then only Enter or the Read button start anything. It's remembered.

### Keyboard shortcuts

**Help → Keyboard shortcuts** lists them all, grouped by what you're doing, with
the mouse actions too. The essentials:

| Key | Does |
| --- | --- |
| `Space` | Start reading, or pause |
| `Enter` | Read the selected text, then stop |
| `←` `→` | Back or forward one sentence |
| `Ctrl`+`H` / `Ctrl`+`M` | Highlight / highlight and write a note |
| `Ctrl`+`J` / `Ctrl`+`K` | Next / previous note |
| `Ctrl`+`O` / `Ctrl`+`S` / `Ctrl`+`Shift`+`S` | Open / Save / Save As |
| `Page Up` `Page Down`, `Ctrl`+`↑` `Ctrl`+`↓` | Turn the page |
| `Ctrl`+`Home` / `Ctrl`+`End` | First / last page |
| `Ctrl`+`+` / `Ctrl`+`−` / `Ctrl`+`0` | Zoom in / out / reset |
| `Ctrl`+`A` / `Esc` | Select the page's text / clear the selection |
| `Ctrl`+`T` / `Ctrl`+`Shift`+`N` | Show or hide the toolbar / notes panel |
| `Ctrl`+`R` | Show the reading order |

---

## Highlighting and notes

Select some text and press `Ctrl`+`H` to highlight it, or `Ctrl`+`M` to
highlight it *and* write a note.

Notes appear **in the shaded panel beside the page**, next to the text they
belong to, with a line connecting the two — the way a note in a book's margin
sits beside its passage. They're always visible; no hovering or clicking to
find them. Notes near each other stack instead of overlapping, and they grow
and shrink with the zoom, like the text beside them.

- **Sift the panel with the two chips at its top.** *Highlights* covers
  passages you only marked; *Notes* covers the ones you wrote on. Both show a
  count. Turn either off to read just the quotes, or just your own writing.
  The same switches are in **Display**.
- Click a highlight or a note card to select it.
- **Double-click** either to edit the note, its heading or its colour, or to
  delete it. The card updates as you type, and Cancel puts it back exactly.
- A note can carry an optional **heading**, shown bold on the card and as the
  annotation's subject in other PDF readers.
- **Notes → Note appearance** sets the typeface, size and **your name** — saved
  with each highlight as its author, which is what Okular and Acrobat show
  beside your notes.
- `Ctrl`+`J` / `Ctrl`+`K` jump between notes.
- **Display → Notes panel** (`Ctrl`+`Shift`+`N`) hides the panel when you want
  the width back for the page.

### What counts as an annotation

In PDF terms an **annotation** is any markup saved inside the file — highlights,
sticky notes, underlines, drawings.

Mimick makes one kind: a **highlight**. A **note** isn't a separate object; it's
text carried *by* a highlight, in the field the format calls `Contents`. So
every note belongs to a highlight, and a highlight may or may not carry one.
That's why writing a note highlights the text first, and why annotated passages
appear under both chips.

It's also why your notes open elsewhere: Okular, Acrobat and Zotero read that
same field and show it as the highlight's comment.

Standalone sticky notes — pinned to a spot without highlighting anything — are a
different PDF annotation type that Mimick doesn't make yet. See the roadmap.

## Knowing what it will read

Journal articles are full of things you don't want read aloud: a narrow sidebar
of citation and licence boilerplate, a running header on every page, a DOI in
the footer. Sorted by position, those interleave with the article — you get
*"Introduction doi.org/10.3390/land11050609 According to a Haudenosaunee
creation story, Sky Woman fell from a hole in the Academic Editor: John
Tomaney."*

So Mimick analyses each page's layout instead: it splits the page on bands of
whitespace, sorts the resulting regions into reading order, and marks the ones
that aren't body text. On a real two-column paper this cut mangled sentences
from 18 to none.

**It will still get some documents wrong**, so you can see and change what it
decided. **Display → Show reading order** (`Ctrl`+`R`) outlines every region:

- **Numbered outlines** are what gets read, in that order.
- **Dimmed, dashed regions** are being left out, labelled with why — *side
  note*, *header or footer*, *reference list*, or *skipped* if you excluded it.
- **Click any region** to include or exclude it. Reading rebuilds immediately,
  your highlights are unaffected, and **your change is remembered** for that
  document. **Display → Reset reading order** throws your changes away and
  analyses it afresh.

Handy beyond fixing mistakes: click a region back on if Mimick left out
something you did want.

**In-text citations are passed over.** "The deal included CAD 92 million [51]"
is read without the fifty-one, and so are `(Smith et al., 2020)`, `(p. 293)` and
`(ibid.)`. Numeric, APA, Harvard, Chicago and MLA shapes are all recognised, and
each needs a positive signal — a bracketed number, a year, a page marker — so
ordinary asides like "(and this matters)" survive. On the sample article this
removes 83 interruptions. **Display → Skip citations while reading** turns it
off if you want them.

Two other safeguards work regardless of layout. Web addresses, DOIs, bare page
numbers and stray figure labels are never read, wherever they appear. And words
hyphenated across a line break are rejoined, so "creat- ing" is spoken as
"creating".

**The reference list is left out.** A bibliography is the one part of a paper
nobody listens to, and it reads terribly: the entries are so dense with
abbreviations that they shatter into fragments — *"Soc."*, *"Chron."*,
*"[CrossRef] 40."* On the sample article that is a quarter of every sentence,
and eight minutes of an MP3. Mimick finds the *References* heading in the back
of the document and leaves it, and whatever follows it, out. It shows up dimmed
under `Ctrl`+`R` like anything else, so you can click it back on.

The masthead goes the same way — the address block with the authors' email
addresses, and the labelled declarations at the end (*Funding:*, *Author
Contributions:*, *Conflicts of Interest:*). Acknowledgements are kept; they're
prose, and people read them.

**Display → Clean up text for reading** turns all of that off, for reading
aloud and for converting to MP3 alike, and Mimick reads the PDF verbatim. It
also covers two smaller repairs to the extracted text: the ﬁ and ﬂ ligatures a
PDF stores as single characters are expanded, and an accent that failed to
combine with its letter — *K¯ehaulani* — is repaired rather than pronounced.

The Convert to MP3 window has the same switch, starting from whatever Display is
set to and changing that one conversion — so you can keep the reference list out
of your listening and still produce a complete recording when you want one. The
time estimates update as you tick it.

If you want to check a whole folder of readings without listening to them:

```
.venv/bin/python tools/check_reading.py ~/my-readings/
```

It reports what share of each document will be read and flags sentences that
look like layout trouble — a quick way to find the ones worth a `Ctrl`+`R`.

## Saving

- **File → Save** (`Ctrl`+`S`) writes your highlights and notes into the PDF
  you have open.
- **File → Save As…** (`Ctrl`+`Shift`+`S`) writes a separate PDF and leaves the
  original untouched. Use it for library PDFs, anything read-only, or when you
  want a clean original.

Both save the annotations — that's what saving a marked-up document means. The
title bar shows a dot when you have unsaved work, and Mimick asks before closing
or switching documents.

---

## Converting a PDF to audio

**File → Convert to MP3.** A window opens where you set the file name, folder,
voice, speed, and how much to convert — the whole document, a page range, or
just what you've selected. Everything starts out matching what the app is
already set to.

Before it starts it tells you **how long the conversion will take and how long
the finished audio will run** at your chosen speed. Those estimates come from
measured throughput, not guesses, and the progress window refines the remaining
time from the real rate once it's underway.

You can also have it **open the file's location** when it finishes, so the MP3
is right there to drag onto a phone. The choice is remembered.

Cancel stops immediately and leaves no half-written file behind.

---

## Reading without internet

The **Edge voices** are Microsoft's online neural speech service — the same one
Edge's Read Aloud uses. All 322 are available, 47 of them English, but every one
is synthesised on Microsoft's servers, so they need a live connection.

For offline reading Mimick also runs **Piper** — the engine behind Pied, and the
usual answer for natural speech on Linux.

**Voice → Manage offline voices** lists 176 voices across many languages, 38 of
them English. Pick one and press Download: about 60 MB each, a few seconds to
arrive. `en_GB-alan-medium` is a good first choice. Once installed, **Voice →
Piper voices** switches to it. It speaks about twenty times faster than real
time, so there's no waiting even on a laptop with no graphics card.

**If your connection drops mid-document**, Mimick switches to an installed
offline voice by itself and carries on from the sentence it stopped at. With no
offline voice yet, it offers to fetch one. So: it keeps reading, provided you
downloaded a voice beforehand.

### Previewing voices

Press **Preview** to hear a voice, or the ▶/⏸ button beside the language filter
to pause and resume.

**Two different things get played, and it's worth knowing which.** A voice you
have **not** downloaded can only play the recording it shipped with — the
*Rainbow Passage* ("When the sunlight strikes raindrops in the air…"), the
standard passage used for voice samples. A voice you **have** downloaded says
whichever phrase you picked, because it's spoken on your own machine.

The **phrase list** under the voices holds the phrases Preview can say. The
first is that default passage. Add your own by typing in the box and pressing
Enter, then tap a phrase's chip to make it **current**. The default can't be
removed, since it's the only thing an undownloaded voice can say; your own have
a bin beside them.

**Get all recordings** downloads the sample for every voice in the list — about
90 KB each, so roughly 3.5 MB for all 38 English voices — after which previews
play instantly and work offline. The line at the bottom shows what's stored and
how much room it takes, with **Delete saved recordings** to clear it. Your
downloaded voices and your phrases aren't touched.

There's also **Kokoro**, a single higher-quality offline voice, but it's a
350 MB download and considerably slower. Piper is the better choice for most
reading.

Piper doesn't report exactly when it says each word, so offline highlighting is
estimated from word length. It follows along closely, just not to the
millisecond as with the Edge voices.

---

## If something goes wrong

**"No readable text"** — the PDF is a scan, meaning pictures of pages rather
than text. No reader can speak it until it's been through OCR:

```
sudo apt install ocrmypdf
ocrmypdf scanned.pdf readable.pdf
```

**"Voices could not be loaded"** — the online voices need internet. Check your
connection, or switch to offline voices.

**The notes panel looks empty** — check the two chips at the top of the panel.
If both *Highlights* and *Notes* are off, nothing is listed.

**No sound** — check the volume and output device in Settings → Sound. Mimick
uses your system's default output.

**Anything else** — run `./install.sh` again. It's safe to repeat and repairs a
broken setup.

## Removing it

```
./uninstall.sh
```

Your settings stay in `~/.config/mimick`; delete that folder too for a clean
slate. Downloaded voices and preview recordings live in `~/.cache/mimick`.

---

## How it works

| Piece | Does |
| --- | --- |
| [MuPDF](https://mupdf.com/) via PyMuPDF | Renders pages, extracts words and their positions, reads and writes annotations |
| [edge-tts](https://github.com/rany2/edge-tts) | Microsoft's online neural voices |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | Offline voices |
| Qt (PySide6) | The interface |
| ffmpeg | Audio decoding and MP3 export |

Word-level highlighting works because Microsoft's voice service reports the
timing of every word it speaks. Mimick matches those timings onto the word
rectangles MuPDF extracted from the page.

Pages render at 180 DPI or higher, following HiDPI screens, and only pages near
the viewport are drawn — a small cache keeps memory flat on long documents.

For developers: `MIMICK_CONFIG_DIR` and `MIMICK_CACHE_DIR` redirect settings and
downloads, so a test run can't disturb the ones you use.

## Found a bug?

Please report it — **open an issue** on this repository. Since Mimick is a few
hours old, you're likely to be the first person to hit whatever you hit.

**What helps most:**

1. **What you did**, in the order you did it. "Opened a PDF, pressed Space,
   clicked the notes panel" beats "reading is broken".
2. **The PDF**, if you can share it. Layout is the single biggest source of
   trouble — two-column papers especially. If it's a course reading you can't
   share, say what it looks like: columns, footnotes, scanned or not.
3. **The error text**, if any. Mimick writes errors to the terminal, so run it
   from one to see them:

   ```
   ~/.local/bin/mimick
   ```

   Then reproduce the problem and paste whatever appears.
4. **Your setup** — which distro and version, and whether you're on Wayland or
   X11 (`echo $XDG_SESSION_TYPE`).

**Things already known to be rough:**

- **Layout analysis is heuristic.** Sidebars, headers and footers are detected
  and skipped, and columns are read one at a time, but some documents will
  still come out wrong. Press `Ctrl`+`R` to see and fix what it decided — and
  please report anything that needs a lot of hand-correcting.
- **Scanned PDFs can't be read at all** — they're images. Run them through
  `ocrmypdf` first.
- **Offline highlighting is approximate.** Piper doesn't report word timings, so
  they're estimated from word length.
- **Only tested on Ubuntu 25.10, GNOME, Wayland.** Other distros and desktops
  should work and haven't been tried.
- **Footnote markers aren't detected.** A superscript reference number arrives
  attached to the word before it and is read as part of it.

If you want to fix something yourself, please do — see the licence below, and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's planned and how to run the
checks.

## Licence

Please remix, fix, and break as you please! We're built on open source software,
so we're giving it back as open source software.

[GNU Affero General Public License, version 3](https://www.gnu.org/licenses/agpl-3.0.html)
— required by MuPDF, and a good fit besides.

**Written by** Claude Code · **Arranged by** Kat Hollander
([github.com/kathollander](https://github.com/kathollander))

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's planned next, and
[`docs/HANDOFF.md`](docs/HANDOFF.md) if you're picking the code up.
