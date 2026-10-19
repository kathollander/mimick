/* Kat's list of 16 October: the notes panel and leaving the page.
 *
 *   1. Leaving the page with highlights not yet saved to a file asks first;
 *      after Save a copy it does not.
 *   2. A highlight's menu links a sticky note that is already there, and one
 *      sticky note can be linked to several highlights.
 *   3. Find in notes, beside the heading; show by colour; no All notes; the
 *      previous / next arrows big enough to hit.
 *
 * Needs serve.py on 8731. `node tools/check_panel.mjs`
 */
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/test-paper.pdf");
const r = await startReader("check-panel");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);

// --- 1. Leaving with work not in a file ------------------------------------------

await r.t.send("Page.enable");
let dialogs = [];
r.t.on((m) => { if (m.method === "Page.javascriptDialogOpening") dialogs.push(m.params.type); });
/* Try to leave; say whether the browser asked, and stay if it did. */
async function tryLeaving() {
  dialogs = [];
  r.t.send("Page.navigate", { url: "about:blank" });
  for (let i = 0; i < 20 && !dialogs.length; i++) await sleep(150);
  if (!dialogs.length) return null;
  await r.t.send("Page.handleJavaScriptDialog", { accept: false });
  await sleep(400);
  return dialogs[0];
}

await r.drag(await r.at(243, 260), await r.at(330, 260));
await r.key("h", CTRL); await sleep(900);
check("a highlight not yet in a file: leaving the page asks first", await tryLeaving() === "beforeunload", dialogs);
check("…and staying keeps the page and the highlight", await ev(`document.querySelectorAll("#cards .note-card").length`) === 1);
// Headless Chrome has no save window to answer: take the download instead.
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker`);
await r.key("s", CTRL);
await wait(`/Saved|Sent/.test(document.getElementById("status").textContent)`, 20000);
check("after Save a copy, leaving does not ask", await tryLeaving() === null, dialogs);
// It left: back, to the same document, whose highlight comes back from the browser.
await r.load();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled && document.querySelectorAll("#cards .note-card").length === 1`);

// --- 2. Linking from a highlight; one sticky, two highlights ----------------------

const links = () => ev(`JSON.stringify({
  cards: [...document.querySelectorAll("#cards .sticky-card")].map((c) => ({ on: c.querySelector(".on")?.textContent ?? "",
    partner: c.classList.contains("partner") })),
  partnerMarks: new Set([...document.querySelectorAll(".page .hl.annot.partner")].map((m) => m.dataset.xref ?? m.outerHTML.length)).size,
  lines: document.querySelectorAll(".page svg.link-line").length,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
/* The `n`th menu entry with this label (0 first): the same quote is both
 * "Go to" and "Unlink" on a sticky linked to several. */
async function menuNth(label, n) {
  const p = await ev(`(() => { const b = [...document.querySelectorAll("#menu button")].filter((b) =>
    b.querySelector(".label").lastChild.textContent.trim() === ${JSON.stringify(label)})[${n}];
    if (!b) return null; const q = b.getBoundingClientRect(); return JSON.stringify([q.left + 20, q.top + q.height / 2]); })()`);
  if (!p) throw new Error(`no menu entry ${label} #${n}`);
  await r.click(JSON.parse(p)); await sleep(300);
}

await r.drag(await r.at(120, 304), await r.at(200, 304));
await r.key("h", CTRL); await sleep(900);
await r.click(await r.centre("#markup-sticky")); await sleep(1200);
await r.type("Both of these");
await r.key("Escape"); await sleep(1000);
let k = await links();
check("a second highlight, and a sticky note linked to nothing", k.cards.length === 1 && k.cards[0].on === "", k);

await r.rightClick(await r.at(290, 260));
check("a highlight's menu offers to link a sticky note that is there", (await r.menuLabels()).includes("Link a sticky note to this…"),
      await r.menuLabels());
await r.menu("Link a sticky note to this…");
check("…and asks for the sticky note", /Click the sticky note/.test(await r.status()), await r.status());
await r.click(await r.centre(".page .sticky .sticky-text")); await sleep(1000);
k = await links();
check("clicking the sticky on the page links it to that highlight", /^On “/.test(k.cards[0]?.on) && !/more/.test(k.cards[0].on), k);

await r.rightClick(await r.at(160, 304));
await r.menu("Link a sticky note to this…");
await r.click(await r.centre("#cards .sticky-card .body")); await sleep(1000);
k = await links();
check("clicking its card links it to a second highlight too", /and 1 more$/.test(k.cards[0]?.on), k);
check("…and the status says it is on two", /and 1 other highlight/.test(k.status), k.status);
await r.click(await r.centre("#cards .sticky-card .body")); await sleep(500);
k = await links();
check("picking the sticky lights both highlights, with a line to each", k.partnerMarks >= 2 && k.lines === 2, k);

await r.rightClick(await r.at(160, 304));
check("a highlight it is already on offers no sticky to link", (await r.menuLabels()).includes("(off) Link a sticky note to this…"),
      await r.menuLabels());
await r.key("Escape"); await sleep(200);

await r.key("z", CTRL); await sleep(800);
k = await links();
check("Ctrl+Z takes off just the second link", /^On “/.test(k.cards[0]?.on) && !/more/.test(k.cards[0].on), k);
await r.key("y", CTRL); await sleep(800);
k = await links();
check("…and Ctrl+Y puts it back", /and 1 more$/.test(k.cards[0]?.on), k);

await r.rightClick(await r.centre("#cards .sticky-card"));
const labels = await r.menuLabels();
check("the sticky's menu lists each highlight to go to and to unlink, and links another",
      labels.includes("(off) Go to its highlight") && labels.includes("(off) Unlink it from")
      && labels.includes("Link it to another highlight…"), labels);   // test-paper.pdf has one of its own on page 2
const quote = labels[labels.indexOf("(off) Unlink it from") + 1];
await menuNth(quote, 1); await sleep(800);
k = await links();
check("unlinking one keeps the other", /^On “/.test(k.cards[0]?.on) && !/more/.test(k.cards[0].on), k);

// --- 3. Find in notes, show by colour ------------------------------------------------

const panel = () => ev(`JSON.stringify({
  cards: [...document.querySelectorAll("#cards .note-card")].map((c) => c.textContent),
  none: document.querySelector("#cards .none")?.textContent ?? "",
  chips: [...document.querySelectorAll("#filter-colours .colour-chip")].map((c) => [c.getAttribute("aria-label"), c.getAttribute("aria-pressed")]),
  status: document.getElementById("status").textContent })`).then(JSON.parse);
check("All notes is gone from the panel", await ev(`!document.getElementById("notes-all")`));
check("the previous / next arrows are bigger", await ev(`document.getElementById("next-note").getBoundingClientRect().width`) >= 40);
check("Find in notes sits beside the heading", await ev(`(() => { const h = document.querySelector("#notes h2").getBoundingClientRect(),
  f = document.getElementById("notes-find").getBoundingClientRect(); return Math.abs(h.top + h.height / 2 - (f.top + f.height / 2)) < 6 && f.left > h.right; })()`));
let p = await panel();
const before = p.cards.length;
await r.click(await r.centre("#notes-find"));
await r.type("group");
await sleep(400);
p = await panel();
check("typing shows only the notes with those words, with their page", p.cards.length === 1 && /^Page 1in our group said/.test(p.cards[0]), p);
check("…and says how many", /1 note with “group”/.test(p.status), p.status);
await ev(`(() => { const f = document.getElementById("notes-find"); f.value = ""; })()`);
await r.type("already");
await sleep(400);
p = await panel();
check("…from the whole document, not just the pages on screen", p.cards.length === 1 && /^Page 2/.test(p.cards[0]), p);
await r.type(" zebra");
await sleep(400);
p = await panel();
check("no match says so", p.cards.length === 0 && /No notes with “already zebra”/.test(p.none), p);
await r.key("Escape"); await sleep(300);
p = await panel();
check("Esc clears it, and the panel is as it was", p.cards.length === before && await ev(`document.getElementById("notes-find").value === ""`), p);

check("a toggle for each colour in use, all lit", p.chips.length >= 1 && p.chips.every(([, on]) => on === "true"), p.chips);
const [first] = p.chips[0];
await r.click(await r.centre("#filter-colours .colour-chip")); await sleep(400);
const hiddenOne = await panel();
check(`tapping ${first} hides its notes from the panel`, hiddenOne.cards.length < before
      && hiddenOne.chips[0][1] === "false" && new RegExp(`${first} hidden`).test(hiddenOne.status), hiddenOne);
check("…but not from the page", await ev(`document.querySelectorAll(".page .hl.annot").length`) > 0);
await r.click(await r.centre("#filter-colours .colour-chip")); await sleep(400);
p = await panel();
check("tapping it again shows them", p.cards.length === before && p.chips[0][1] === "true", p);

r.finish();
