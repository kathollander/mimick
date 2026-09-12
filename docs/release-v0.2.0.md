# Mimick v0.2.0 — it runs on Windows now

Same Mimick, one more operating system. There's no separate Windows edition —
one download, one codebase, and it works out which system it's on when it
starts. Pick the installer for your machine and ignore the other one.

## Installing

**Windows.** Right-click the folder → **Open in Terminal**, then:

```
powershell -ExecutionPolicy Bypass -File install.ps1
```

(The `-ExecutionPolicy Bypass` is because Windows blocks downloaded scripts by
default. It applies to that one command.) Mimick lands in your Start Menu.

**Linux.** Unchanged:

```
./install.sh
```

Either way you need Python 3.10 or newer, and the installer handles the rest —
including downloading ffmpeg on Windows, which doesn't ship with one.

## Heads up: nobody has run this on Windows yet

The Windows support was written and tested on a Linux machine. That sounds
daft, and it partly is, but a fair amount could be checked properly: the
installer is linted and its logic was run, and every component was confirmed to
have a ready-made Windows build for Python 3.10 through 3.14, so nothing has to
be compiled on your machine.

What hasn't been tested is Windows itself. If you're installing this, you may
genuinely be the first person to run it, and **the most likely thing to be
subtly wrong is the word highlighting drifting behind the voice** — Windows
handles audio differently and that timing has never been heard on it. If the
highlight lags, that's a real bug and worth telling me about.

## Also fixed, and this one matters on Linux too

**Save a copy could overwrite the document you had open.** If you picked the
original file's own name in the Save a copy box, Mimick would write over the
PDF it was still reading and truncate it. There was a guard against this, but
it compared filenames as text, so anything spelled slightly differently slipped
past — and on Windows, where `Paper.pdf` and `paper.pdf` are the same file,
it'd be easy to hit by accident.

It now checks whether it's actually the same file and saves in place instead.
If you're on Linux and never touch Windows, this is still the reason to update.

## Everything else

- Settings, voices and ffmpeg go in the proper Windows places
  (`%APPDATA%\Mimick` and `%LOCALAPPDATA%\Mimick`)
- Mimick appears under **Open with** for PDFs, without stealing the default
  from whatever opens them now
- No console window behind the app, and none flashing between sentences
- Settings files are read and written as UTF-8, so an accented name in your
  notes no longer risks resetting your preferences on Windows
- Uninstaller for Windows (`uninstall.ps1`)

Linux behaviour is unchanged. Same 8,395 words read from the test paper as
v0.1.0, same shortcuts, same everything.

## Found a bug?

Very likely! Open an issue. What helps: what you did in order, the PDF if you
can share it, any error text, and whether you're on Windows or Linux.
