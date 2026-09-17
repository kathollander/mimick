/* Selecting, the text cursor and the right-click menu, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_selecting.mjs
 *
 * Drives the reader with real clicks and keys (tools/cdp.mjs): right-click ->
 * Start reading from here, the cursor following the voice, the arrows and
 * Shift, drag, double-click, Ctrl+A, Ctrl+C, Esc and Enter. The word positions
 * it aims at are the sample's, page 1 -- "whom the angels name", words 106-109
 * of sentence 3 (from 0). The voice must be able to load (fetched once into the scratch
 * profile, about 60 MB).
 */
import path from "node:path";
import { CTRL, SHIFT, root, startReader } from "./cdp.mjs";

const r = await startReader("check-selecting");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(path.join(root, "sample/sample.pdf"));

const state = () => ev(`JSON.stringify({ status: document.getElementById("status").textContent,
  play: document.getElementById("play").textContent, sel: document.querySelectorAll(".hl.selection").length,
  caret: [...document.querySelectorAll(".caret")].map((c) => c.parentElement.dataset.page + "@"
    + parseFloat(c.style.left).toFixed(2) + "," + parseFloat(c.style.top).toFixed(2)) })`).then(JSON.parse);

// 1. Right-click on a word.
const is = await r.at(284, 268);
await r.rightClick(is);
const labels = await r.menuLabels();
check("right-click shows the menu with Start reading from here", labels?.[0] === "Start reading from here", labels);
await r.menu("Start reading from here");
await wait(`document.getElementById("play").textContent === "Pause"`, 60000);
await wait(`/Sentence/.test(document.getElementById("status").textContent)`, 60000);
let s = await state();
check("…and it reads from the sentence clicked (sentence 4)", /Sentence 4 of/.test(s.status), s.status);
await sleep(1500);
check("the cursor follows the voice", (await state()).caret.length === 1, (await state()).caret);

// 2. Pause, then the arrows move the cursor.
await r.key(" ");
await wait(`document.getElementById("play").textContent === "Resume"`);
await r.click(is);          // a click reads again -- so pause after
await sleep(800);
await r.key(" "); await sleep(300);
if ((await state()).play !== "Resume") { await r.key(" "); await sleep(300); }
const before = (await state()).caret[0];
await r.key("ArrowRight"); await sleep(300);
const after = (await state()).caret[0];
check("→ moves the cursor a word while paused", before !== after, [before, after]);
await r.key("ArrowDown"); await sleep(300);
const down = (await state()).caret[0];
check("↓ moves it down a line", parseFloat(down.split(",")[1]) > parseFloat(after.split(",")[1]), [after, down]);
await r.key("ArrowUp"); await sleep(300);
for (let i = 0; i < 3; i++) await r.key("ArrowRight", SHIFT);
await sleep(500);
s = await state();
check("Shift+→ ×3 selects three words", /^3 words selected/.test(s.status) && s.sel > 0, [s.status, s.sel]);
await r.key("c", CTRL); await sleep(400);
const copied = await ev(`navigator.clipboard.readText()`);
check("Ctrl+C copies them", /Copied 3 words/.test((await state()).status) && copied.split(" ").length === 3, copied);
await r.key("Escape"); await sleep(300);
check("Esc clears the selection", (await state()).sel === 0);
await r.key("End"); await sleep(300);
await r.key("Home", SHIFT); await sleep(400);
s = await state();
check("End, then Shift+Home selects the line", /words selected/.test(s.status) && s.sel === 1, [s.status, s.sel]);

// 3. Drag to select.
await r.key("Escape");
await r.drag(await r.at(283, 268), await r.at(390, 268));
s = await state();
check("dragging selects whom the angels name", /^4 words selected/.test(s.status) && s.sel === 1, [s.status, s.sel]);
await r.key("c", CTRL); await sleep(400);
const dragged = await ev(`navigator.clipboard.readText()`);
check("…and copies as 'whom the angels name'", dragged === "whom the angels name", dragged);

// 4. Double-click selects a sentence (words 78-114 = 37 words).
await r.click(is, 2); await sleep(900);
s = await state();
check("double-click selects the sentence", /^37 words selected/.test(s.status), [s.status, s.play]);
check("…and does not leave reading going", s.play !== "Pause", s.play);

// 5. Enter reads the selection.
await r.key("Enter");
await wait(`/Reading your selection/.test(document.getElementById("status").textContent)`, 60000);
check("Enter reads the selection", true);
await r.key(" "); await sleep(300);

// 6. Ctrl+A selects the page; right-click now offers the selection.
await r.key("a", CTRL); await sleep(500);
s = await state();
check("Ctrl+A selects the page", /words selected/.test(s.status) && s.sel > 10, [s.status, s.sel]);
await r.rightClick(await r.at(40, 40));
const offered = await r.menuLabels();
check("right-click off the text: Start greyed, then the selection's own entries",
      JSON.stringify(offered) === JSON.stringify(["(off) Start reading from here", "Read the selection", "Copy",
                                                   "Highlight", "Highlight and write a note…"]), offered);
await r.key("Escape"); await sleep(200);
check("Esc closes the menu", (await r.menuLabels()) === null);
r.finish();
