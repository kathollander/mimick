# Tabs: several documents open at once

A plan, not started. Kat asked on 21 September 2026 for "a tab system like
Photopea does for multiple documents". Nothing below is decided until she says
so; the questions at the end are hers.

## Why it is worth doing

Besides the convenience, it removes a real hazard. Today the way to have two
documents open is two browser tabs, and that is how two things went wrong on
21 September:

- **Downloads.** Brave (and Chrome, in some states) blocks a download a page
  starts by itself once that browser tab has downloaded before, and never tells
  the page. Fixed separately the same day -- the file now waits in the bottom
  bar as "Not in your downloads?" -- but a single tab of Mimick's own is fewer
  browser tabs for that to happen in.
- **Notes in two browser tabs of the same PDF overwrite each other.** Each
  change keeps the *whole* list of highlights under the document's key
  (`js/notes-store.js`), last write wins. Mimick's own tabs can refuse to open a
  document twice and switch to it instead; browser tabs cannot.

## How hard

It depends on one choice: whether a tab in the background keeps its
document open, or only remembers it.

**The whole app is built around one open document.** `reader.js` has one
`doc` and some sixty variables about it (selection, cursor, pages drawn, the
bar, reading); `reader.py` keeps one `_document` (and `_store`, `_selection`,
`_found`, `_alternate`, `_choices`) as module globals in the one document
worker; the page workers each hold one PDF; notes, find, contents and convert
each assume a single `doc`.

### Recommended: tabs that remember, one document live (about 2 sessions)

Only the tab in front is open. A tab in the background keeps just what it
needs to be opened again: its bytes (the PDF, or the PDF a deck or `.docx` was
laid out as), its name, and its key. Switching tabs calls the `openBytes`
there is today, with that key.

Almost everything a tab would have to remember is **already kept per key**:
the place and zoom (`mimick-view:<key>`), where reading got to
(`mimick-position:<key>`), reading-order choices (`mimick-order:<key>`),
highlights and notes (`notes-store.js`), and drawn pages (`page-store.js`), so
the pages come back from the cache rather than being drawn again. So this is
mostly new code *beside* the reader, not a rewrite of it:

1. **`js/tabs.js`** -- the list: `{ id, name, key, bytes, kind }`, which is in
   front, open / close / switch / move. Refuses a second copy of the same key
   and switches to it instead.
2. **The strip** -- a row of tabs above the page, in `reader.html`: name,
   ×, and `+` to open. Hidden with one document, so nothing changes for someone who never
   opens a second. Drag to reorder; middle-click closes.
3. **Wiring in `reader.js`** -- Open, drop, Open Recent and the tour add a tab
   rather than replacing; `openBytes` gets the bytes from the tab; a switch
   first stops reading and lets the notes finish keeping (they save 700 ms after
   a change -- flush before switching), then opens. Keys: `Ctrl+Tab`, `Ctrl+PageDown`/`PageUp` and `Ctrl+W` all
   belong to the browser and a page cannot take them, so `Alt+1`...`9` to
   switch (check Linux desktops leave them alone), and close with the × or
   File ▾.
4. **Coming back.** Whether the tabs are still there after a reload. Bytes are
   big (Kat's deck is 29 MB), so keeping them means IndexedDB, and the
   browser may evict it; Open Recent's file handles (Chromium only) are the
   lighter way. See the questions.
5. **A check**, `tools/check_tabs.mjs`: open two, switch, place and notes come
   back in each, the same file twice gives one tab, closing the one in front
   shows its neighbour, reading stops on a switch.

**The cost is the switch.** It takes as long as opening: about half a second
for a paper, since Python is already running and the pages are cached; a deck
or `.docx` is laid out once and its PDF kept, so it never pays the nine seconds
again. Undo history does not survive a switch (`notes.open` clears it, as any
open does today) -- worth keeping per tab later if it is missed.

Memory stays as it is today: one document open at a time, plus the bytes.

### Not recommended now: every tab live (many sessions, risky)

Instant switching and reading on in the background, but every one of those
sixty variables moves into a per-document object, `reader.py`'s globals become
a table keyed by document (shared code: desktop first, then `port.sh`), and
the page workers learn which document a page is from. It touches nearly every
line of the biggest file, for a gain of about half a second per switch. If it
is ever wanted, the first plan is a step towards it, not a detour.

## The desktop

`Mimick-linux` is Qt and could have real tabs more cheaply (its document is an
object already). Whether it gets them too, and when, goes in `PARITY.md` once
Kat decides.

## For Kat

1. **Go ahead with the "remember" kind of tab?** (The recommendation.)
2. **After a reload, do the tabs come back?** Keeping every file in the
   browser costs storage (and the browser may clear it); not keeping them means
   a reload shows only the last document, as now.
3. **How many at once?** No limit costs only memory for the bytes; a cap of,
   say, ten keeps a 29 MB deck habit in check.
4. **The desktop too?**
