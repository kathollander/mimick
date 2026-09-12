# Mimick

**Linux's answer to Edge Read Aloud.** Opens a PDF, reads it out in a natural
voice, and highlights each word as it says it.

> ### Heads up: this is brand new, and AI-written
>
> Mimick was written with AI, by Claude Code with me steering, and **may have
> major flaws and bugs.** Keep backups of anything precious, and use **Save
> As** rather than **Save** on documents you can't replace.
>
> [Bug reports](#found-a-bug) very welcome.

---

## What it does

- **Reads aloud** in natural voices — 47 English online, 38 offline.
- **Highlights each word** as it speaks, and scrolls to follow.
- **Speeds up** to 3×, or down to 0.75×.
- **Skips the junk** — headers, footers, sidebars, citations, reference lists.
- **Highlight and annotate** in four colours, with margin notes. Saved as real
  PDF annotations, so Okular, Acrobat and Zotero see them too.
- **Converts to MP3** for listening away from the computer.
- **Works offline** with Piper voices.
- **Keeps your place** in every document.

## Installing

Open this folder in a terminal — in Files, right-click it and choose **Open in
Terminal** — then:

```
./install.sh
```

Enter your password if asked, and wait a few minutes. Mimick is then in your
applications menu.

Everything stays inside this folder and your home directory; your system Python
is untouched. Safe to run again if something breaks.

## Using it

Open a PDF (`Ctrl`+`O`, or right-click → *Open With*), then press **Space**.

Click any sentence to read from there, or drag across a passage and press
**Enter** to read just that. Speed is top left, voice top right.

| Key | Does |
| --- | --- |
| `Space` | Start reading, or pause |
| `Enter` | Read the selection, then stop |
| `←` `→` | Back or forward a sentence |
| `Ctrl`+`H` / `Ctrl`+`M` | Highlight / highlight with a note |
| `Ctrl`+`J` / `Ctrl`+`K` | Next / previous note |
| `Ctrl`+`R` | Show what will be read |
| `Ctrl`+`O` / `Ctrl`+`S` / `Ctrl`+`Shift`+`S` | Open / Save / Save As |

**Help → Keyboard shortcuts** has the rest.

## Highlighting and notes

Select text and press `Ctrl`+`H` to highlight, or `Ctrl`+`M` to highlight and
write a note. Notes sit in a panel beside the page, lined up with the passage
they belong to. Double-click one to edit or delete it.

A note is stored *inside* its highlight, which is how PDFs work — so every note
belongs to a highlight, and other readers show it as that highlight's comment.
Set your name under **Notes → Note appearance** and it's saved as the author.

**File → Save** writes into the open PDF; **Save As** leaves the original alone.

## What gets read, and what doesn't

Academic PDFs are full of things you don't want spoken. Sorted by position, a
running header and a footer DOI land in the middle of a sentence:

> *"Introduction — Journal of Applied Nonsense, Vol 12 — the results were
> broadly consistent with doi.org/10.0000/example.2024"*

So Mimick works out each page's layout instead, and leaves out the furniture.
Also left out: **in-text citations** (`[14]`, `(Okafor et al., 2019)`,
`(p. 88)`), **reference lists**, the **masthead** and the author declarations at
the end. Web addresses and page numbers are never read, and words hyphenated
across a line break are rejoined, so "under- stood" is spoken as one word.

Press `Ctrl`+`R` to see the decisions: numbered regions get read, dimmed ones
don't, and **clicking any region changes it** — remembered for that document.

Two switches in **Display** turn the skipping off if you want everything:
*Skip citations while reading* and *Clean up text for reading*.

## Converting to MP3

**File → Convert to MP3.** Choose the file name, folder, voice, speed, and how
much — the whole document, a page range, or your selection. It tells you how
long the conversion will take and how long the audio will run before it starts.
Cancel stops immediately and leaves no half-written file.

The cleanup switch is here too, starting from whatever Display is set to, so you
can keep the reference list out of your listening and still make a complete
recording when you want one.

## Reading offline

The default voices are Microsoft's online ones, the same as Edge's Read Aloud.
For offline, **Voice → Manage offline voices** lists 176 Piper voices — about
60 MB each. `en_GB-alan-medium` is a good first choice.

**If your connection drops mid-document**, Mimick switches to an installed
offline voice and carries on, provided you downloaded one beforehand.

Piper doesn't report exactly when it says each word, so offline highlighting is
estimated rather than exact. **Kokoro** is also available — better quality, but
a 350 MB download and much slower.

## If something goes wrong

**"No readable text"** — it's a scan. Run `ocrmypdf scanned.pdf readable.pdf`
first.

**"Voices could not be loaded"** — the online voices need internet.

**The notes panel looks empty** — check the two chips at the top of it.

**No sound** — check Settings → Sound; Mimick uses your default output.

**Anything else** — run `./install.sh` again. It repairs a broken setup.

To uninstall: `./uninstall.sh`. Settings live in `~/.config/mimick` and voices
in `~/.cache/mimick`; delete those for a clean slate.

## Found a bug?

**Open an issue.** Mimick is days old, so you're likely the first to hit it.

What helps: what you did in order, the PDF if you can share it, any error text
(run `~/.local/bin/mimick` from a terminal to see it), and your distro plus
Wayland or X11.

**Already known to be rough:**

- **Layout analysis is guesswork.** Some documents will come out wrong. `Ctrl`+`R`
  fixes them by hand — please report any that need a lot of it.
- **Scanned PDFs can't be read** until they've been through OCR.
- **Offline highlighting is approximate.**
- **Footnote markers** arrive stuck to the previous word and get read with it.
- **Only tested on Ubuntu 25.10, GNOME, Wayland.**

## Licence

Please remix, fix, and break as you please! We're built on open source software,
so we're giving it back as open source software.

[GNU Affero General Public License, version 3](https://www.gnu.org/licenses/agpl-3.0.html)
— required by MuPDF, and a good fit besides.

Built on [MuPDF](https://mupdf.com/), [edge-tts](https://github.com/rany2/edge-tts),
[Piper](https://github.com/OHF-Voice/piper1-gpl), Qt and ffmpeg.

**Written by** Claude Code · **Arranged by** Kat Hollander
([github.com/kathollander](https://github.com/kathollander))

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's planned, and
[`docs/HANDOFF.md`](docs/HANDOFF.md) if you're picking the code up.
