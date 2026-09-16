# Handoff

Where the browser version stands, for a fresh session. Written 16 September 2026.

## Read first

1. [`../README.md`](../README.md) — what this is, how to run it, which way work flows.
2. [`PORT-LOG.md`](PORT-LOG.md) — what step 1 cost and found.
3. The plan, in the desktop repo: `../Mimick/docs/FUTURE-FEATURES.md`. The
   desktop handoff, `../Mimick/docs/HANDOFF.md`, has the traps that apply to
   the shared reading code.

## Decided

- **Piper voices only**, no Microsoft voices. **English only** for now.
- **Speed caps at 4×**, not the desktop's 5×.
- **Eight voices**, listed in `piper.RECOMMENDED` in the desktop repo. Ship
  their sample clips; fetch a model on first use and keep it in IndexedDB. Two
  of them hold many speakers (109 and 904); a picker for those comes after the
  reader works.
- **Laptop and desktop only.**
- **Work flows one way:** fix in `../Mimick`, then `tools/port.sh ../Mimick`.
  Never edit `py/` here.
- **Nothing from a CDN.** Everything is in `vendor/`.

## Where it stands

- **Step 1, the spike: done.** `node tools/check_spike.mjs` passes — the sample
  reads into the same 71 regions as the desktop app.
- **PyMuPDF is pinned to 1.28.2**, matching the desktop. Pyodide's bundled
  1.26.3 made twelve regions a character longer. Bump both repos together.
- **Not yet run in a real browser tab.** Only under Node. The Claude in Chrome
  connection is not working yet; the desktop handoff has its exact state.
- **Local only.** One commit, no remote. The public GitHub repo is Kat's call.

## Next

**Step 2: Piper in a Web Worker.** One sentence, audible, at 1× and 4×. Print
synthesis time against audio length. Run it with and without
`coi-serviceworker`: the gap is how much threading matters. On an ordinary
laptop this is the step that can still say the port does not work.

Then step 3, word timing with a check tool written alongside it.
