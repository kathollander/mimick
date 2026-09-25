/* Keeping each document's place and zoom, and Forget this document, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_forget.mjs
 *
 * On the test paper (sample/test-paper.pdf): scrolls to page 3 at 150%, reloads,
 * and checks it opens there again, while the poem, never scrolled, opens at its
 * top. Then highlights a sentence, and checks File → Forget this document asks
 * first, Cancel keeps everything, and Forget it closes the document and removes
 * its highlights, place, zoom and reading-order choices from the browser, so it
 * opens again as new. Needs no voice.
 */
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const PAPER = path.join(root, "sample/test-paper.pdf");
const POEM = path.join(root, "sample/sample.pdf");
const r = await startReader("check-forget");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`localStorage.setItem("mimick-click_read", "0")`);   // a click selects, and never starts the voice
await r.openPdf(PAPER);

const state = () => ev(`JSON.stringify({
  page: document.getElementById("page").value,
  zoom: document.getElementById("zoom").value,
  empty: !document.getElementById("empty").hidden,
  title: document.getElementById("title").textContent,
  annots: document.querySelectorAll(".hl.annot").length,
  notes: document.getElementById("filter-notes").textContent.trim(),
  dialog: document.getElementById("forget-dialog").open,
  kept: Object.keys(localStorage).filter((k) => /^mimick-(view|position|order):/.test(k)).length,
  status: document.getElementById("status").textContent })`).then(JSON.parse);

// 1. The place and zoom come back.
await ev(`(() => { const z = document.getElementById("zoom"); z.value = 150; z.dispatchEvent(new Event("change")); })()`);
await sleep(400);
await r.key("End", CTRL); await sleep(1200);
let s = await state();
check("scrolled to page 3 at 150%", s.page === "3" && s.zoom === "150", s);
await r.load();
await r.openPdf(POEM);
s = await state();
check("another document, never scrolled, opens at its top", s.page === "1", s);
await r.openPdf(PAPER);
await sleep(600);
s = await state();
check("opened again after a reload, the paper is back on page 3 at 150%", s.page === "3" && s.zoom === "150", s);

// 2. Make something to forget: a highlight.
await r.key("Home", CTRL); await sleep(900);
await r.click(await r.at(200, 250));
await r.click(await r.at(200, 250), 2); await sleep(400);
await r.key("h", CTRL); await sleep(1500);
const before = await state();
check("a highlight made", before.annots >= 1, before.annots);
await ev(`localStorage.setItem("mimick-order:" + "x", "{}")`);   // another document's: must survive

// 3. Forget asks first; Cancel keeps it all.
await r.click(await r.centre("#file-menu")); await sleep(300);
const labels = await r.menuLabels();
check("File has Forget this document", labels?.includes("Forget this document…"), labels);
await r.menu("Forget this document…"); await sleep(300);
s = await state();
check("…which asks first, naming the highlights", s.dialog && /its \d+ highlights? and notes/.test(await ev(`document.getElementById("forget-what").textContent`)),
      await ev(`document.getElementById("forget-what").textContent`));
await r.click(await r.centre("#forget-cancel")); await sleep(500);
s = await state();
check("Cancel keeps everything", !s.dialog && !s.empty && s.annots === before.annots, s);

// 4. Forget it.
await r.click(await r.centre("#file-menu")); await sleep(300);
await r.menu("Forget this document…"); await sleep(300);
await r.click(await r.centre("#forget-go")); await sleep(1200);
s = await state();
check("Forget it closes the document and says what it did", s.empty && s.title === "" && /^Forgot Listening to the Page/.test(s.status), s);
const paperKeys = await ev(`Object.keys(localStorage).filter((k) => /^mimick-(view|position|order):/.test(k))`);
check("…its place, zoom and choices are gone from storage, and other documents' are not",
      paperKeys.length === 2 && paperKeys.includes("mimick-order:x") && (await ev(`localStorage.getItem("mimick-order:x")`)) === "{}", paperKeys);

await r.load();
await r.openPdf(PAPER);
await sleep(1500);
s = await state();
check("opened again, it starts at the top, with only the file's own note", s.page === "1" && s.notes === "Notes  1" && s.annots === 1, s);
check("…and says nothing of highlights put back", !/back/.test(s.status), s.status);
r.finish();
