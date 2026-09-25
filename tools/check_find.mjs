/* Find in document (Ctrl+F), in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_find.mjs
 *
 * Drives the reader with real keys (tools/cdp.mjs) against the test paper
 * (sample/test-paper.pdf): the box opening on Ctrl+F, every match lit and
 * counted, Enter and Shift+Enter stepping and scrolling to another page, Match
 * case, a query that finds nothing, curly quotes and line-break hyphens folded,
 * and Esc leaving the match selected for Ctrl+C. Needs no voice.
 */
import path from "node:path";
import { CTRL, SHIFT, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/test-paper.pdf");
const r = await startReader("check-find");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);

const state = () => ev(`JSON.stringify({
  open: !document.getElementById("find-bar").hidden,
  focused: document.activeElement?.id || "",
  count: document.getElementById("find-count").textContent,
  lit: document.querySelectorAll(".hl.found").length,
  current: [...document.querySelectorAll(".hl.found.current")].map((b) => b.parentElement.dataset.page),
  page: document.getElementById("page").value,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const settle = () => sleep(700);
const typeQuery = async (text) => {
  await r.key("a", CTRL);
  await r.type(text);
  await settle();
};

// 1. Opening.
await r.click(await r.at(40, 40));
await r.key("f", CTRL); await sleep(300);
let s = await state();
check("Ctrl+F opens the find box, ready to type", s.open && s.focused === "find-input", s);

// 2. Typing lights and counts every match.
await typeQuery("the voice");
s = await state();
check("typing finds every match, and counts them", s.count === "1 of 4", s.count);
check("…lit on the page, the first one picked out", s.lit >= 3 && s.current.length === 1 && s.current[0] === "0", [s.lit, s.current]);
await r.key("Enter"); await settle();
check("Enter goes to the next", (await state()).count === "2 of 4", (await state()).count);
await r.key("Enter", SHIFT); await settle();
check("Shift+Enter goes back", (await state()).count === "1 of 4", (await state()).count);
await r.key("Enter", SHIFT); await settle();
check("…and wraps round from the first to the last", (await state()).count === "4 of 4", (await state()).count);

// 3. A match on another page scrolls there.
// The last match was on page 3, so a new query starts from there, as a browser's does.
await typeQuery("Rivera");
s = await state();
check("a new query starts at the first match from the page on screen", s.count === "2 of 2" && s.page === "3", [s.count, s.page]);
await r.key("Enter"); await sleep(1200);
s = await state();
check("Enter wraps to the first, on page 1, scrolled to and lit", s.count === "1 of 2" && s.page === "1" && s.current[0] === "0", [s.count, s.page, s.current]);
await r.key("Enter"); await sleep(1200);
s = await state();
check("…and on to page 3 again", s.count === "2 of 2" && s.page === "3" && s.current[0] === "2", [s.count, s.page, s.current]);

// 4. Match case, and nothing found.
await typeQuery("footnotes");
check("case does not matter by default", (await state()).count === "1 of 1", (await state()).count);
await ev(`(() => { const b = document.getElementById("find-case"); b.checked = true; b.dispatchEvent(new Event("change")); })()`);
await settle();
s = await state();
check("Match case finds only the same capitals", s.count === "No matches" && s.lit === 0, s.count);
await ev(`(() => { const b = document.getElementById("find-case"); b.checked = false; b.dispatchEvent(new Event("change")); })()`);
await typeQuery("zebra crossing");
check("a query that is not there says so", (await state()).count === "No matches", (await state()).count);

// 5. What is typed finds what is printed.
const found = (query) => r.inWorker("document-worker.js", `python.then((py) => { py.globals.set("q", ${JSON.stringify(query)});
  return py.runPython("import reader, json; json.dumps(reader.find(q)['matches'])"); })`).then(JSON.parse);
// _fold is in the desktop's document.py now, not in reader.py: one copy of the
// search, in the file both versions share, so they cannot drift apart.
const folded = await r.inWorker("document-worker.js", `python.then((py) => py.runPython("from mimick import document; document._fold('‘Tis “so” — ﬁne', False)"))`);
check("curly quotes, dashes and ligatures are folded to plain ones", folded === `'tis "so" - fine`
      && (await found("what they did not want to hear: page numbers")).length === 1, folded);
check("spaces in a query match any spacing, across a line break", (await found("The  words   stay")).length === 1);

// 6. A match is a place on the page: right-click it to read from there.
await typeQuery("hardest part");
const lit = JSON.parse(await ev(`(() => { const b = document.querySelector(".hl.found.current").getBoundingClientRect();
  return JSON.stringify([b.left + b.width / 2, b.top + b.height / 2]); })()`));
await r.rightClick(lit);
check("right-click on a match offers Start reading from here", (await r.menuLabels())?.[0] === "Start reading from here", await r.menuLabels());
await r.key("Escape"); await sleep(200);
await r.click(await r.centre("#find-input"));

// 7. Esc leaves the match selected.
await typeQuery("a switch to turn notes");
await r.key("Escape"); await sleep(600);
s = await state();
check("Esc closes the box, leaving the match selected", !s.open && /match is selected/.test(s.status)
      && (await ev(`document.querySelectorAll(".hl.selection").length`)) > 0 && s.lit === 0, s);
await r.key("c", CTRL); await sleep(400);
check("…so Ctrl+C copies it", (await ev(`navigator.clipboard.readText()`)) === "A switch to turn notes", await ev(`navigator.clipboard.readText()`));

// 8. Reopened, the query is still there; File lists it.
await r.key("Escape");
await r.key("f", CTRL); await settle();
s = await state();
check("Ctrl+F again keeps the last query", s.open && s.count === "1 of 1", s);
await r.click(await r.centre("#find-close")); await sleep(300);
await r.click(await r.centre("#file-menu")); await sleep(300);
check("File lists Find in document", (await r.menuLabels())?.includes("Find in document…"), await r.menuLabels());
await r.key("Escape");

// 9. Reading ▾ → What repeats: the terms the paper keeps using, and Find on one.
await r.click(await r.centre("#reading-menu")); await sleep(300);
await r.menu("What repeats…");
await wait(`document.getElementById("repeats-dialog").open`, 20000).catch(() => {});
const listed = await ev(`JSON.stringify([...document.querySelectorAll("#repeats-list button")].map((b) => [b.querySelector("b").textContent, b.querySelector("span").textContent]))`).then(JSON.parse);
check("What repeats lists terms, with how often and on which pages", listed.length > 3 && listed.every(([, said]) => /^\d+ times · p\. \d/.test(said)), listed.slice(0, 4));
const [term] = listed[0] ?? [];
await r.click(await r.centre("#repeats-list button"));
await settle();
s = await state();
check("choosing one closes it and finds that term", !(await ev(`document.getElementById("repeats-dialog").open`)) && s.open
      && (await ev(`document.getElementById("find-input").value`)) === term && /^\d+ of \d+/.test(s.count), [term, s.count]);
await r.click(await r.centre("#find-close")); await sleep(300);
r.finish();
