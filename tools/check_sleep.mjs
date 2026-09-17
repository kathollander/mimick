/* The sleep timer, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_sleep.mjs
 *
 * On the test paper: Reading → Stop reading → At the end of this page, then
 * reading skipped forward sentence by sentence, checks it pauses as the first
 * sentence of page 2 begins and says so, and that Space carries on from there.
 * Then the same for At the end of this section. The minutes are not waited for.
 * Shares check_convert's profile, for its downloaded voice.
 */
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const r = await startReader("check-convert");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await r.openPdf(path.join(root, "sample/test-paper.pdf"));

const state = () => ev(`JSON.stringify({ play: document.getElementById("play").textContent,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const choose = async (label) => {
  await r.click(await r.centre("#reading-menu")); await sleep(300);
  await r.menu(label);
};

await r.click(await r.centre("#reading-menu")); await sleep(300);
const labels = await r.menuLabels();
check("Reading offers the sleep timer", ["Off", "In 15 minutes", "In 30 minutes", "In 60 minutes", "At the end of this page", "At the end of this section"]
  .every((l) => labels?.includes(l)), labels);
await r.key("Escape");

// Skip forward a sentence at a time, each press only once the sentence before has
// started: pressed faster than the voice makes them, the skips pile up and stall.
const skipUntilPaused = async (most) => {
  for (let i = 0; i < most && (await state()).play !== "Resume"; i++) {
    const was = (await state()).status;
    await r.key("ArrowRight");
    await wait(`(() => { const t = document.getElementById("status").textContent, p = document.getElementById("play").textContent;
      return p === "Resume" || (t !== ${JSON.stringify(was)} && /^Sentence \\d+ of/.test(t)); })()`, 30000).catch(() => {});
    await sleep(300);
  }
};

// At the end of this page.
await r.click(await r.centre("#play"));
await wait(`/^Sentence 1 of/.test(document.getElementById("status").textContent)`, 120000);
await choose("At the end of this page");
check("…which says when it will stop", /stops at the end of page 1/.test((await state()).status), (await state()).status);
await skipUntilPaused(30);
let s = await state();
check("reading pauses as page 2 begins, and says why", s.play === "Resume" && /^Sleep timer: stopped at the end of the page/.test(s.status), s);
await r.key(" "); await sleep(1500);
s = await state();
check("Space carries on from there", s.play === "Pause" && / · page 2$/.test(s.status), s);

// At the end of this section.
await choose("At the end of this section");
check("…the section is named", /stops at the end of “2\. What Students Chose to Hear”/.test((await state()).status), (await state()).status);
await skipUntilPaused(40);
s = await state();
check("reading pauses as the next section begins", s.play === "Resume" && /end of the section/.test(s.status), s);
await r.click(await r.centre("#reading-menu")); await sleep(300);
check("…and the timer is off again", (await ev(`[...document.querySelectorAll("#menu button")].find((b) => b.textContent.includes("Off"))?.getAttribute("aria-checked")`)) === "true");
await r.key("Escape");
await r.click(await r.centre("#play"));
r.finish();
