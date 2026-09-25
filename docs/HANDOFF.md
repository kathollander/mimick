# Handoff

Where the browser version stands, for a fresh session. Written 16 September 2026;
last updated the evening of 19 September, after the launch, the first Firefox
report from someone else's computer, the guided tour, and the stalled first
download. Each session that worked on it ended cleanly: tree committed, the
checks it touched passing, scratch files removed. **Pushed and live on 19
September** (`2e8fd82`, at Kat's word, because the stalled download was
hurting new readers): every commit since the launch went out with it. The
history rewrite (*Still for Kat*, item 1) is still hers to run and still works
-- `../mimick-squash-and-push.sh` rebuilds from `master`'s tip whenever it runs.

Three Claude sessions worked in this folder on 17--19 September, sometimes at
once. Before stamping `sw.js` or committing, check what is already modified in
the tree and whose it is: on 19 September two commits (the `document.py` port
and the contents-panel fix) came from a session neither of the other two knew
about.

## It is public

Since 17 September the browser version **is** Mimick:

- **Repository:** `github.com/kathollander/mimick` (public, AGPL-3.0). The
  branch is `master`.
- **Live:** <https://kathollander.github.io/mimick/reader.html>, GitHub Pages
  from `master`, root. **Every push to `master` deploys**, within a minute or
  two. There is no staging: push means published.
- **Release:** `v1.0.0`.
- **The desktop app moved to `github.com/kathollander/mimick-linux`**, locally
  `../Mimick-linux`. Its name in this repo's paths and docs is `Mimick-linux`
  now (`tools/port.sh ../Mimick-linux`).
- **This folder was renamed** from `mimick-web` to `Mimick` on 17 September.

Pages serves the bundled voice gzipped, so a download's `content-length` is not
its real size; `js/voices.js` allows for that.

## Latest: pushed as one commit, and the desktop reads scans (25 September)

- **Pushed, with the history squashed** (`55346ae`), at Kat's word:
  `../mimick-squash-and-push.sh` replaced GitHub's history with one commit of
  `master`'s files, and moved `v1.0.0` (the release follows the tag). This was
  *Still for Kat*, item 1, below: it is done. Before it, one unpushed commit
  carried Kat's personal email as author and another her course folder names;
  both are gone from GitHub. The old history is kept locally on
  `backup/master-before-squash-25-sept`, `history-before-launch` and in
  `../mimick-history-before-launch.bundle`. Live within a minute.
- **Nothing personal in a public repo.** Course names, folder paths and email
  addresses stay in the local notes, never in these docs, a commit message or a
  sample. Kat's three-column governance guide moved out of `sample/` to
  `../Mimick test files/`.
- **The tour says it is a work in progress** (first step and README). Kat will
  refine it herself; don't rework it.
- **The desktop recognises scans** (`Mimick-linux` `c9c83d6`) -- see
  `PARITY.md`.
- **The desktop's history, squashed the same way: ready, for Kat to run.**
  `../mimick-linux-squash-and-push.sh` (the session was not permitted to
  force-push). Until it runs, don't push `Mimick-linux`: one local commit there
  carries Kat's personal email. Pull requests #1 and #2 keep their old commits
  on GitHub whatever happens; only GitHub Support can remove those.
- **Still Kat's:** the four tab questions (`TABS.md`); the desktop's
  LibreOffice decisions.

## Earlier: Kat's list of 23 September, most of it built (24 September)

Kat's `../THINGS TO ADD TO MIMICK.txt` (23 September) had not reached these docs.
A long session worked through it. **Nothing is pushed**; GitHub's `master` is
still `1753eef`. Each item below is its own commit with its checks passing.

- **Click to read starts off** (`fec2769`). A click that starts the voice was
  getting in the way of selecting and highlighting. `switchOn` in `reader.js`
  now treats `click_read` as off unless it is `"1"` -- so it also flips for
  anyone who never touched it, which is what Kat asked. README, help, About
  say so.
- **The tour waits for Next** (`fec2769`). Doing a step shows its praise and
  turns Skip into Next; it no longer moves on by itself after 900 ms. Click to
  read now comes *after* highlighting, as three steps: turn it on (the
  switches strip opens, and its switch is lit), click a sentence, turn it off
  again -- the "show the turn-off" Kat asked for. 16 steps now.
- **Export notes as Word, OpenDocument, PDF or Markdown** (`0fd3c66`, desktop
  `c4c8774`). Export notes… opens a small dialog, Word first, then whichever
  was used last. The file comes from the desktop's `notes_export.py`, now
  ported (`tools/port.sh` and `PACKAGE` in `js/python.js` list it) and called
  as `reader.notes_document` -- so `notesText` in `notes.js` is gone and the two
  apps cannot drift. The shape is Kat's: `“passage” (p. 12)`, then the note
  as points, one per line of the note. A list the PDF ran into one paragraph
  (her example from a course guide) comes out one bullet a line:
  `passage_lines` cuts before each bullet glyph (not `·`, not `-`). Word and
  ODF are written by hand with `zipfile` so Pyodide needs nothing extra;
  checked by opening them in LibreOffice. The desktop's Export notes dialog
  offers the same four, plus `.txt`.
- **The note editor moves** (`794abaa`). A grip along its top drags it; it
  opens where it was left (`mimick-note-box`), double-click the grip for the
  middle. The shaded page behind stays.
- **A reminder to save, every 15 minutes** (`22f029b`). From the first change
  after the last Save a copy / Export notes. Status line plus a **Save a copy
  now** button; Notes ▾ → *Remind me to save every 15 minutes* turns it off.
  The button is a new bottom-bar control, `#status-do`, with `ask(owner, …)`
  / `unask(owner)` in `reader.js`; opening another document clears it.
- **Auto-OCR** (`9bfeaa3`), as Kat decided on the 23rd: textless pages ≤ 20
  are recognised as soon as the open finishes, with **Stop** in the bottom bar;
  more than 20 and the status says how long (about 2 s a page) with a
  **Recognise the text** button.

### The skipped sentences: not the layout, and not reproducible here

Section 3 of *two things about scans*, below, said the scanned reading was not
on this machine. **It is**, with the other two sentences from Kat's list:
two of her course readings, kept outside the repos (the paths are in the
session's local notes, not here, since this repo is public). Traced end to end:

- `layout.analyse` marks all three as **body**, in today's code *and* in the
  live site's (`1753eef`) -- so `_mark_references` is not the cause.
- Each is one sentence in `Document.sentences`, text complete.
- The voice worker phonemises each in full, a timing for every word.
- Playing through in headless Chrome, sentence 125 of the first reading
  plays for 15 s; the two sentences in the second play too.
- There is no italics rule anywhere (Kat asked "is italics blocked?").

So with default settings on this machine nothing is skipped. What is left to
learn is Kat's: which settings (voice, speed, a pronunciation, Clean up text),
which copy of the file, and whether "skipped" meant the voice or the
highlight. A trap for whoever tries next: `r.at(x, y, page)` in `cdp.mjs`
assumes A4 width, so on a Letter page a click lands a line low and looks
exactly like "it started on the next sentence".

### Also built, later the same day

- **Reading ▾ → What repeats** (`0fe8873`, desktop `66fd1ca`). Kat's "what
  repeats constantly?", a first plain answer: `themes.py` (shared, ported)
  counts terms over the sentences read aloud -- two-word phrases first, then
  words that are not just half of one -- with the pages each is on; choosing
  one opens Find with it (`find.lookFor`). On a 20-page history reading it
  leads with a two-word phrase used 36 times. It counts; it does not summarise what the themes mean, which would
  need a language model -- if Kat wants that, it is a new conversation.
- **All notes, dragged into your own order** (`441df8d`). The panel's usual
  view is a margin (pages on screen, each card tied to its highlight by a
  line), so a hand-made order lives in a second view: the **All notes** chip
  in the panel's head lists every card with its page; drag one onto another.
  Kept per document under `mimick-notes-order:<key>`, keyed by word range
  (xrefs can change when notes are restored); Export notes follows it; Notes ▾
  → *Put notes back in page order* clears it. The check drives the drag with
  synthetic `DragEvent`s -- CDP mouse events do not start an HTML5 drag.

### A live bug in Firefox, fixed (`251235e`)

`check_firefox --voice`, owed before any push, failed three times -- and on the
code from *before* this session too, so it was not new. Reading never got past
"Getting the voice ready…": `keepDefault` in `js/voice-picker.js` **awaited
`navigator.storage.persist()`**, which Firefox answers only after the reader
clicks through a permission prompt (headless, never). On the live site since
`e54fdb4` (17 September), so a Firefox reader who ignored or dismissed that
prompt got no voice at all. Now asked, not awaited. Firefox then passed three
times running; Chrome's voice checks pass. **This alone is a reason to push.**

### Before a push

The whole browser suite was run: everything passes, bar one `check_documents`
bar-label timing flake that passed twice on rerun. Two checks "hung" -- the
laptop had suspended (`journalctl` shows it); both pass alone. **GitHub is
still `1753eef`; pushing is Kat's call.**

### Kat's question, answered

**Play/pause in another tab**: the media keys reach Mimick only while it is
the page most recently playing sound; start a video in another tab and the
keys go there. They take nothing from other tabs.

### Desktop, same day

`check_caret` and `check_find` pass with a clean `MIMICK_CONFIG_DIR` (the
failures in its roadmap were most likely a real settings folder). A file is
now laid out **off the UI thread** with a bar that counts a deck's slides,
and `check_convert.py` covers all eleven kinds (`3f2b460`). Export notes and
What repeats are there too. Still Kat's: the LibreOffice decision
(`Mimick-linux/docs/MORE-FILE-KINDS.md`, *For Kat*).

## Earlier: three-column pages (24 September)

A governance guide of Kat's (a public document, kept outside the repos in
`../Mimick test files/`) is set in three columns, and they were read wrong. Three faults in
`layout.py`, fixed in `Mimick-linux` (`c3a5b09`) and ported:

1. **The gutter is 9.8pt**, under `MIN_GAP_X` (10). Columns 2 and 3 were one
   region, read line by line across both, and column 1, next to that wide
   block, became a side note. A gap of `MIN_GUTTER_X` (6pt) now counts when
   there is a column `MIN_COLUMN_WIDTH` (72pt) wide on *each* side. Only
   lowering `MIN_GAP_X` would split a numbered list's "1. 2. 3." off its
   entries (seen on *Big Ideas*, p. 11).
2. **Row cuts across columns** (trap 12): where two columns broke a paragraph
   at the same height, the cut went across and read column 2's top, column 3's
   top, then back. `_cut` now cuts columns first when both sides run at least
   `COLUMN_TALL_SHARE` (0.6) of the height.
3. **Headings in the next column were side notes.** A narrow region is not an
   aside if it starts where a full-width region *clear of the main text*
   starts. That last condition matters: a journal title spans the page and
   shares the sidebar's left edge.

Every other PDF in `sample/` and `Mimick-linux/Testing/` lays out exactly as
before (compared region by region, old module against new). Still wrong in the
guide: the table on p. 12 reads column-wise and marks some cells side notes,
as it did before; contents-page numbers are side notes, which is harmless.

## Earlier: saving in Brave, and a plan for tabs (21 September, late)

**Saving could fail silently.** In Brave (no `showSaveFilePicker`), Save a
copy and Export notes download by clicking a link from code, *after* the file
is made. Brave and Chrome block such a download once that browser tab has
downloaded before, and the page is never told -- so Mimick said "Downloaded"
and nothing arrived. Kat hit it with real notes; she got them out by allowing
downloads from the address bar's blocked-download icon.

The fix: every download (the PDF copy, exported notes, an MP3) goes through
`offer(name, blob)` in `reader.js`. It still downloads at once, but the file
also waits in the bottom bar as **"Not in your downloads?"**, a real link the
reader clicks (its tooltip says where to unblock), until the next file or
another document. The status says "Sent … to your downloads", not
"Downloaded". `check_notes` covers the link; `check_notes`, `check_convert`,
`check_offline` and `check_firefox` (twice, after one known flake) pass.

**Tabs:** Kat asked how hard Photopea-style tabs would be. The plan is
`docs/TABS.md`: tabs that *remember* their document and reopen it on a switch
(about two sessions, since place, notes and drawn pages are already kept per
key), not every tab live (a rewrite of `reader.js`). Four questions there are
Kat's; nothing is started.

**Where it was left:** tree clean, `sw.js` stamped, local `master` **11
commits ahead** of GitHub, nothing pushed. The Firefox check owed before a
push (see *Start here*) has now been run: it passed twice, after one known
flake. What remains is Kat's: finish testing, push, and answer `TABS.md`.
Kat's own serve.py (PID 64155, port 8731) was left running for her.

## Latest: two things about scans, neither started (23 September)

A short session, ended for a restart. **No code was changed** -- the only
edits are this section and one stale line in `ROADMAP.md`. The tree is as 21
September left it: clean, `sw.js` stamped, local `master` still 12 commits
ahead of GitHub, nothing pushed.

### 1. OCR is shipped; the docs sent Kat to the wrong menu

Kat asked whether OCR was possible, then said she could not find it. It has
been live since the 19 September push -- `origin/master` carries `js/ocr.js`,
all six `vendor/tesseract/` files and the menu item. What was wrong was the
docs: `ROADMAP.md` still said **File ▾**, and it moved to **Reading ▾** the
night it was built (`HANDOFF.md`, *the night of 17 September*, records the
move; `ROADMAP.md` was never updated). That line is fixed now.

Also worth knowing before assuming it is missing: the item is always in the
Reading menu but **greyed out unless the open document has textless pages** --
`enabled: !!doc?.textless?.length`, `js/reader.js:1954`. With an ordinary PDF
open it is there and dim, by design, as *Read footnotes* is.

`PARITY.md`'s ⬜ for OCR is **correct** -- it sits under *For the desktop*, and
the desktop still has none. Do not tick it.

### 2. Auto-OCR when a scan opens: decided, not built

Kat: "We need this feature to deploy automatically upon opening a text without
text." She opened a scan, Mimick detected it and said so, and then waited for a
click she did not know to make.

**Her decision, taken this session: auto-run below a page threshold (~20
pages), and above it offer a real button rather than start ~20 minutes of work
unasked.** The 598-page book is about 2 s a page, and `applyRecognised` ends in
`openBytes`, which reopens the document -- so an unattended auto-run on a long
book would also yank the page out from under a reader mid-sentence.

Where the wiring goes, all found but none written:

- `js/reader.js:414`, in the open path, just after `doc.textless` is settled
  and the "kept from last time" branch. Start there, **but let the open finish
  first** (`voice.open`, `setReadable`, `notes.open`, `find.opened`) and kick
  OCR off after, so a failed recognise still leaves a properly opened document.
  The existing stored-text branch returns early instead; that is fine for it,
  because `openBytes` re-runs the open, but it is not a pattern to copy here.
- The long-book offer needs a real control in the bottom bar. `offer()` /
  `withdraw()` at `js/reader.js:134` are the shape to copy, but **do not reuse
  `#status-file`** -- that is an `<a download>` for blocked downloads. Add a
  sibling button (`#status-do`) beside it in `reader.html:852`, with CSS next
  to `#status-file` at `reader.html:98`.
- `recogniseText` (`js/reader.js:467`) already guards on `ocr.running` and
  writes its own status, so it can be called as-is.
- The help text at `reader.html:768` already says Reading ▾; it will need a
  word about it happening by itself.

This touches served files, so: re-stamp `sw.js`, and run `check_ocr`,
`check_scan`, `check_reader` and `check_display` -- one at a time, they share
Chrome's port 9333.

### 3. A sentence that should have been read was skipped -- open question

Kat, on a scanned reading **not on this machine**:

> Principals and school staff thus disciplined children as they saw fit, with
> records showing that students experienced a litany of abuses including
> chaining and shackling; being locked in small, dark spaces; having their
> heads shaved; and being severely beaten with whips and fists

The sentence was checked against every content filter and **passes all of
them**: `is_front_matter` false, no link, `_LONG_WORD` matches, 280 characters
against `MAX_SENTENCE_CHARS` 320. So it never reached `is_readable_run` -- it
was dropped a level up, when `layout.analyse` classified its region.

The strong suspect is **`_mark_references`** (`py/layout.py:214`): past
`REFERENCES_FROM_SHARE` (0.5) of the document, the first region whose whole
text matches `_REFERENCE_HEADING` marks itself **and every region after it to
the end** as not worth reading. Right for a journal article, wrong for a book
with per-chapter endnotes, where a "Notes and References" closing chapter 4
silently kills chapter 5 onward. After that: `_mark_footnotes`
(`py/layout.py:279`, needs three signals to agree), then an `ASIDE` mis-cut
(`py/layout.py:487`, narrower than 62% of the main column and beside it).

**Kat was given two tests and the session ended before she ran them.** Ask her
for the answer before touching anything:

1. **Reading ▾ → untick "Clean up text for reading."** That flag is what
   `py/document.py:344` passes as `skip_references`, so with it off
   `_mark_references` never runs. If the sentence comes back, the cause is
   confirmed with no further digging.
2. **Ctrl+R** on that page. Every region is drawn with a visible tag and the
   full reason on hover (`js/reader.js:1729`). The tag names the culprit:
   `reference list`, `footnote`, `side note`, `header or footer` -- or a
   **number**, which would mean the region *is* set to be read and the fault is
   in reading order or the voice, not in layout at all.

Two things follow whatever the answer. Clicking a skipped box turns it back on
and is remembered per document, so she is not stuck meanwhile. And `layout.py`
is shared (`py/PORTED-FROM.txt` -> `8c94f1b`), so **any fix is written in
`../Mimick-linux` first** and brought over with `tools/port.sh`.

If the tag comes back `side note` or `footnote`, this and item 2 are the same
piece of work: a text layer written by `reader.add_text_layer` is word boxes in
Helvetica, far rougher than a born-digital PDF's, and it is what
`layout.analyse` then cuts into regions.

## Start here: waiting on Kat to test, then push (21 September, end of day)

**Nothing from 21 September is pushed.** GitHub's `master` is still `1753eef`
(checked with `git ls-remote`, not just `origin/master`); local `master` is
ahead of it by what `git log --oneline origin/master..master` lists -- nine
commits of work, below, and the docs that describe them. Pushing deploys to
Pages with no staging, so it is
Kat's call. She was part-way through testing in Chrome when the session ended;
the last thing she asked for -- a progress bar -- is done and waiting for her
to look at.

**Before any push:** `node tools/check_firefox.mjs --voice`, a few times. That
has been owed since 20 September (see below) and is still not done. It fails
about one run in three on its own polling while the page reloads; that is not
a fault.

### What the nine commits of work are

- `f186dfe`, `0997cc0` -- Norman in the first download (20 September; below).
- `75cd5c1`, `ffc4db5`, `13a7400`, `39733c5`, `9c19464` -- more kinds of file,
  and the MuPDF layout hang (the next section).
- `5e927d9` -- **a bar from the moment a file is chosen, whatever kind.**
  Kat opened her 67-slide deck and it was "pretty slow" -- and silent: the bar
  only started once there was a PDF to open, so the seconds spent laying the
  file out as one showed nothing. Now laying out is the first half of one bar
  and opening the second, so it never drops back to nothing between them. A
  deck counts its slides ("Slide 42 of 67") through an optional `progress`
  callback on the shared `slides.py` (desktop `8c94f1b`); the worker posts
  `{ type: "progress", id, done, total }` and `ask` hands those to an
  `onProgress` rather than taking one for the answer. The other kinds have
  nothing to count and creep towards halfway. `check_documents` covers it.
  **It makes the wait legible, not shorter** -- the deck is still about nine
  seconds. If Kat finds that too slow even with the bar, making it faster is
  separate work.
- `9691bb2` -- **`sample/` is an allow-list.** See the trap just below.

### A trap, from today: `git add -A` in a public repo

Kat, testing, left two of her own files in `sample/`: a 29 MB lecture deck and
a 10 MB PDF saved from it. A `git add -A` put both into a commit. It was caught
on the next command and amended out before any push; `git log --all` and the
remote both confirm neither is in any commit. They are still on disk in
`sample/`, untracked, because they are hers.

Two things follow. **Stage files by name**, not with `-A`, in this repo. And
`sample/.gitignore` now ignores everything except the samples it names, so
adding a sample means naming it there too.

The mistaken commit still sits in the local reflog and as unreachable objects
in `.git/` -- never pushed, and a push only sends what a branch can reach, so
it cannot leak that way. Clearing it needs a prune, which would also clear 31
other unreachable objects from earlier sessions; that is left for Kat to
decide rather than done here.

## More kinds of file (21 September)

**Committed as `ffc4db5`, not pushed.** Mimick now opens, besides a PDF:
`.docx`, `.odt`, `.rtf`, `.epub`, `.fb2`, `.md`, `.html`/`.htm`/`.xhtml`,
`.txt`, and `.pptx` / `.ppsx` / `.odp` **a page per slide**. Each becomes a PDF
as `.docx` already did, so reading, highlights, notes, Find, the contents panel
and Save a copy all follow -- which is what answers Kat's "converts the thing
into a PDF that we can save".

The conversion is shared code, so it was written in `../Mimick-linux` first
(`849d778`, `e43be34`) and brought over with `tools/port.sh`, which now carries
`slides.py` as well. **Never edit `py/convert.py` or `py/slides.py` here.**

`tools/check_documents.mjs` covers all seven document kinds and both deck
kinds and passes, as does `check_offline` with `py/slides.py` in the precache;
`check_text`, `check_convert`, `check_recent`, `check_reader`,
`check_contents`, `check_find`, `check_tour`, `check_access`, `check_forget`
and `check_display` were run because `js/reader.js` and `reader.html` changed.

Four things worth knowing:

1. **The name decides what a file is; its type only answers for a file with no
   useful name.** A `.md` arrives as `text/plain` from most places, and the old
   `openFile` asked "is this text?" first -- so a Markdown file would have been
   laid out as plain text with every heading lost.
2. **A deck takes seconds.** Kat's 9.5 MB, 32-slide deck opens in 5.3 s here
   and her 29 MB, 67-slide one in 9.2 s, both without an error. When this was
   written the page said nothing for all of it; it now has a bar that counts
   the slides (`5e927d9`, in *Start here*). The seconds themselves are
   unchanged.
3. **A document MuPDF will not finish used to hang the worker** (`39733c5`,
   from the desktop's `6099dda`). Its `Story` can reach a point -- a table it
   cannot fit -- where `place` asks for another page, puts nothing on it, and
   still says there is more to come, for ever. The loop had no end, so it
   filled memory: 400 empty pages in half a second, and in this app that is
   the reading worker gone. Now the loop is bounded, and a story that does not
   finish is laid out again with its tables as rows of words, which is the one
   thing found to stop it. Found by running the converters over every `.md`,
   `.html` and `.rtf` on this machine -- one real 125 KB file of release notes
   did it, and it was silently giving back 58% of itself before that. Worth
   repeating for any new kind: the samples in `sample/` are small and tidy,
   and real files are neither.
4. **`check_documents.mjs` reads the page count, not the status line.** "Ready
   to work offline" lands on the status just as a file opens, and which file it
   lands on is a matter of timing -- it failed on the `.odt` once that way.
   `check_firefox.mjs` already avoided the status line for the same reason.

Limitations to tell people about, and the three decisions still waiting on Kat
(LibreOffice or ours on the desktop, speaker notes, `.doc`), are in
`../Mimick-linux/docs/MORE-FILE-KINDS.md`. None of the three change this app.

What is owed before a push, and how far ahead `master` is, are in *Start here*
above; this section was written before the progress bar and is not kept up to
date on either.

## Before that: the voice comes down with the app (20 September)

**Committed as `f186dfe`, not pushed.** Kat asked for Norman to be part of the
first download, so Mimick always reads offline; she stopped the session for a
restart before the last check finished. What to do first: **run
`node tools/check_firefox.mjs --voice` a few times** (see below), then push if
it is happy -- pushing deploys, and the rest of the work is tested.

- **What changed.** `keepDefault` in `js/voice-picker.js` now keeps the voice
  *engine* as well -- ONNX Runtime and the phonemizer, `ENGINE` there, 33 MB,
  fetched through `sw.js` so it keeps them as they pass -- and then Norman.
  `readyNow` in `js/reader.js` starts it as soon as Python is up and only calls
  `MimickOffline.complete()` when it finishes, so the voice and the rest of the
  offline copy do not share a slow line. `watchDefault(fn)` reports
  `{ busy, loaded, total }` as it goes; `KEEP_BYTES` is 96.7 MB, the files'
  sizes as read.
- **The bar carries on into it**, in the corner (`#loading.aside` in
  `reader.html`) because the reader works meanwhile: "Downloading Norman's
  voice… 40 of 97 MB". The start-up stage is unchanged.
- **Read aloud during it waits on the same download** -- `beforeLoad` in
  `js/read-aloud.js`, which `js/reader.js` gives
  `MimickVoicePicker.keepDefault` for the default voice -- rather than fetch a
  second copy of a 61 MB model. Whatever `beforeLoad` settles to, the worker
  then loads the voice, so a failed page download still falls back to the
  worker's own.
- **Measured**, throttled 20 Mbit/s, fresh profiles, every file fetched once in
  Chrome and Firefox: Ready at ~20 s, the voice in at ~55 s, first word 6.8 s
  after pressing Read. With the server stopped and the profile kept, a reload
  reads aloud in 7.4 s -- the offline promise, tested.
- **What "Getting the voice ready…" is**, since Kat asked: on a first visit
  almost all of it is the download; after that it is ~3.3 s to read the 61 MB
  model from the cache, hash it and build the ONNX session, then ~3.4 s making
  the first sentence's audio (that part now says "Starting to read…"). Warm, on
  a 12-core machine, 6.9 s from Read to the first word lit.
- **Checks:** `check_display`, `check_convert`, `check_media`, `check_offline`,
  `check_tour`, `check_say` pass. **`check_firefox.mjs --voice` is flaky, and
  was before this work**: it fails perhaps one run in three with
  `can't access property "textContent", document.getElementById(...) is null`,
  which is `wait()` running a script while the page is reloading (the
  first-visit isolation reload, or the offline update that a page nobody has
  used yet takes straight away). **It fails the same way on `1753eef` without
  these changes** -- proved by running it from a copy of that commit. The
  honest fix is for `wait()` and `js()` in that tool to treat a missing element
  as "not yet" rather than an error. Nobody has done that yet.
- **Not done:** Norman is still only *loaded* when you first press Read;
  warming the voice worker in the background after the download would make the
  first Read instant, at the cost of memory and CPU on a page that may never
  read. Kat has not been asked. Also untried: Edge on Windows, and whether
  `navigator.storage.persist()` is granted in Firefox without a prompt.

## Before that: the first download stalled (19 September)

Kat, on **Windows, in Firefox and in Edge**: the start-up bar ("Getting Mimick
ready…") stopped partway through the first visit's download, and a refresh
made it leap ahead. Two causes, both fixed in `2e8fd82` and deployed:

- **The bar never measured the download.** It moved only when a worker finished
  a step (runtime 40%, PDF library 90%) and crept at most 20% past it, so on a
  slow line it sat near 60% through the whole 18 MB PyMuPDF wheel. A refresh
  "gained progress" because the finished files came back from the cache. Now
  **each Python worker counts the bytes it reads**: `js/download-count.js` wraps
  the worker's `fetch` until Python is up and posts `{ type: "downloaded",
  bytes, open }`; `showLoading` in `js/reader.js` shows the furthest worker's
  count against `DOWNLOAD_BYTES` (29.7 MB, the files' own sizes -- the count is
  after gzip) as 85% of the bar, then the steps. It says "Downloading Mimick…
  14 of 30 MB" only while a fetch is open (Python boots between the runtime and
  the wheel, and a warm start reads the cache in a blink), and after 20 seconds
  with no bytes says so. **If the vendored Pyodide or wheel changes, update
  `DOWNLOAD_BYTES`** -- off only scales the bar, and it never passes full.
- **Firefox downloaded the wheel four times**, once per Python worker, all at
  once: the service worker missed its cache for each and Firefox's HTTP cache
  did not merge them (Chrome's does). 72 MB instead of 18, and 137 s to Ready
  at 5 Mbit/s against Chrome's 50; once, a worker then failed `import pymupdf`.
  At 20 Mbit/s they happened not to overlap, which is why it hid. `sw.js` now
  keeps `fetching` (path → promise): the first miss fetches and caches, the
  others await it and answer from the cache. A reload mid-download keeps it
  going, since the service worker's `waitUntil` outlives the page.

Measured with fresh profiles against a copy served like GitHub Pages (gzip,
`max-age=600`) on a throttled link, logging every request: at 5 Mbit/s,
**Firefox 54 s and Chrome 49 s to Ready, every file fetched once**, the bar
rising with the megabytes. `check_offline`, `check_firefox` and
`check_documents` pass. **No check covers the bar itself**; to see it, throttle
the link (a small Python server that sleeps between chunks does it) and open
`reader.html?release` in a new profile -- `?release` matters, since on
localhost the service worker otherwise fetches fresh and skips the path above.

**Not done:** Edge on Windows was not tried here (Chromium, so it should behave
as Chrome). Right after Ready, Mimick still downloads Norman (58 MB, no
progress shown -- `keepDefault` in `js/voice-picker.js`) and the rest of the
offline copy; on a slow line that competes with opening the first document.
`TESTING.md` has a section for Kat's Windows machine.

## Before that: the first report from outside (17 September)

Someone tried the live site **in Firefox, on their own computer**. Four things
came back, and the fixes are in and deployed:

- **"Slow to load, almost didn't."** *(The voice's own download now follows
  Python's -- see the 20 September section above.)* In a real Firefox window here, one first
  visit sat on "Getting ready…" for 85 seconds with nothing moving; warm visits
  take about 9 seconds on a 12-core machine. Four Pythons load ~30 MB each
  before the reader is ready. **There is now a progress bar** (`#loading` in
  `reader.html`, `showLoading` in `js/reader.js`): it is in the HTML from the
  first paint, and comes back while a document opens until the pages on screen
  are drawn. (It first moved only on the steps each worker reported; since 19
  September it counts the bytes -- see *Start here*.)
- **"Pages first load entirely blank; zoom out and they show."** **Not
  reproduced** -- Firefox 154, headless and in a real window, at 1×, 1.33× and
  1.5×, small window, and opening a file before the reader was ready. Two
  guards went in instead: a page that is not drawn yet says **"Drawing this
  page…"** under the canvas (`.page::before`), and **a failed draw is tried
  twice more** rather than never again at that zoom (`retries` in
  `js/reader.js`; it used to be one failure and blank until the zoom changed).
  **If it comes back, the question to ask is whether that text is showing**:
  showing means the drawing never finished, missing means Firefox is not
  putting the canvas on screen (then get the Firefox version and the screen
  scaling).
- **"Highlights aren't in the column; a new note shows and disappears."**
  Reproduced and fixed. The column listed only the page a third of the way down
  the view, so a note one page up vanished as soon as the view moved.
  `renderCards` now takes `ctx.pagesShown()` -- every page with any of it on
  screen -- and sorts by page, then position.
- **Undo.** `Ctrl`+`Z` already went back 50 steps; **`Ctrl`+`Y` now redoes**,
  and the menu and the keys dialog say so. `Ctrl`+`Shift`+`Z` still works.
  Nothing in the code has ever used `Ctrl`+`Alt`+`Z`. Undo covers highlights
  and notes only.

Also: **Show reading order** was already off unless turned on
(`mimick-show-order`), and `check_notes` grew two cases (`Ctrl`+`Y`, and two
pages on screen). `check_notes` had been looking for the desktop's venv at
`../Mimick`, which is this folder now; it is `../Mimick-linux`.

**What to do next:** `docs/TESTING.md` has a new section at the top for the
computer that saw the blank pages. Until that comes back, the blank pages are
the one open bug.

## Before that: the night of 17 September

Kat asked for the launch work to be done overnight, from
[`ROADMAP.md`](ROADMAP.md). Two sessions worked on it, one after the other.
**Everything is committed and every check in *Running it* passes.**

**Ship 1 is done**, all of it:

- Item 0, the review fixes -- *The 17 September review*, below.
- Item 1, **Find** (`Ctrl`+`F`): `js/find.js`; `find` and `found_on` in `reader.py`.
- Item 2, **offline and install**: `sw.js`, `js/offline.js`, `manifest.json`,
  `icons/` -- see *Offline*. **Re-stamp after every change:**
  `python3 tools/stamp_offline.py`.
- Items 3 and 4, **How to use, Browsers, Privacy**, in `README.md` and About.
- Item 5, **`.txt` files**: laid out as a PDF by `reader.text_to_pdf`.
- Item 6, **a PDF with no text** says so.
- Item 7, **Save a copy (PDF)** and **Export notes** (Markdown), in File ▾.
- Item 8, **media keys** and the browser's media controls.
- Item 9, **voice credits** in About.

**Since then, 17 September evening: the guided tour** -- **Show me around** on
the front page, **Help ▾ → Take the tour** afterwards. Fourteen steps on the
sample poem, done with the reader's own keys. `js/tour.js`,
`tools/check_tour.mjs`, and *The tour* below.

**And from Ship 2**, in the second session:

- **The contents panel** (the PDF's bookmarks, `F9`), with a tab on the page's
  edge to bring it back, and the same for the notes panel -- asked for by Kat.
- **Word, OpenDocument and EPUB** files, laid out as PDFs.
- **Each document's place and zoom kept**, and **Forget this document**.
- **Open Recent**.
- **Accessibility, first pass**: a light theme following the system (Display ▾ →
  Theme), less motion, names on every control, the contents tree's keys.
- **How to say words**: a pronunciation list.
- From Ship 3: **OCR for scans** (whole or half-scanned), **a sleep timer**, and
  **Firefox** checked by script (`check_firefox.mjs`).

**For the next session, in order:** (1) whatever Kat found in `TESTING.md`'s
new sections -- check for `docs/TESTING DONE.txt` first; (2) read aloud while a
long document opens, from the plan in `ROADMAP.md`, *with Kat*, since it changes
the desktop's `document.py` -- check that repo's `git status` for another
session's work before touching it; (3) what is left of Ship 3 (skip back 10
seconds; OCR ahead of the reading instead of all at once; other languages, not
wanted yet). Work flows as before: desktop first for shared code, then
`tools/port.sh`; re-stamp after changing any served file; run one browser check
at a time (they share Chrome's port 9333).

**Done, 17 September: choosing voices on purpose** (asked for by Kat; the
decisions are under *Decided*). `js/voices.js` holds the fetching, hash check,
`kept`, `keptKeys` and `remove` (moved out of `piper-worker.js`), and marks
Norman `mp3: true, bundled: true`. **Norman's model ships in `voices/`**
(`en_US-norman-medium.onnx`, 64 MB, hashes as pinned), served beside the app
rather than from Hugging Face, and deliberately **not** in `stamp_offline.py`'s
list: the app cache is refilled whole on every new version, so 64 MB would come
down again with each update. Instead `MimickVoicePicker.keepDefault()` copies
it into `mimick-voices-v1` (versionless, hash-checked) once Python is up, on
every host, and asks for `navigator.storage.persist()`. `js/voice-picker.js`
is the picker (`#voices-dialog` in `reader.html`); `fillVoices` in
`js/reader.js` builds the voice box from Norman, the kept voices and the voice
chosen, then *Select a new voice…*; `#voice-sample` is gone. Convert lists only
`mp3` voices, with `#convert-voice-note` when the reading voice is another.
Checks: `check_display` (the box, the picker, Norman kept), `check_convert`
(Norman alone), `check_media`, `check_offline`, `check_voice` pass.

**Not done from Ship 2: read aloud while a long document is still opening.** It
needs `Document` in the desktop's shared `document.py` to build page by page
with word indices identical to a full build (desktop trap 9), then a port. Too
risky to change unattended in code both apps share; it is the next big item,
best started with Kat. **A worked-out plan, with measurements, is in
`ROADMAP.md`**, Ship 2. (The desktop repo had uncommitted changes from another
session that night -- `docs/HANDOFF.md`, `mimick/engines/piper.py` -- left alone.)

**Still for Kat (written before the launch; item 1 is the only one left open):**

1. The git history (review item 4 below: author email, a book title in old
   diffs, the old journal article). **Kat chose one fresh commit.** The repo
   went public with its whole history on 17 September, so this is a rewrite
   after the fact: build a parentless commit from `master`'s tip
   (`git checkout --orphan`, or `git commit-tree "$(git rev-parse master^{tree})"`),
   then force-push it over `master` and remake the `v1.0.0` tag and release on
   it. Rebuild it from the tip at the moment of the push, not earlier, or the
   commits made since are dropped. The old history is kept locally, on branch
   `history-before-launch` and in `../mimick-history-before-launch.bundle`
   (101 MB, outside the repo). GitHub can still serve the old commits to
   anyone holding their exact hashes for a while afterwards.
   **It is ready to run: `../mimick-squash-and-push.sh`** (19 September), with
   `../mimick-launch-message.txt` as the commit message and
   `../mimick-release-notes.md` for the release. It rebuilds the commit from
   `master`'s tip at the moment it runs, warns and lists anything uncommitted
   first, force-pushes with a lease, moves local `master` with `reset --soft`,
   remakes the tag, and prints the two `gh` commands for the release.
   **Kat runs it herself** -- a session's permission classifier blocks the
   force-push, and no session should try to work around that.
2. `sample readings/` is already gone from this folder (checked 17 September).
3. Try it in Firefox and Safari by hand. **Firefox 154 was driven by script on
   17 September** (`firefox.geckodriver` is on this machine: start it on a port,
   POST `/session` with `-headless`, then WebDriver): it went cross-origin
   isolated, cached itself for offline, opened the test paper and the `.docx`,
   showed the contents panel, found text, downloaded Norman and read aloud with
   the word lit. **`tools/check_firefox.mjs`** now does that and more
   (highlight kept over a reload, Save a copy and Export notes as downloads, a
   Word file; `--voice` to read aloud) -- all pass. Not tried there: Convert to
   MP3, media keys. Safari: nothing. **A person did try Firefox on their own
   computer on 17 September** -- what came back, and what was done about it, is
   in *Start here*.
4. Work through the new sections at the top of `TESTING.md` -- every one of
   tonight's features is checked by a script, which says it works, not that it
   feels right.
5. The highlight colours and colour blindness: measured, left as they are (they
   are the desktop's too). Numbers in `PARITY.md`, *For the desktop*.
6. Several features are browser-only now and listed in `PARITY.md`, *For the
   desktop*: whether the desktop wants them.
7. ~~Display ▾ has grown long~~ -- split on 17 September, as Kat asked: see
   *The menus, reorganised*, with the four additions Kat approved.

### The menus, reorganised (17 September, asked for by Kat)

- **Night (dark) is the default theme.** `mimick-theme` absent or `"dark"` is
  Night; `"light"` is Day; `"system"` follows the computer. The light colours
  now apply under `html[data-theme="light"]`, or `data-theme="system"` with a
  light system. Display ▾ → Theme: Night, Day, Match the system.
- **Reading ▾** (new, `readingMenu` in `js/reader.js`): Stop reading, How to say
  words, the four reading switches, Show / Reset reading order. **Display ▾**
  keeps only Theme, the two panels and the highlight buttons' place, and zoom.
- **The quick switches** (`#switches`), a strip under the top bar opened by the
  ⌄ button at the bar's right end (`#switches-toggle`, kept as
  `mimick-switches`, closed at first). Night/Day, Clean up, Skip citations,
  Read footnotes, Click to read, the timer (opens its choices, shows the one
  set), Contents, Notes, Highlight buttons. Inline SVG icons; below 1150px only
  the icons show. Each mirrors a menu entry, so `showSwitches` redraws after
  every click or key anywhere (a capture listener, `setTimeout`), and when the
  timer stops or the theme changes.
- **Mimick's name** moved to the bottom bar's left end, and **the document's
  title** to the bottom bar's right, beside the zoom (the top bar was crowded).
  **The voice box** is 13em (10em below 1150px); the open list is as wide as
  its longest entry, so the descriptions still show when choosing.
- **Reading ▾ additions** (Kat approved): *Read from the top of this page*
  (`readThisPage`, the document worker's `firstSentenceOn`); *Back 10 seconds*
  (`voice.back(seconds)` in `js/read-aloud.js`: within the sentence playing if
  it has been going that long, else into earlier sentences, made again to know
  their length -- natural-pace seconds, as a podcast player; `Shift`+`←` while
  reading, and the media session's `seekbackward`); *Go to where the voice is*
  (`goToVoice`); and *Recognise text in this scan* moved here from File ▾.
  `tools/check_back.mjs`.
- **Ctrl+Enter in the note editor** already saved and closed; `check_notes` now
  presses it from inside the note box (Kat asked).
- **`check_sleep` was fixed, not the app** (17 September): it pressed → every
  0.7 s, faster than the voice (Norman, medium) makes a sentence, so the skips
  piled up and stalled at sentence 2 -- on an unchanged HEAD too. It now waits
  for each sentence to start before the next press (`skipUntilPaused`). The
  full suite, all 25 checks including Firefox, passed afterwards.
- **Layout fix found on the way:** `body` was a five-row grid, and with the
  highlight strip hidden the page area landed in an `auto` row (220px tall on
  the empty page) while the footer took the `1fr`. `body` is now a flex column
  with `#main { flex: 1 1 0 }`.
- Checks: `check_display` covers Reading ▾, Display ▾'s new contents and the
  strip; `check_access` the Night default; `check_order`, `check_say`,
  `check_sleep` open Reading ▾ now.

### How tonight's pieces work

**The contents panel** (Kat asked for it directly). The PDF's bookmarks on the left, `js/contents.js`. The outline comes
from the *page* workers (`pages.outline`, in the `open` reply), so it shows as
soon as the pages do, not after the sentences. Click an entry to go to its
heading; right-click for *Start reading from here* (`reader.first_sentence_from`).
The entry lit is the last heading above a third of the way down the view,
except that a clicked entry stays lit until the view moves (several short
sections can share a screen). A short outline (60 entries or fewer) opens in
full; a longer one follows the file's own open/closed flags. In a window where
the page would keep less than 600px beside the notes panel, it opens tucked
behind its tab (`crowded`), without changing the kept choice. **Toggle: `F9`,
Display ▾, the panel's ‹, and a "Contents" tab on the page's left edge** --
Kat left the placement to us; the tab is on the page itself so it is found
without the menus, and stays (greyed, with a tooltip) for a PDF with no
bookmarks. The notes panel got the same: a header with **›**, and a "Notes"
tab on the right edge. `#main`'s children are placed in named grid columns so
a hidden panel does not let the page slide into its column. `F9` because
Evince uses it for the side pane and Chrome leaves it free (`Ctrl`+`Shift`+`B`
is the bookmarks bar). The test paper now has bookmarks
(`tools/make_test_paper.py`, regenerated); `tools/check_contents.mjs`.

**Item 6, a PDF with no text: done.** No words at all: "This PDF has no text
to read — it may be a scan without OCR", in the status line and on Read
aloud's tooltip. Words but no sentences (every region skipped): "Nothing here
is set to be read — Display ▾ → Show reading order". That second case used to
be stuck: every reading-order and switch path asked `!doc?.sentences`, which
is true for 0 as well as for not-built-yet. They now ask `built()`
(`doc.sentences != null`); `togglePlay`, Convert and reading still want at
least one. `tools/check_scan.mjs` makes its PDFs in the worker's PyMuPDF.

**Item 7, Save: done.** File ▾ has **Save a copy (PDF)…** (`Ctrl`+`S`) and
**Export notes…**; Notes ▾ has both. `saveFile` in `js/notes.js` opens Chrome's
save window first (it must be inside the key press) and writes once the PDF is
made; without `showSaveFilePicker` it downloads, which is what `check_notes`
takes (it deletes the picker, as `check_convert` does). Export is Markdown:
`# Notes: title`, then `## Page N · section` (from the contents panel's
`sectionAt`), the passage as a `>` quote, the colour only if more than one of
Mimick's four is used, the heading in bold, the note.

**Item 8, media keys: done.** The Media Session API, plus `keydown` for the
`Media…` keys when the page has focus. Chrome only routes hardware media keys
and shows its media controls for a page playing a *media element*, and the
voice is Web Audio, so a half-second silent WAV (made in JS, no file) loops in
an `<audio>` while reading and pauses with it. If Chrome refuses to start it,
nothing breaks; the page's own keydown still works. Metadata: the document's
title, "Mimick · voice". `tools/check_media.mjs` shares `check_convert`'s
profile to reuse its downloaded voice -- run `check_convert` first on a new machine.
**Needs a person:** real media keys from another tab, and a Bluetooth headset.

**Item 9, voice credits: done.** About → *Voices*: a table of voice,
recordings (dataset, licence, link) and the voice it was trained on, from each
voice's `MODEL_CARD` in `rhasspy/piper-voices` at the pinned revision. Joe,
Kusal, VCTK and LibriTTS say "Lessac" without its licence, as Kat decided to
keep them (see *Next*, item 0).

**Ship 2, first item: Word, OpenDocument and EPUB, done.** `document_to_pdf`
in `reader.py`. MuPDF 1.28 (Pyodide's wheel too) opens `.docx` and `.epub`
natively as reflowable documents: `apply_css("@page { margin: 72pt } body {
margin: 0 }")`, `layout(a4, 11pt)`, `convert_to_pdf()`, and the source's
`get_toc()` put back with each entry pointed at its heading by searching for
its words. MuPDF cannot open `.odt`, so `_odt_html` reads `content.xml` into
simple HTML and `_story_pdf` sets it (the `.txt` path shares `_story_pdf` now),
collecting headings for the outline from `Story.element_positions`. No new
library, nothing in `vendor/`. Test files: `sample/test-document.*`, made from
`tools/test-document.html` by `tools/make_test_documents.sh` (LibreOffice;
checked for personal metadata -- none). Known rough: bullets, table borders,
images untested, Word footnotes untested.

**Ship 2: scroll and zoom per document, and Forget: done.** `keepView` (from
`refresh`, 400 ms after the last move) writes `mimick-view:<key>` = `{page,
fraction, zoom}`; `openBytes` puts it back in its first `relayout`. A document
never seen opens at its top at the zoom in use. **File ▾ → Forget this
document…** opens `#forget-dialog`; *Forget it* calls `closeDocument()` (bumps
`generation` first, so a notes save in flight lands before the delete) and
removes `mimick-position|order|view:<key>`, `MimickNotesStore.remove`,
`MimickPageStore.forget`. `closeDocument` is also the way back to the empty
page, should anything else need it. Checks that click a page now set
`mimick-click_read` to `0` first, or the click starts the voice downloading.

**Ship 2: Open Recent, done.** `js/recent.js` keeps up to eight
`FileSystemFileHandle`s in IndexedDB (`mimick-recent`); File ▾ shows five.
Handles come from `showOpenFilePicker` (now what **Open…** and `Ctrl`+`O` use
where it exists -- the `<input>` is the fallback and what the checks drive), a
drop (`getAsFileSystemHandle`, asked for synchronously in the drop handler), and
`launchQueue`. Opening one asks `queryPermission`/`requestPermission` inside the
menu click; a file since moved says so and leaves the list. Forget removes a
document from the list by its file name. `check_recent` makes handles in the
origin private file system, since headless Chrome has no open window.
**Needs a person:** the permission prompt on a real reopen after a restart.

**Ship 2: accessibility, the first pass, done.** Colours are tokens on `:root`
(dark, the desktop's) with a light set applied by `prefers-color-scheme: light`
unless `html[data-theme="dark"]`, or always by `html[data-theme="light"]`. An
inline script in `<head>` puts the kept `mimick-theme` on `<html>` before the
page draws; **Display ▾ → Theme** sets it (`setTheme` in `js/reader.js`), and
the `theme-color` meta follows. The PDF page stays white. `prefers-reduced-motion`
stops the cursor blinking. Every glyph button (‹ › ↶ ↷ ⚙ ▶ − +) and every box
now has an `aria-label`. **The highlight colours were measured for colour
blindness, not changed** (they are shared with the desktop): the numbers are in
`PARITY.md`, *For the desktop*. `tools/check_access.mjs`.

**Ship 3: OCR.** `vendor/tesseract/`: tesseract.js 7.0.0's `tesseract.min.js`
and `worker.min.js`, core 7.0.0's `tesseract-core-simd-lstm.wasm.js` (named
exactly, so tesseract.js does no feature detection and fetches nothing else --
every target browser has SIMD) and `eng.traineddata.gz` from `4.0.0_best_int`;
no CDN (`workerBlobURL: false`, `cacheMethod: "none"`, absolute paths). `js/ocr.js`
renders each page through `pool[0]` at about 2200 px across, gives Tesseract a
PNG, and keeps words with their *line's* top and bottom so a line's boxes sit
level. `reader.add_text_layer` writes each word with `render_mode=3` in Helvetica,
sized so its font box is the line's height and `morph`ed to the word's width --
MuPDF then gives back exactly those rectangles. The result opens under the
**same key**, so drawn pages, place and notes carry over; the words go in
IndexedDB `mimick-ocr` under that key, and `openBytes` puts them back itself
when a PDF with no words has some kept (never with an empty result, or it would
loop). Forget removes them. **Half-scanned PDFs too:** `open_document` answers
`textless` (`pages_without_text`: no words, and an image), and only those pages
are recognised; the status line says how many are pictures. Pages tried and
found blank are not offered again. What is kept is merged per page. The test paper, scanned at 150 dpi, comes back as
the same 29 sentences in about 6 s. Rotated pages: `derotation_matrix` and
`rotate` are used but untested.

**Ship 3: the sleep timer.** Display ▾ → Stop reading. `setSleep` keeps
`{kind, label}`; minutes set a `due` flag after the time, page and section
remember where reading was. `sleepDue` runs in `onSentence` as each sentence
starts and pauses there (`sleepStopped` keeps the usual "Paused" line from
overwriting its own). Resuming now puts the sentence's line back
(`sentenceStatus`). Cleared on open and close.

**Ship 2: How to say words, done.** `js/pronounce.js`: a list of `[word,
sayAs]` in `localStorage` (`mimick-pronunciations`). The page sends it with
every `speak` (`read-aloud.js` via its `pronunciations` option, `convert.js`
via `ctx`); `piper-worker.js` swaps whole words (Unicode-aware, any capitals)
before phonemizing and `unswap`s the marks, so `align_marks` still finds the
printed word -- a sound-alike of several words is hyphenated to stay one word
to the timing, and "foo-koh's" maps back to "Foucault" + "s". A change calls
`voice.remake()`, which drops every clip but the one playing. Dialog
`#say-dialog`; Display ▾ → How to say words…, and right-click on a one-word
selection. `tools/check_say.mjs` (shares `check_convert`'s voice).

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

## The tour, 17 September

`js/tour.js`, `#tour` in `reader.html`, `tools/check_tour.mjs`. **Show me
around** on the front page, and **Help ▾ → Take the tour**. Kat asked for "a
more formal version" of the ghost cursor, on the sample, with a way out and a
Skip in the bottom right.

How it works:

- **Fourteen steps**, each naming what to light up (`spotlight`), what to say,
  and how to tell the reader has done it (`done(now, was)`). A step with `done`
  moves on by itself, so pressing the key *is* the button; one without waits
  for **Next**. `probe()` takes the whole state of the reader eight times a
  second, through getters in `reader.js` -- the tour changes nothing and drives
  nothing, which is why it cannot get out of step with the page.
- **The spotlight is four shades round a hole**, not a hole cut in one box:
  every browser draws it the same, and `pointer-events: none` on them means
  the page is never trapped. What is lit is either a selector (`#play`) or the
  first sentence on the page in PDF points, so it follows scrolling and zoom
  (`ctx.sentenceBox`, `ctx.pageRectToClient`). The reading highlight is torn
  down and drawn again for every sentence, so the spotlight keeps the last
  place it saw rather than blinking (`lastSpot`).
- **The document**: the tour uses whatever is open, and otherwise opens
  `sample/sample.pdf` -- Poe's "The Raven" -- under the key `sample:raven`, so
  practice highlights are kept apart from the reader's own and **Forget this
  document** clears them. The sample is now in the offline cache
  (`tools/stamp_offline.py`).
- **Doing it, not watching it happen.** Three steps cannot be judged by state
  alone, because the reading does the same thing by itself: clicking a sentence,
  moving the cursor, and turning the page. So `reader.js` counts the two
  actions that are always a person's -- `readFromCount` in `readFrom` and
  `pageTurns` in `goToPage` -- and the cursor step asks that the voice is not
  reading. Without that, the steps tick themselves off while the voice reads on.
- **The card is a heads-up display, not a wall**: `pointer-events: none` on it,
  `auto` on its buttons, so a drag across words it happens to cover still
  selects them, and it fades to a fifth while the pointer is down.
- `Esc` leaves, but only when nothing on the page wants it first: a dialog, a
  menu, the find box, or a selection to clear.
- Traps met: the worker's `call` has an allow-list (`CALLS` in
  `js/document-worker.js`), so the sentence spotlight goes through the
  `firstSentenceOn` and `sentences` messages instead; and
  `classList.toggle(name, false || undefined)` *flips* rather than removes --
  `undefined` is not `false` to `toggle`.

Since it was built: **checked again on 19 September against `7acfab8`** (the
`document.py` port and the contents-panel fix) -- `tools/check_tour.mjs` passes
whole, so the port did not disturb the sentence spotlight, which goes through
the worker's `firstSentenceOn` and `sentences` messages. **Kat has it open in
her own Chrome** and has not given her verdict yet; the questions for her are
the section at the top of `TESTING.md`, still unticked. One thing that came up
there and is *not* a bug: her **Show reading order** was on, which is a setting
kept per browser (`mimick-show-order`), so the numbered region boxes were drawn
over the tour.

Left undone, for whoever picks it up: no step for the reading order
(`Ctrl`+`R`), the pronunciation list or OCR -- fourteen steps is already at the
edge of what anyone will sit through, and they are all in About and the
shortcuts list. Nothing offers the tour by itself on a first visit; the button
is there to be found, and `localStorage mimick-tour` says whether it has been
taken, if that is ever wanted.

## Read first

1. [`../README.md`](../README.md) — what this is, how to run it, which way work flows.
2. [`PORT-LOG.md`](PORT-LOG.md) — what each step cost and found.
3. [`PARITY.md`](PARITY.md) — every desktop feature, and which the browser has. **The to-do list.**
4. [`TESTING.md`](TESTING.md) — the checklist for what only a person can judge.
   Sweep it for personal information before it goes public (*To do first*, item 4).
5. [`ROADMAP.md`](ROADMAP.md) — what to build, in order, to ship to classmates.
6. The plan, in the desktop repo: `../Mimick-linux/docs/FUTURE-FEATURES.md`. The
   desktop handoff, `../Mimick-linux/docs/HANDOFF.md`, has the traps that apply to
   the shared reading code.

## Decided

- **Piper voices only**, no Microsoft voices. **English only** for now.
- **Speed caps at 4×**, not the desktop's 5×.
- **Seven voices** (Lessac removed 17 September), listed in `piper.RECOMMENDED` in the desktop repo. Ship
  their sample clips; keep each model in Cache Storage (`mimick-voices-v1`).
  Two of them hold many speakers (109 and 904); a picker for those comes after
  the reader works.
- **Voices are chosen on purpose, not tried by downloading** (Kat, 17
  September). All seven would be about 450 MB, too much to push on everyone
  (small school laptops, capped connections, and most people use one voice).
  So:
  - **Norman is the default and comes with Mimick**: its model is in
    `voices/`, kept in the browser on the first visit, and cannot be removed,
    so there is always one voice, offline too (Kat: "simply pre-downloaded ...
    integrated in regardless"). It is the one voice with no licence question
    (public domain). The faster "low" voices (Kathleen, Southern English) sit
    on Ryan, CC BY-NC-SA, so they don't qualify.
  - **The voice box lists Norman and the voices kept**, and ends with **Select a new
    voice…**, which opens the voice picker (`js/voice-picker.js`), modelled on
    the desktop's `OfflineVoicesDialog`. It shows all seven, each with a ▶ for its shipped rainbow
    clip (nothing downloads to hear one), its size, **MP3 ✓** or **Reading
    only**, and a tick box. Several ticked voices download one after another,
    with progress and a Stop button; a kept voice can be removed, except Norman
    and the one in use. The ▶ beside the voice box goes, since the picker plays the samples.
  - **Convert to MP3 offers only `mp3: true` voices, which today means Norman**,
    with a short note that the other voices read aloud here but their licences
    (non-commercial, share-alike, possibly research-only through Lessac) make
    MP3s to keep or share risky. See `voices/README.md`.
- **Laptop and desktop only.**
- **Work flows one way:** fix in `../Mimick-linux`, then `tools/port.sh ../Mimick-linux`.
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
| `js/ocr.js` | Recognising text in scans with Tesseract, and keeping what was found. |
| `js/pronounce.js` | How to say words: the pronunciation list, swapped in by the voice worker. |
| `js/recent.js` | Open Recent: file handles kept in IndexedDB. |
| `js/contents.js` | The table of contents panel (the PDF's bookmarks), its edge tab and `F9`. |
| `js/tour.js` | The guided tour: the steps, the spotlight, the ghost pointer, the card. It only reads the reader, through getters in `reader.js`. |
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
node tools/check_text.mjs            # the same
node tools/check_contents.mjs        # the same
node tools/check_scan.mjs            # the same
node tools/check_media.mjs           # the same; reuses the voice check_convert downloaded
node tools/check_documents.mjs       # the same
node tools/check_forget.mjs          # the same
node tools/check_recent.mjs          # the same
node tools/check_access.mjs          # the same
node tools/check_tour.mjs            # the same; reuses the voice check_convert downloaded
node tools/check_say.mjs             # the same; reuses the voice check_convert downloaded
node tools/check_ocr.mjs             # the same
node tools/check_sleep.mjs           # the same; reuses the voice check_convert downloaded
node tools/check_firefox.mjs         # Firefox through geckodriver; --voice also reads aloud
node tools/check_offline.mjs         # needs no serve.py: serves a scratch copy on 8732
python3 tools/stamp_offline.py       # after changing any file the app serves -- see Offline
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

## Offline

`sw.js` is the one service worker (it replaced `coi-serviceworker.js`): it adds
the isolation headers and keeps the app in a cache named for its `VERSION`.
**`VERSION` and the file list are written by `python3 tools/stamp_offline.py`,
and must be re-stamped after any change to a file the app serves** -- otherwise
people who have visited keep the old version for ever. `check_offline.mjs`
fails when the stamp is stale. On the real site the cache comes first and a new
version is taken whole: straight away if the tab has nothing open yet,
otherwise from **Help ▾ → Update Mimick**. On localhost the server comes first
and the cache is only the fallback, so edits show on reload (trap 10 still
applies to `python3 -m http.server`); `reader.html?release` makes localhost
behave like the real site. A first visit caches only the small files before the
worker takes over (so the reload into isolation is quick); the rest is kept as
the page loads it, then filled in once Python is up. `index.html` now sends you
to `reader.html`; the old spike page is `spike.html`. Installed as an app, a PDF
opened from the file manager arrives through `launchQueue`.

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
   accessibility. The CC BY / BY-SA / BY-NC-SA credits are in About (done 17 September). The dev checks `check_voice.mjs` and
   `check_timing.mjs` (and the desktop's `check_timing.py`) still use the Lessac
   model already on this machine.
1. ~~Show reading order~~ -- done 17 September; see below.
2. **Read aloud while a long document is still opening.** Read aloud is greyed
   out until every sentence is built -- 45s for the 598-page book. `Document`
   builds them all in its constructor, in the desktop's shared `document.py`,
   so reading early means building page by page (change it there, then port).
   Word indices must stay what a full build gives (desktop trap 9) -- and
   highlights are now keyed to them too. **A plan is in `ROADMAP.md`**, Ship 2.
3. ~~The voice picker~~ -- done 17 September. Nicknames: not wanted for now.
4. ~~Keep scroll and zoom per document, and Forget this document~~ -- done 17 September.
5. ~~Convert to MP3~~ -- done 17 September, bar two small things in `PARITY.md`. ~~Open Recent~~ -- done 17 September.

**From here, `ROADMAP.md` is the list.** Ship 1 is done; of Ship 2 only reading
while a long document opens is left (planned); then Ship 3.

The layout follows the desktop app, Photopea-style; the shortcuts are shared
(`FUTURE-FEATURES.md`, **Shortcuts**).

**State to leave tidy:** `serve.py` may still be running on 8731 from the last
session (started in the background); it is harmless, and restarting it is
`python3 serve.py`. Nothing is pushed anywhere -- this repo has no remote.
