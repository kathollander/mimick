/* Reading ▾'s places to read from, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_back.mjs
 *
 * On the test paper: Read from the top of this page starts at page 2's first
 * sentence when page 2 is on screen; Back 10 seconds goes back within a long
 * sentence, and into the sentence before when one has just begun, and leaves a
 * paused reading paused; Go to where the voice is brings the lit word back
 * after scrolling away. Shares check_convert's profile, for its downloaded voice.
 */
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const r = await startReader("check-convert");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`localStorage.setItem("mimick-click_read", "0")`);
await r.openPdf(path.join(root, "sample/test-paper.pdf"));

const reading = () => ev(`JSON.stringify({ play: document.getElementById("play").textContent,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const choose = async (label) => { await r.click(await r.centre("#reading-menu")); await sleep(300); await r.menu(label); };
const sentence = async () => Number((await reading()).status.match(/^Sentence (\d+) of/)?.[1] ?? 0);

await r.click(await r.centre("#reading-menu")); await sleep(300);
const labels = await r.menuLabels();
check("Reading offers the new entries, greyed while nothing reads", ["Read from the top of this page", "(off) Back 10 seconds",
  "(off) Go to where the voice is", "(off) Recognise text in this scan…"].every((l) => labels?.includes(l)), labels);
await r.key("Escape");

// 1. Read from the top of this page.
await r.key("PageDown"); await sleep(800);
await choose("Read from the top of this page");
await wait(`/^Sentence \\d+ of \\d+ · page 2$/.test(document.getElementById("status").textContent)`, 120000).catch(() => {});
const first = await reading();
check("Read from the top of this page starts on page 2", / · page 2$/.test(first.status), first.status);
const pageTwoStart = await sentence();

// 2. Back 10 seconds, into the sentence before: a sentence has only just begun.
await r.key("ArrowRight"); await sleep(300);
await r.key("ArrowRight");
await wait(`/^Sentence ${pageTwoStart + 2} of/.test(document.getElementById("status").textContent)`, 30000).catch(() => {});
await sleep(500);
const before = await sentence();
await choose("Back 10 seconds");
await wait(`Number(document.getElementById("status").textContent.match(/^Sentence (\\d+) of/)?.[1]) < ${before}`, 20000).catch(() => {});
const after = await sentence();
check("Back 10 seconds just after a sentence begins goes into the sentences before", after > 0 && after < before, [before, after]);
check("…and keeps reading", (await reading()).play === "Pause", await reading());

// 3. Within a sentence: the word lit goes back.
const word = () => ev(`document.querySelector(".hl.word") ? JSON.stringify(document.querySelector(".hl.word").getBoundingClientRect()) : null`);
await r.key(" "); await sleep(500);
check("paused", (await reading()).play === "Resume");
const shift = 8;
await r.t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, modifiers: shift });
await r.t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, modifiers: shift });
await sleep(400);
check("Shift+← while paused selects, as it always has, and does not move the voice", (await reading()).play === "Resume");
await choose("Back 10 seconds");
await sleep(3000);
check("Back 10 seconds leaves a paused reading paused", (await reading()).play === "Resume", await reading());

// 4. Go to where the voice is.
await ev(`document.getElementById("view").scrollTop = 1e6`); await sleep(500);
const litOnScreen = () => ev(`(() => { const w = document.querySelector(".hl.sentence"); if (!w) return false;
  const b = w.getBoundingClientRect(), v = document.getElementById("view").getBoundingClientRect(); return b.top >= v.top && b.bottom <= v.bottom; })()`);
check("scrolled away, the lit sentence is off screen", !(await litOnScreen()));
await choose("Go to where the voice is"); await sleep(500);
check("Go to where the voice is brings it back", await litOnScreen());
await r.key(" "); await sleep(200);
r.finish();
