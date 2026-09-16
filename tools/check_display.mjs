/* The Display and Help menus, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_display.mjs
 *
 * Drives the reader (tools/cdp.mjs) against the sample: Click to read off and
 * on again, Clean up text for reading rebuilding the sentences (272 tidied, 396
 * verbatim) and being remembered at the next open, a highlight staying on its
 * words through that rebuild, Read footnotes greyed out on a paper that has
 * none, and the keyboard shortcuts and About windows.
 */
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/mdpi-sample.pdf");
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
check("Read footnotes is greyed out on a paper with none", labels?.includes("(off) Read footnotes"), labels);
await r.menu("Click to read");
check("switching Click to read off says so", /Clicking never starts reading/.test(await r.status()));
await r.click(await r.at(300, 268)); await sleep(1200);
check("…and a click on a sentence then does not read", (await play()) === "Read aloud", await play());
await r.rightClick(await r.at(300, 268));
await r.menu("Start reading from here");
await wait(`document.getElementById("play").textContent === "Pause"`, 60000);
check("right-click still reads from there", true);
await r.key(" ");
await wait(`document.getElementById("play").textContent === "Resume"`);
await display("Click to read");
check("switching it back on remembers it", (await ev(`localStorage.getItem("mimick-click_read")`)) === "1");

// 2. Clean up text, with a highlight on the page.
await r.drag(await r.at(283, 268), await r.at(330, 268));
await r.key("h", CTRL); await sleep(600);
await display("Clean up text for reading");
await wait(`/396 sentences/.test(document.getElementById("status").textContent)`, 20000);
check("turning Clean up off reads the PDF verbatim: 396 sentences", true);
await r.click(await r.at(40, 40));
await r.key("c", CTRL);
await r.click(await r.at(300, 268)); await sleep(300);
await r.key("c", CTRL); await sleep(300);
const copied = await ev(`navigator.clipboard.readText()`);
check("the highlight is still on the same words", copied === "is also at the", copied);
await r.load();
await ev(`window.said = []; new MutationObserver(() => said.push(document.getElementById("status").textContent))
  .observe(document.getElementById("status"), { childList: true, characterData: true, subtree: true })`);
await r.openPdf(SAMPLE);
const said = await ev(`said`);
check("the switch is remembered at the next open", said.some((t) => /396 sentences to read/.test(t)), said);
await display("Clean up text for reading");
await wait(`/272 sentences/.test(document.getElementById("status").textContent)`, 20000);
check("and back on: 272 sentences", true);

// 3. Help.
await r.click(await r.centre("#view")); await r.key("?"); await sleep(300);
check("? opens the keyboard shortcuts", await ev(`document.getElementById("keys-dialog").open`));
await r.key("Escape"); await sleep(200);
await r.click(await r.centre("#help-menu")); await sleep(200);
check("Help offers shortcuts, About and the source", JSON.stringify(await r.menuLabels()) === JSON.stringify(["Keyboard shortcuts", "About Mimick", "Source code"]),
      await r.menuLabels());
await r.menu("About Mimick");
check("About opens", await ev(`document.getElementById("about-dialog").open && /Arranged by/.test(document.getElementById("about-dialog").textContent)`));
r.finish();
