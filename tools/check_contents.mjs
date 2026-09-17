/* The table of contents panel, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_contents.mjs
 *
 * Drives the reader (tools/cdp.mjs) against the test paper
 * (sample/test-paper.pdf), whose bookmarks are its title with four sections
 * and the references under it. Checks the entries are listed and nested, a
 * click goes to the heading and lights it, scrolling lights the section on
 * screen, the panel hides and comes back by its ‹, the edge tab, F9 and
 * Display ▾, the choice is kept over a reload, the notes panel has the same
 * › and tab, and a PDF with no bookmarks (the poem) shows no panel and says why.
 * Needs no voice.
 */
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const PAPER = path.join(root, "sample/test-paper.pdf");
const POEM = path.join(root, "sample/sample.pdf");
const r = await startReader("check-contents");
const { ev, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(PAPER);

const state = () => ev(`JSON.stringify({
  panel: !document.getElementById("contents").hidden,
  tab: !document.getElementById("contents-tab").hidden,
  tabDisabled: document.getElementById("contents-tab").disabled,
  rows: [...document.querySelectorAll("#contents-list .toc-row")].map((row) =>
    [Number(row.getAttribute("aria-level")), row.querySelector(".toc-link").textContent, row.querySelector(".toc-page").textContent, !row.hidden]),
  current: document.querySelector("#contents-list .toc-row.current .toc-link")?.textContent ?? null,
  page: document.getElementById("page").value,
  viewLeft: document.getElementById("view").getBoundingClientRect().left,
  notesPanel: !document.getElementById("notes").hidden,
  notesTab: !document.getElementById("notes-tab").hidden,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const rowCentre = (title) => ev(`(() => { const b = [...document.querySelectorAll("#contents-list .toc-link")]
  .find((l) => l.textContent === ${JSON.stringify(title)}).getBoundingClientRect();
  return JSON.stringify([b.left + 20, b.top + b.height / 2]); })()`).then(JSON.parse);

// 1. Listed, nested, shown by default.
let s = await state();
check("a PDF with bookmarks opens with the contents panel shown", s.panel && !s.tab && s.viewLeft > 200, s);
check("…every bookmark listed, with its page", s.rows.length === 6
  && s.rows[0][1].startsWith("Listening to the Page") && s.rows[0][2] === "1"
  && s.rows[2][1] === "2. What Students Chose to Hear" && s.rows[2][2] === "2"
  && s.rows[5][1] === "References" && s.rows[5][2] === "3", s.rows);
check("…the sections under the title, and open (a short outline opens in full)",
  s.rows.slice(1).every(([level, , , shown]) => level === 2 && shown), s.rows);
// A third of the way down the view is "here": at the top, the introduction's heading is already past it.
const firstPage = (title) => title?.startsWith("Listening to the Page") || title === "1. Introduction";
check("…a page 1 section lit at the top of the document", firstPage(s.current), s.current);

// 2. A click goes there, and lights it.
await r.click(await rowCentre("3. Discussion")); await sleep(900);
s = await state();
check("clicking a section goes to its page", s.page === "3", s.page);
check("…and lights it", s.current === "3. Discussion", s.current);
const onScreen = await ev(`(() => { const p = document.querySelector('.page[data-page="2"]'), v = document.getElementById("view");
  return p ? Math.round(p.getBoundingClientRect().top - v.getBoundingClientRect().top) : null; })()`);
check("…with its heading near the top of the view", onScreen !== null && onScreen > -120 && onScreen <= 20, onScreen);
check("…and the keys go back to the page", (await ev(`document.activeElement.id`)) === "view", await ev(`document.activeElement.id`));

// 3. Scrolling lights the section on screen.
await r.key("Home", 2); await sleep(900);
s = await state();
check("going back to the top lights page 1's section again", firstPage(s.current) && s.page === "1", [s.current, s.page]);
await r.key("PageDown"); await sleep(900);
s = await state();
check("turning to page 2 lights section 2", s.current === "2. What Students Chose to Hear", s.current);

// 4. Hiding and showing.
await r.click(await r.centre("#contents-hide")); await sleep(600);
s = await state();
check("‹ hides the panel, and the page takes the room", !s.panel && s.tab && s.viewLeft < 5, s);
await r.click(await r.centre("#contents-tab")); await sleep(600);
s = await state();
check("the tab on the page's edge brings it back", s.panel && !s.tab, s);
await r.key("F9"); await sleep(600);
check("F9 hides it", !(await state()).panel);
await r.key("F9"); await sleep(600);
check("…and shows it", (await state()).panel);
await r.click(await r.centre("#display-menu")); await sleep(300);
const labels = await r.menuLabels();
check("Display ▾ has Contents panel", labels?.includes("Contents panel"), labels);
await r.menu("Contents panel");
check("…which hides it", !(await state()).panel);
await r.load();
await r.openPdf(PAPER);
s = await state();
check("hidden stays hidden over a reload", !s.panel && s.tab, s);
await r.key("F9"); await sleep(600);

// 5. The notes panel's own › and tab.
await r.click(await r.centre("#notes-hide")); await sleep(600);
s = await state();
check("the notes panel's › hides it, and its tab shows", !s.notesPanel && s.notesTab, s);
await r.click(await r.centre("#notes-tab")); await sleep(600);
s = await state();
check("…and the tab brings it back", s.notesPanel && !s.notesTab, s);

// 6. Right-click: read from here is offered.
await r.rightClick(await rowCentre("4. Conclusions"));
const offered = await r.menuLabels();
check("right-clicking an entry offers Go here and Start reading from here",
  JSON.stringify(offered) === JSON.stringify(["Go here", "Start reading from here"]), offered);
await r.key("Escape"); await sleep(200);
const from = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(
  "import reader; i = reader.first_sentence_from(2, 190.0); reader._open().sentences[i].text"))`);
check("…and reading would start at the section's heading", /^(4\.? ?)?Conclusions/.test(from), from);

// 7. No bookmarks, no panel.
await r.openPdf(POEM);
s = await state();
check("a PDF without bookmarks shows no panel", !s.panel && s.rows.length === 0, s);
check("…and its tab is greyed, saying why", s.tab && s.tabDisabled, s);
r.finish();
