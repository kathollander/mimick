/* The Display and Help menus, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_display.mjs
 *
 * Drives the reader (tools/cdp.mjs) against sample/test-paper.pdf: Click to
 * read off and on again, Clean up text for reading rebuilding the sentences (29
 * tidied, 39 verbatim) and being remembered at the next open, a highlight
 * staying on its words through that rebuild, Read footnotes offered on a paper
 * that has them and greyed out on the poem that has none, and the keyboard
 * shortcuts and About windows.
 */
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/test-paper.pdf");
const r = await startReader("check-display");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);
const play = () => ev(`document.getElementById("play").textContent`);
const display = async (label) => { await r.click(await r.centre("#display-menu")); await sleep(200); if (label) await r.menu(label); };

// 1. Click to read.
await display();
const labels = await r.menuLabels();
check("Display offers the reading switches", ["Click to read", "Skip citations while reading", "Read footnotes", "Clean up text for reading",
                                              "Notes panel", "Zoom in"].every((l) => labels?.some((m) => m.endsWith(l))), labels);
check("Read footnotes is offered on a paper with footnotes", labels?.includes("Read footnotes"), labels);
await r.menu("Click to read");
check("switching Click to read off says so", /Clicking never starts reading/.test(await r.status()));
await r.click(await r.at(290, 260)); await sleep(1200);
check("…and a click on a sentence then does not read", (await play()) === "Read aloud", await play());
await r.rightClick(await r.at(290, 260));
await r.menu("Start reading from here");
await wait(`document.getElementById("play").textContent === "Pause"`, 60000);
check("right-click still reads from there", true);
await r.key(" ");
await wait(`document.getElementById("play").textContent === "Resume"`);
await display("Click to read");
check("switching it back on remembers it", (await ev(`localStorage.getItem("mimick-click_read")`)) === "1");

// 2. Clean up text, with a highlight on the page.
await r.drag(await r.at(243, 260), await r.at(330, 260));
await r.key("h", CTRL); await sleep(600);
await display("Clean up text for reading");
await wait(`/39 sentences/.test(document.getElementById("status").textContent)`, 20000);
check("turning Clean up off reads the PDF verbatim: 39 sentences", true);
await r.click(await r.at(40, 40));
await r.key("c", CTRL);
await r.click(await r.at(290, 260)); await sleep(300);
await r.key("c", CTRL); await sleep(300);
const copied = await ev(`navigator.clipboard.readText()`);
check("the highlight is still on the same words", copied === "voice keeps the pace", copied);
await r.load();
await ev(`window.said = []; new MutationObserver(() => said.push(document.getElementById("status").textContent))
  .observe(document.getElementById("status"), { childList: true, characterData: true, subtree: true })`);
await r.openPdf(SAMPLE);
const said = await ev(`said`);
check("the switch is remembered at the next open", said.some((t) => /39 sentences to read/.test(t)), said);
await display("Clean up text for reading");
await wait(`/29 sentences/.test(document.getElementById("status").textContent)`, 20000);
check("and back on: 29 sentences", true);

// 3. Help.
await r.click(await r.centre("#view")); await r.key("?"); await sleep(300);
check("? opens the keyboard shortcuts", await ev(`document.getElementById("keys-dialog").open`));
await r.key("Escape"); await sleep(200);
await r.click(await r.centre("#help-menu")); await sleep(200);
check("Help offers shortcuts, About and the source", JSON.stringify(await r.menuLabels()) === JSON.stringify(["Keyboard shortcuts", "About Mimick", "Source code"]),
      await r.menuLabels());
await r.menu("About Mimick");
check("About opens", await ev(`document.getElementById("about-dialog").open && /Arranged by/.test(document.getElementById("about-dialog").textContent)`));
await r.key("Escape"); await sleep(200);

// 3b. How long it takes to read, in the bottom bar.
{
  // Opened afresh: the click that gave the page the keyboard above started reading.
  await r.openPdf(SAMPLE);
  await wait(`!document.getElementById("reading-time").hidden`, 20000);
  const time = () => ev(`[document.getElementById("reading-time").textContent, document.getElementById("reading-time").title]`);
  let [shown] = await time();
  check("the bottom bar says how long the document takes at the chosen speed", /^\d+ min to read at 1×$/.test(shown), shown);
  await ev(`(() => { const e = document.getElementById("speed"); e.value = "3"; e.dispatchEvent(new Event("change")); })()`);
  await sleep(300);
  [shown] = await time();
  check("…and changes with the speed box", /^\d+ min to read at 3×$/.test(shown), shown);
  await ev(`(() => { const e = document.getElementById("speed"); e.value = "1"; e.dispatchEvent(new Event("change")); })()`);
}

// 4. The voice. Nothing is downloaded here: a model is 60 MB.
// A fresh page: the click that gave the page the keyboard above also started reading.
await r.load();
const voices = await ev(`[...document.getElementById("voice").options].map((o) => o.value)`);
check("the voice box offers the seven voices, Kathleen first", voices.length === 7 && voices[0] === "en_US-kathleen-low", voices);
await ev(`(() => { const s = document.getElementById("voice"); s.value = "en_US-joe-medium"; s.dispatchEvent(new Event("change")); })()`);
await sleep(500);
check("choosing one says what it is like, and what it costs", /Joe \(US\) — older man, warm/.test(await r.status()), await r.status());
await r.click(await r.centre("#voice-sample")); await sleep(1000);
check("▶ plays its sample, and does not start reading",
      (await ev(`document.getElementById("voice-sample").textContent`)) === "■" && (await ev(`document.getElementById("play").textContent`)) === "Read aloud");
await r.click(await r.centre("#voice-sample")); await sleep(300);
await r.load();
check("the voice is remembered", (await ev(`document.getElementById("voice").value`)) === "en_US-joe-medium");
for (const width of [1300, 1024]) {
  await r.t.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const boxes = await ev(`[...document.querySelectorAll("header.bar button, header.bar select")].filter((e) => e.offsetParent)
    .map((e) => { const b = e.getBoundingClientRect(); return [e.id, b.left, b.right, b.height]; })`);
  const overlaps = boxes.filter((a, i) => boxes.some((b, j) => i < j && a[1] < b[2] - 1 && b[1] < a[2] - 1)).map((b) => b[0]);
  check(`at ${width}px nothing in the top bar overlaps or wraps`,
        !overlaps.length && boxes.every((b) => b[3] < 40) && boxes.every((b) => b[2] <= width), overlaps);
}
r.finish();
