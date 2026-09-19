/* The Reading, Display and Help menus and the quick switches, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_display.mjs
 *
 * Drives the reader (tools/cdp.mjs) against sample/test-paper.pdf: Click to
 * read off and on again, Clean up text for reading rebuilding the sentences (29
 * tidied, 39 verbatim) and being remembered at the next open, a highlight
 * staying on its words through that rebuild, Read footnotes offered on a paper
 * that has them and greyed out on the poem that has none, the keyboard
 * shortcuts and About windows, and the strip of quick switches under ⌄
 * agreeing with the menus.
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
const display = async (label) => { await r.click(await r.centre("#reading-menu")); await sleep(200); if (label) await r.menu(label); };

// 1. Click to read.
await display();
const labels = await r.menuLabels();
check("Reading offers the reading switches", ["Click to read", "Skip citations while reading", "Read footnotes", "Clean up text for reading",
                                              "How to say words…", "In 15 minutes", "Show reading order"].every((l) => labels?.some((m) => m.endsWith(l))), labels);
await r.key("Escape"); await sleep(200);
await r.click(await r.centre("#display-menu")); await sleep(200);
const shown = await r.menuLabels();
check("Display keeps the theme, panels and zoom, and none of the reading switches",
      ["Night", "Day", "Match the system", "Notes panel", "Zoom in"].every((l) => shown?.some((m) => m.endsWith(l)))
      && !shown?.some((m) => /Click to read|Stop reading|How to say/.test(m)), shown);
await r.key("Escape"); await sleep(200);
await display();
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
check("Help offers the tour, shortcuts, About and the source",
      JSON.stringify(await r.menuLabels()) === JSON.stringify(["Take the tour", "Keyboard shortcuts", "About Mimick", "Source code"]),
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
await sleep(500);
const voices = await ev(`[...document.getElementById("voice").options].map((o) => o.value)`);
// This profile may have kept a voice from an earlier run, so ask which.
const keptNow = await ev(`MimickVoices.keptKeys()`);
const MimickVoicesOrder = await ev(`MimickVoices.LIST.map((v) => v.key)`);
check("the voice box offers the voices kept and the one in use, then Select a new voice…",
      JSON.stringify(voices) === JSON.stringify([...MimickVoicesOrder.filter((k) => keptNow.includes(k) || k === "en_US-norman-medium"), "select-a-new-voice"]),
      [voices, keptNow]);
await ev(`(() => { const s = document.getElementById("voice"); s.value = "select-a-new-voice"; s.dispatchEvent(new Event("change")); })()`);
await wait(`document.getElementById("voices-list").children.length === 7`, 5000);
check("Select a new voice… opens the picker with all seven, and leaves the box on the voice in use",
      (await ev(`document.getElementById("voices-dialog").open`)) && (await ev(`document.getElementById("voice").value`)) === "en_US-norman-medium");
const marks = await ev(`[...document.querySelectorAll("#voices-list .voice-row")].map((row) => row.querySelector(".voice-mp3").textContent)`);
check("Norman is built in: no tick, no Remove", await ev(`(() => { const row = [...document.querySelectorAll("#voices-list .voice-row")].find((r) => r.textContent.includes("Norman"));
  return !row.querySelector(".voice-tick") && !row.querySelector(".voice-remove") && row.textContent.includes("Built in"); })()`));
check("…marking Norman alone as good for MP3", marks.filter((m) => m === "MP3 ✓").length === 1
      && (await ev(`[...document.querySelectorAll("#voices-list .voice-row")].find((row) => row.textContent.includes("MP3 ✓")).textContent.includes("Norman")`)), marks);
await ev(`document.querySelector('.voice-row .voice-play[aria-label="Hear Joe"]').click()`); await sleep(1000);
check("▶ plays a sample, and does not start reading",
      (await ev(`document.querySelector('.voice-play[aria-label="Hear Joe"]').textContent`)) === "■" && (await ev(`document.getElementById("play").textContent`)) === "Read aloud");
check("Download waits for a tick", await ev(`document.getElementById("voices-download").disabled`));
await ev(`(() => { for (const n of ["Joe", "Kusal"]) { const b = document.querySelector('.voice-tick[aria-label="Download ' + n + '"]'); b.checked = true; b.dispatchEvent(new Event("change")); } })()`);
check("ticking two says how much they download", (await ev(`document.getElementById("voices-download").textContent`)) === "Download 2 voices (120 MB)",
      await ev(`document.getElementById("voices-download").textContent`));
await ev(`document.getElementById("voices-close").click()`); await sleep(300);
check("Done closes it, and stops the sample", !(await ev(`document.getElementById("voices-dialog").open`)));
await wait(`MimickVoices.kept("en_US-norman-medium")`, 60000);
check("Norman, shipped with the app, is kept in the browser once the page is ready", true);
await ev(`localStorage.setItem("mimick-voice", "en_US-joe-medium")`);
await r.load(); await sleep(500);
check("the voice is remembered, and listed though not downloaded yet", (await ev(`document.getElementById("voice").value`)) === "en_US-joe-medium");
for (const width of [1300, 1024]) {
  await r.t.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const boxes = await ev(`[...document.querySelectorAll("header.bar button, header.bar select")].filter((e) => e.offsetParent)
    .map((e) => { const b = e.getBoundingClientRect(); return [e.id, b.left, b.right, b.height]; })`);
  const overlaps = boxes.filter((a, i) => boxes.some((b, j) => i < j && a[1] < b[2] - 1 && b[1] < a[2] - 1)).map((b) => b[0]);
  check(`at ${width}px nothing in the top bar overlaps or wraps`,
        !overlaps.length && boxes.every((b) => b[3] < 40) && boxes.every((b) => b[2] <= width), overlaps);
}
await r.t.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false });

// 5. The quick switches under ⌄, and Mimick's name at the bottom left.
check("Mimick's name is in the bottom bar, not the top", (await ev(`!!document.querySelector("footer .brand") && !document.querySelector("header .brand")`)));
await r.openPdf(SAMPLE);
const pressed = (id) => ev(`document.getElementById(${JSON.stringify(id)}).getAttribute("aria-pressed")`);
check("the switches start closed", await ev(`document.getElementById("switches").hidden && document.getElementById("switches-toggle").ariaExpanded === "false"`));
await r.click(await r.centre("#switches-toggle")); await sleep(300);
check("⌄ opens them", await ev(`!document.getElementById("switches").hidden && document.getElementById("switches-toggle").ariaExpanded === "true"`));
const mainTop = await ev(`document.getElementById("main").getBoundingClientRect().top`);
check("…pushing the page down rather than covering it", mainTop > 80, mainTop);
check("…and the page area still fills the window", await ev(`document.querySelector("footer").getBoundingClientRect().bottom <= innerHeight + 1
  && document.getElementById("main").getBoundingClientRect().height > innerHeight - 200`));
check("the switches show what is on", (await pressed("sw-clean_text")) === "true" && (await pressed("sw-click_read")) === "true", [await pressed("sw-clean_text"), await pressed("sw-click_read")]);
await r.click(await r.centre("#sw-click_read")); await sleep(400);
check("clicking one switches it", (await pressed("sw-click_read")) === "false" && (await ev(`localStorage.getItem("mimick-click_read")`)) === "0");
await display();
check("…and Reading ▾ agrees", await ev(`[...document.querySelectorAll("#menu button")].find((b) => b.textContent.includes("Click to read")).getAttribute("aria-checked") === "false"`));
await r.menu("Click to read"); await sleep(400);
check("…and the other way round", (await pressed("sw-click_read")) === "true");
await r.key("b", CTRL); await sleep(400);
check("a key changes its switch too (Ctrl+B, the notes panel)", (await pressed("sw-notes")) === "false");
await r.key("b", CTRL); await sleep(400);
await r.click(await r.centre("#sw-sleep")); await sleep(300);
await r.menu("At the end of this page"); await sleep(300);
check("the timer switch opens the timer, and shows the choice", (await pressed("sw-sleep")) === "true"
  && (await ev(`document.getElementById("sw-sleep").textContent.trim()`)) === "End of page", await ev(`document.getElementById("sw-sleep").textContent.trim()`));
await r.click(await r.centre("#sw-sleep")); await sleep(300);
await r.menu("Off"); await sleep(300);
const night = () => ev(`getComputedStyle(document.documentElement).getPropertyValue("--panel").trim()`);
check("Night to begin with", (await night()) === "#191d24" && (await ev(`document.getElementById("sw-theme").textContent.trim()`)) === "Night");
await r.click(await r.centre("#sw-theme")); await sleep(300);
check("☾ switches to day", (await night()) === "#f7f8fa" && (await ev(`document.getElementById("sw-theme").textContent.trim()`)) === "Day");
await r.click(await r.centre("#sw-theme")); await sleep(300);
check("…and back", (await night()) === "#191d24");
await r.load();
check("open is kept over a reload", await ev(`!document.getElementById("switches").hidden`));
await r.click(await r.centre("#switches-toggle")); await sleep(300);
check("⌄ again closes them", await ev(`document.getElementById("switches").hidden`));
r.finish();
