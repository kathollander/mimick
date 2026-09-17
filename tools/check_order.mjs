/* The reading order (Ctrl+R), in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_order.mjs
 *
 * Drives the reader with real clicks and keys (tools/cdp.mjs), against the
 * sample. Checks the regions are drawn and numbered, that a click skips one
 * without reading or moving a highlight, that the choice comes back after a
 * reload and after the cleanup is switched off and on, and that Reset forgets
 * it. Needs no voice.
 */
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/mdpi-sample.pdf");
const r = await startReader("check-order");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);

const state = () => ev(`JSON.stringify({
  reads: document.querySelectorAll('.page[data-page="0"] .plan.reads').length,
  skipped: document.querySelectorAll('.page[data-page="0"] .plan.skipped').length,
  tags: [...document.querySelectorAll('.page[data-page="0"] .plan.reads .tag')].map((t) => t.textContent),
  play: document.getElementById("play").textContent,
  card: document.querySelector("#cards .note-card")?.textContent || "",
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const sentences = async () => Number((await ev(`document.getElementById("status").textContent`)).match(/(\d+) sentences/)?.[1]);
const display = async () => { await r.click(await r.centre("#display-menu")); await sleep(300); };

// A highlight first, to see it stays on its words.
await r.drag(await r.at(283, 268), await r.at(330, 268));
await r.key("h", CTRL); await sleep(600);

// 1. Showing it.
await r.key("r", CTRL); await sleep(1200);
let s = await state();
check("Ctrl+R outlines the regions, read and skipped", s.reads > 0 && s.skipped > 0, [s.reads, s.skipped]);
check("…numbered in reading order", s.tags.join(",") === s.tags.map((_, i) => i + 1).join(","), s.tags);
check("…and says how many", /Reading 37 regions, skipping 34/.test(s.status), s.status);
await display();
check("Display lists it, ticked", (await r.menuLabels())?.some((l) => l.endsWith("Show reading order")), await r.menuLabels());
await r.key("Escape");

// 2. Skipping the abstract.
await r.click(await r.at(300, 268)); await sleep(2000);
s = await state();
const skipped = await sentences();
check("clicking a region skips it", /Now skipping that region/.test(s.status) && skipped < 272, s.status);
check("…draws it as skipped", s.reads === 6 && s.skipped === 10, [s.reads, s.skipped]);
check("…does not start reading", s.play === "Read aloud", s.play);
check("…and the highlight is still on the same words", s.card.includes("is also at the"), s.card);

// 3. Kept.
await r.load();
await r.openPdf(SAMPLE); await sleep(1500);
s = await state();
check("after a reload the order shows, with the change put back", s.reads === 6 && s.skipped === 10, [s.reads, s.skipped]);
await display();
check("…and Reset is offered for it", (await r.menuLabels())?.includes("Reset reading order"), await r.menuLabels());
await r.key("Escape");

// 4. Through the cleanup, which analyses the pages again.
await display(); await r.menu("Clean up text for reading"); await sleep(2500);
await display(); await r.menu("Clean up text for reading"); await sleep(2500);
check("switching the cleanup off and on keeps the change", (await sentences()) === skipped && (await state()).skipped === 10, await r.status());

// 5. Reset.
await display();
await r.menu("Reset reading order"); await sleep(2500);
s = await state();
check("Reset puts the analysis back", /reset/.test(s.status) && s.reads === 7 && s.skipped === 9, [s.status, s.skipped]);
await r.load();
await r.openPdf(SAMPLE); await sleep(1500);
s = await state();
await display();
check("…and forgets the change", s.reads === 7 && (await r.menuLabels())?.includes("(off) Reset reading order"), [s.reads, s.skipped]);
await r.key("Escape");

// 6. Hiding it.
await r.key("r", CTRL); await sleep(600);
s = await state();
check("Ctrl+R again hides it", s.reads === 0 && s.skipped === 0 && /Reading order hidden/.test(s.status), s.status);
r.finish();
