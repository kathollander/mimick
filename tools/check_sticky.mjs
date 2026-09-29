/* Sticky notes, in a real Chrome: added, typed in and formatted, moved,
 * folded, deleted and undone, kept over a reload, saved into the PDF and
 * exported.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_sticky.mjs
 *
 * Drives the reader with real clicks and keys (tools/cdp.mjs) on the test
 * paper. The saved copy is opened again with PyMuPDF from the desktop's venv,
 * which is also what proves the formatting went into the PDF as rich text.
 * Needs no voice. The rich text itself -- what is kept of what the browser
 * types -- is pinned by the desktop's tools/check_sticky.py, the same code.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CTRL, SHIFT, root, startReader } from "./cdp.mjs";

const ALT = 1;
const SAMPLE = path.join(root, "sample/test-paper.pdf");
const PYTHON = path.join(root, "../Mimick-linux/.venv/bin/python");
const r = await startReader("check-sticky");
const { ev, wait, sleep, check, t } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-sticky").disabled`);

const state = () => ev(`JSON.stringify({
  boxes: [...document.querySelectorAll(".page .sticky")].map((s) => ({ xref: s.dataset.xref, html: s.querySelector(".sticky-text").innerHTML,
    left: s.style.left, top: s.style.top, folded: s.classList.contains("folded") })),
  focused: !!document.activeElement?.closest?.(".sticky"),
  cards: [...document.querySelectorAll("#cards .sticky-card")].map((c) => c.textContent),
  chip: document.getElementById("filter-sticky").textContent,
  live: document.getElementById("markup-format").classList.contains("live"),
  bold: document.getElementById("fmt-bold").getAttribute("aria-pressed"),
  play: document.getElementById("play").textContent,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const worker = () => r.inWorker("document-worker.js", `JSON.stringify(self.py ? null : null)`).catch(() => null);
const kept = () => ev(`new Promise((ok) => { const q = indexedDB.open("mimick-notes", 1); q.onsuccess = () => {
  const g = q.result.transaction("documents").objectStore("documents").getAll(); g.onsuccess = () => ok(JSON.stringify(g.result)); }; })`).then(JSON.parse);
const keyCode = async (key, code, vk, modifiers = 0) => {
  await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
  await t.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
};
void worker;

let s = await state();
check("+ Add sticky is on the strip, and its formatting row is waiting", s.boxes.length === 0 && !s.live
      && await ev(`!document.getElementById("markup-sticky").hidden && document.getElementById("fmt-bold").disabled`), s);

// 1. + Add sticky, then a click on the page.
await r.click(await r.centre("#markup-sticky")); await sleep(200);
check("+ Add sticky asks where it goes", /Click where the sticky note goes/.test((await state()).status), (await state()).status);
await r.click(await r.at(330, 420)); await sleep(1200);
s = await state();
check("a click puts a sticky note there, ready to type in", s.boxes.length === 1 && s.focused && s.live, s);

// 2. Type, and format with the keys and with the strip.
await r.type("Exam ");
await r.key("b", CTRL);
await r.type("bold");
await r.key("b", CTRL);
await r.type(" and ");
await keyCode("X", "KeyX", 88, CTRL | SHIFT);
await r.type("gone");
await keyCode("X", "KeyX", 88, CTRL | SHIFT);
await sleep(300);
s = await state();
check("Ctrl+B makes bold, as typed", /<b>bold<\/b>/.test(s.boxes[0].html), s.boxes[0].html);
check("Ctrl+Shift+X strikes out", /<(strike|s)>gone<\/(strike|s)>/.test(s.boxes[0].html), s.boxes[0].html);
check("Space typed in a sticky does not start reading", s.play === "Read aloud", s.play);
await r.type(" ");
await ev(`(() => { const b = document.getElementById("fmt-size"); b.value = "18"; b.dispatchEvent(new Event("change")); })()`);
await r.type("BIG");
await sleep(300);
s = await state();
check("the size box makes the next words that size", /font-size: calc\(18 \* var\(--pt\)\)[^>]*>BIG/.test(s.boxes[0].html), s.boxes[0].html);
await r.click(await r.centre("#fmt-italic")); await sleep(150);
await r.type(" slanted");
await sleep(200);
s = await state();
check("the strip's I makes italic, and the cursor stays in the note", /BIG.*<i>[^<]*slanted/.test(s.boxes[0].html) && s.focused, s.boxes[0].html);
await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await keyCode("*", "Digit8", 56, CTRL | SHIFT);
await r.type("a point");
await sleep(300);
// The new line carries on in the size and style of the one before, as in any editor.
check("Enter and Ctrl+Shift+8 start a bullet list on a line of its own", /slanted.*<ul><li>.*a point.*<\/li><\/ul>/.test((await state()).boxes[0].html)
      && !/<li>[^<]*Exam/.test((await state()).boxes[0].html), (await state()).boxes[0].html);

// 3. Esc finishes, and the worker keeps it as rich text.
await r.key("Escape"); await sleep(1500);
s = await state();
let saved = await kept();
const stored = saved[0]?.annotations?.find((a) => a.kind === "sticky");
check("Esc finishes: the note stays, and focus goes back to the page", s.boxes.length === 1 && !s.focused, s);
check("it is kept in this browser as clean rich text",
      !!stored && /<b>bold<\/b>/.test(stored.rich) && /<s>gone<\/s>/.test(stored.rich)
      && /font-size:18pt/.test(stored.rich) && /<ul><li>.*a point.*<\/li><\/ul>/.test(stored.rich), stored?.rich);
check("…with a plain copy of its words", stored?.text?.startsWith("Exam bold and gone BIG slanted"), stored?.text);
check("its card is in the panel, counted on the chip", s.cards.length === 1 && /Sticky note/.test(s.cards[0]) && s.chip === "Sticky  1",
      [s.cards, s.chip]);

// 4. Move it by its top edge, then undo the move.
const before = s.boxes[0];
await ev(`document.querySelector(".page .sticky").classList.add("picked")`);
const grip = await r.centre(".page .sticky .sticky-grip");
await r.drag([grip[0] - 30, grip[1]], [grip[0] - 230, grip[1] + 120], 8);
await sleep(800);
s = await state();
check("dragging its top edge moves it", s.boxes[0].left !== before.left && s.boxes[0].top !== before.top, [before, s.boxes[0]]);
await r.key("z", CTRL); await sleep(800);
s = await state();
check("Ctrl+Z puts it back where it was", s.boxes[0].left === before.left && s.boxes[0].top === before.top
      && /Move undone/.test(s.status), [before, s.boxes[0], s.status]);

// 5. Fold it, open it again.
await ev(`document.querySelector(".page .sticky").classList.add("picked")`);
await r.click(await r.centre(".page .sticky .sticky-fold")); await sleep(800);
s = await state();
check("▾ folds it to a tab", s.boxes[0].folded, s.boxes[0]);
await r.click(await r.centre(".page .sticky .sticky-tab")); await sleep(1000);
s = await state();
check("…and the tab opens it, ready to type", !s.boxes[0].folded && s.focused, s);
await r.key("Escape"); await sleep(800);

// 6. Delete, and undo.
await ev(`document.querySelector(".page .sticky").classList.add("picked")`);
await r.click(await r.centre(".page .sticky .sticky-delete")); await sleep(800);
s = await state();
check("× deletes it", s.boxes.length === 0 && s.chip === "Sticky" && /Ctrl\+Z puts it back/.test(s.status), s);
await r.key("z", CTRL); await sleep(1000);
s = await state();
check("Ctrl+Z puts it back, formatting and all", s.boxes.length === 1 && /<b>bold<\/b>/.test(s.boxes[0].html), s.boxes);

// 7. A sticky left empty goes again.
await r.key("m", CTRL | ALT); await sleep(1200);
s = await state();
check("Ctrl+Alt+M adds another", s.boxes.length === 2 && s.focused, s.boxes.length);
await r.key("Escape"); await sleep(1000);
s = await state();
check("…which, left empty, is taken away again", s.boxes.length === 1 && /Empty sticky note removed/.test(s.status), [s.boxes.length, s.status]);
// Nor anything to undo: Ctrl+Z goes past it to the step before, adding the first.
await r.key("z", CTRL); await sleep(800);
s = await state();
check("…and leaves no undo step: Ctrl+Z takes back the one before it", s.boxes.length === 0 && /Sticky note removed/.test(s.status),
      [s.boxes.length, s.status]);
await r.key("y", CTRL); await sleep(1000);
s = await state();
check("…and Ctrl+Y puts that one back as it was, not empty", s.boxes.length === 1 && /<b>bold<\/b>/.test(s.boxes[0].html), s.boxes);

// 8. A reload brings it back.
await r.load();
await r.openPdf(SAMPLE);
await wait(`document.querySelectorAll(".page .sticky").length === 1`, 20000).catch(() => {});
s = await state();
check("after a reload, the sticky note is back, formatting and all",
      s.boxes.length === 1 && /<b>bold<\/b>/.test(s.boxes[0].html) && /calc\(18/.test(s.boxes[0].html), s.boxes);

// 9. Save a copy: a FreeText annotation with rich text, where it was put.
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker`);
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.key("s", CTRL);
let file = null;
for (let i = 0; i < 40 && !file; i++) { await sleep(250); file = fs.readdirSync(r.downloads).find((f) => f.endsWith(".pdf")); }
check("Ctrl+S saves a copy, and says a sticky note went with it", !!file && /and 1 sticky note/.test((await state()).status),
      [file, (await state()).status]);
if (file) {
  const found = JSON.parse(execFileSync(PYTHON, ["-c", `
import json, pymupdf, sys
d = pymupdf.open(sys.argv[1])
out = []
for p in d:
    for a in p.annots(types=(pymupdf.PDF_ANNOT_FREE_TEXT,)):
        out.append({"page": p.number, "rect": list(a.rect), "plain": a.info["content"],
                    "rich": pymupdf.mupdf.pdf_annot_rich_contents(a.this)})
print(json.dumps(out))`, path.join(r.downloads, file)]).toString());
  check("…in which it is a text box on page 1, where it was put",
        found.length === 1 && found[0].page === 0 && Math.abs(found[0].rect[0] - 330) < 2 && Math.abs(found[0].rect[1] - 420) < 2,
        found.map((f) => [f.page, f.rect]));
  check("…with its formatting as rich text, and a plain copy", /<b>bold<\/b>/.test(found[0]?.rich) && /font-size:18pt/.test(found[0]?.rich)
        && found[0]?.plain.startsWith("Exam bold"), found[0]);
}

// 10. Export notes.
await r.click(await r.centre("#file-menu")); await sleep(300);
await r.menu("Export notes…");
check("Export notes counts it", /1 sticky note/.test(await ev(`document.getElementById("export-count").textContent`)),
      await ev(`document.getElementById("export-count").textContent`));
await r.click(await r.centre('input[name="export-kind"][value="md"]'));
await r.click(await r.centre("#export-go"));
await sleep(2000);
const exported = await ev(`document.getElementById("status-file").href`).then((href) => ev(`fetch(${JSON.stringify(href)}).then((r) => r.text())`));
check("…and the Markdown has it, bold and struck out", /\*\*Sticky note\*\*/.test(exported) && /\*\*bold\*\*/.test(exported)
      && /~~gone~~/.test(exported) && /- \*a point\*/.test(exported), exported);

// 11. Display ▾ → Sticky notes: off takes + Add sticky off the strip, not the notes off the page.
await r.click(await r.centre("#display-menu")); await sleep(300);
await r.menu("Sticky notes"); await sleep(400);
s = await state();
check("Display ▾ → Sticky notes off hides + Add sticky and the row", await ev(`document.getElementById("markup-sticky").hidden
      && document.getElementById("markup-format").hidden`));
check("…and the sticky notes stay on the page", s.boxes.length === 1, s.boxes.length);
await r.click(await r.centre("#switches-toggle")); await sleep(300);
check("the quick switch says it is off", await ev(`document.getElementById("sw-sticky").getAttribute("aria-pressed")`) === "false");
await r.click(await r.centre("#sw-sticky")); await sleep(300);
check("…and turns it back on", await ev(`!document.getElementById("markup-sticky").hidden`));

// 12. Ctrl+B outside a sticky is still the notes panel.
await ev(`document.getElementById("view").focus()`);
const panelWas = await ev(`!document.getElementById("notes").hidden`);
await r.key("b", CTRL); await sleep(300);
check("Ctrl+B outside a sticky still shows or hides the notes panel", (await ev(`!document.getElementById("notes").hidden`)) !== panelWas);
await r.key("b", CTRL); await sleep(300);

// 13. Read this sticky note, from its card's right-click menu: Norman reads
// its words, and the page's own text cursor stays where it was.
await ev(`localStorage.setItem("mimick-click_read", "0")`);
const caretBefore = await ev(`JSON.stringify(document.querySelector(".page .caret")?.style.cssText ?? null)`);
const card = await r.centre("#cards .sticky-card");
await r.rightClick(card);
await r.menu("Read this sticky note");
await wait(`/Reading your selection/.test(document.getElementById("status").textContent)`, 120000).catch(() => {});
check("Read this sticky note reads its words", /Reading your selection · sentence 1 of 2/.test((await state()).status),
      (await state()).status);
check("…and leaves the page's text cursor alone",
      await ev(`JSON.stringify(document.querySelector(".page .caret")?.style.cssText ?? null)`) === caretBefore);
await r.key(" "); await sleep(300);

r.finish();
