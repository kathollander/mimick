/* Formatted notes, sticky-note titles, and sticky notes linked to highlights,
 * in a real Chrome (Kat's asks, 15 October 2026).
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_links.mjs
 *
 * Drives the reader with real clicks and keys (tools/cdp.mjs) on the test
 * paper: bold in a note, kept through undo and a reload; a sticky added from a
 * highlight's menu, linked from the start, its card under the highlight's;
 * picking either lighting the other; a title, written and undone; unlinking
 * and linking again by clicking; and the saved copy, opened with PyMuPDF from
 * the desktop's venv, holding the note's rich text, the title and the links.
 * What is kept of what the browser types is pinned by the desktop's
 * tools/check_links.py, the same code.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CTRL, root, startReader } from "./cdp.mjs";

const ALT = 1;
const SAMPLE = path.join(root, "sample/test-paper.pdf");
// Any Python with PyMuPDF will do, to read the saved copy: MIMICK_PYTHON says which.
const PYTHON = process.env.MIMICK_PYTHON || path.join(root, "../Mimick-linux/.venv/bin/python");
const r = await startReader("check-links");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);

const state = () => ev(`JSON.stringify({
  cards: [...document.querySelectorAll("#cards .note-card")].map((c) => ({ text: c.textContent, sticky: c.classList.contains("sticky-card"),
    attached: c.classList.contains("attached"), partner: c.classList.contains("partner"), picked: c.classList.contains("picked"),
    html: c.querySelector(".body")?.innerHTML ?? "", heading: c.querySelector(".heading")?.textContent ?? "" })),
  boxes: [...document.querySelectorAll(".page .sticky")].map((s) => ({ title: s.querySelector(".sticky-title").textContent,
    titled: s.classList.contains("titled"), partner: s.classList.contains("partner") })),
  partnerMarks: document.querySelectorAll(".page .hl.annot.partner").length,
  lines: document.querySelectorAll(".page svg.link-line").length,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const editorHtml = () => ev(`document.getElementById("note-text").innerHTML`);
const pressed = (what) => ev(`document.querySelector('#note-format [data-fmt="${what}"]').getAttribute("aria-pressed")`);

// 1. A note with bold in it.
const phrase = [await r.at(243, 260), await r.at(330, 260)];
await r.drag(...phrase);
await r.key("m", CTRL); await sleep(900);
check("Ctrl+M opens the note editor, with its formatting row", await ev(`document.getElementById("note-dialog").open
      && !!document.querySelector('#note-format [data-fmt="bold"]')`));
await r.type("Read ");
await r.key("b", CTRL);
await r.type("this");
check("…Ctrl+B in the note turns bold on, and the row says so", await pressed("bold") === "true", await pressed("bold"));
await r.key("b", CTRL);
await r.type(" twice");
await r.type("\n");
await r.click(await r.centre('#note-format [data-fmt="list"]'));
await r.type("slowly");
await sleep(200);
let html = await editorHtml();
check("…and the note has the bold word and a list", /<b>this<\/b>/.test(html) && /<li>slowly<\/li>/.test(html), html);
await r.key("Enter", CTRL); await sleep(800);
let s = await state();
let mark = s.cards.find((c) => !c.sticky && /Read this twice/.test(c.text));
check("saved, its card shows it formatted", !!mark && /<b>this<\/b>/.test(mark.html) && /<li>slowly<\/li>/.test(mark.html),
      s.cards);

// Undo takes the highlight and note away together; redo brings back the formatting.
await r.key("z", CTRL); await sleep(600);
await r.key("y", CTRL); await sleep(800);
s = await state();
mark = s.cards.find((c) => !c.sticky && /Read this twice/.test(c.text));
check("Ctrl+Z, Ctrl+Y: the note comes back still formatted", !!mark && /<b>this<\/b>/.test(mark.html), s.cards);

// Opened again, the editor shows the formatting; a change to it is one undo.
await r.click(await r.at(290, 260), 2); await sleep(600);
html = await editorHtml();
check("the editor opens with the formatting in it", /<b>this<\/b>/.test(html), html);
await ev(`(() => { const b = document.querySelector("#note-text b"); const range = document.createRange();
  range.selectNodeContents(b); getSelection().removeAllRanges(); getSelection().addRange(range); document.getElementById("note-text").focus(); })()`);
await r.key("i", CTRL);
await r.key("Enter", CTRL); await sleep(800);
s = await state();
mark = s.cards.find((c) => !c.sticky && /Read this twice/.test(c.text));
check("italics added to the bold word", !!mark && /<b><i>this<\/i><\/b>|<i><b>this<\/b><\/i>/.test(mark.html), mark?.html);
await r.key("z", CTRL); await sleep(800);
s = await state();
mark = s.cards.find((c) => !c.sticky && /Read this twice/.test(c.text));
check("Ctrl+Z takes off just the italics", !!mark && /<b>this<\/b>/.test(mark.html) && !/<i>/.test(mark.html), mark?.html);

// 2. Add a sticky note about this: linked from the start.
await r.rightClick(await r.at(290, 260));
await r.menu("Add a sticky note about this"); await sleep(1500);
await r.type("Ask about this in class");
// A list made of the line being typed keeps the cursor at its end: Chrome
// put it back at the start, and the next words went in front (15 October).
await r.click(await r.centre("#fmt-list")); await sleep(200);
await r.type(" today");
await sleep(300);
const stuck = await ev(`document.querySelector(".page .sticky .sticky-text").innerHTML`);
check("the strip's list button keeps the cursor where it was", /<li>Ask about this in class today<\/li>/.test(stuck), stuck);
await r.key("Escape"); await sleep(1200);
s = await state();
const order = s.cards.map((c) => (c.sticky ? "S" : "H"));
const at = s.cards.findIndex((c) => !c.sticky && /Read this twice/.test(c.text));
check("a highlight's menu adds a sticky note about it", s.boxes.length === 1, s.boxes);
check("…whose card comes straight after the highlight's, set in under it", s.cards[at + 1]?.sticky && s.cards[at + 1].attached,
      order);
check("…saying which passage it is on, and headed 📌", /On “voice keeps the pace/.test(s.cards[at + 1]?.text)
      && s.cards[at + 1].heading === "📌 Sticky note", s.cards[at + 1]);

// 3. Picking either lights up the other, and a line joins them on the page.
await r.click(await r.centre("#cards .sticky-card .body")); await sleep(500);
s = await state();
check("picking the sticky lights its highlight, on the page and in the panel",
      s.partnerMarks > 0 && s.cards.find((c) => !c.sticky && /Read this/.test(c.text))?.partner, [s.partnerMarks, s.cards]);
check("…with a dashed line from one to the other", s.lines === 1, s.lines);
await r.click(await r.at(290, 260)); await sleep(500);
s = await state();
check("picking the highlight lights its sticky", s.boxes[0]?.partner && s.cards.find((c) => c.sticky)?.partner, s);

// 4. A title, written on the card's heading; undone and put back.
await r.click(await r.centre("#cards .sticky-card .heading"), 2); await sleep(600);
check("double-clicking its card's heading opens a title box on the note", await ev(`!!document.querySelector(".page .sticky .sticky-title-input")
      && document.activeElement?.classList.contains("sticky-title-input")`));
await r.type("Question");
await r.key("Enter"); await sleep(800);
s = await state();
check("Enter keeps the title: on the note's top edge and the card, with 📌", s.boxes[0]?.title === "📌 Question" && s.boxes[0].titled
      && s.cards.find((c) => c.sticky)?.heading === "📌 Question", [s.boxes, s.cards.map((c) => c.heading)]);
await r.key("z", CTRL); await sleep(800);
s = await state();
check("Ctrl+Z takes the title off", s.boxes[0]?.title === "" && s.cards.find((c) => c.sticky)?.heading === "📌 Sticky note",
      [s.boxes, s.status]);
await r.key("y", CTRL); await sleep(800);
s = await state();
check("…and Ctrl+Y puts it back", s.boxes[0]?.title === "📌 Question", s.boxes);
// Esc leaves a title as it was.
await r.rightClick(await r.centre("#cards .sticky-card"));
await r.menu("Change its title…"); await sleep(500);
await r.type(" never kept");
await r.key("Escape"); await sleep(600);
check("Esc in the title box leaves the title as it was", (await state()).boxes[0]?.title === "📌 Question", (await state()).boxes);

// 5. Unlinked from the menu, linked again by clicking.
await r.rightClick(await r.centre("#cards .sticky-card"));
await r.menu("Unlink it from its highlight"); await sleep(800);
s = await state();
check("Unlink it: its card is on its own again", s.cards.find((c) => c.sticky) && !s.cards.find((c) => c.sticky).attached, s.cards);
await r.rightClick(await r.centre("#cards .sticky-card"));
await r.menu("Link it to a highlight…"); await sleep(300);
check("Link it to a highlight… asks for a click", /Click a highlight/.test((await state()).status), (await state()).status);
await ev(`document.getElementById("view").focus()`);
await r.key("Escape"); await sleep(300);
check("…and Esc stops", /Not linked/.test((await state()).status) && !await ev(`document.body.classList.contains("linking")`),
      (await state()).status);
await r.rightClick(await r.centre("#cards .sticky-card"));
await r.menu("Link it to a highlight…"); await sleep(300);
await r.click(await r.at(290, 260)); await sleep(1000);
s = await state();
check("clicking the highlight links it", s.cards.find((c) => c.sticky)?.attached && /linked to “voice keeps the pace/.test(s.status),
      [s.cards, s.status]);

// 6. Deleting the highlight leaves the sticky; undo links them again.
await r.rightClick(await r.at(290, 260));
await r.menu("Delete this highlight"); await sleep(800);
s = await state();
check("deleting the highlight leaves its sticky, on its own", s.boxes.length === 1 && !s.cards.find((c) => c.sticky)?.attached, s.cards);
await r.key("z", CTRL); await sleep(1000);
s = await state();
check("…and Ctrl+Z puts the highlight back, linked again", s.cards.find((c) => c.sticky)?.attached
      && /<b>this<\/b>/.test(s.cards.find((c) => !c.sticky && /Read this/.test(c.text))?.html), s.cards);

// 7. Recovered after a crash, all of it.
await sleep(1200);                       // the recovery copy is kept a moment after the last change
await r.crashReload();
await r.openPdf(SAMPLE);
await r.recover();
await wait(`document.querySelectorAll(".page .sticky").length === 1`, 20000).catch(() => {});
await sleep(800);
s = await state();
check("after a crash and Recover: the formatted note, the title and the link", s.boxes[0]?.title === "📌 Question"
      && s.cards.find((c) => c.sticky)?.attached
      && /<b>this<\/b>/.test(s.cards.find((c) => !c.sticky && /Read this/.test(c.text))?.html), s.cards);

// 8. Save a copy: what other programs will find in it.
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker`);
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await ev(`document.getElementById("view").focus()`);
await r.key("s", CTRL);
let file = null;
for (let i = 0; i < 40 && !file; i++) { await sleep(250); file = fs.readdirSync(r.downloads).find((f) => f.endsWith(".pdf")); }
check("Ctrl+S saves a copy", !!file, file);
if (file) {
  const found = JSON.parse(execFileSync(PYTHON, ["-c", `
import json, pymupdf, sys
d = pymupdf.open(sys.argv[1])
marks, notes = [], []
for p in d:
    for a in p.annots(types=(pymupdf.PDF_ANNOT_HIGHLIGHT,)):
        rc = pymupdf.mupdf.pdf_annot_rich_contents(a.this) if pymupdf.mupdf.pdf_annot_has_rich_contents(a.this) else ""
        marks.append({"plain": a.info["content"], "rc": rc, "name": a.info["id"]})
    for a in p.annots(types=(pymupdf.PDF_ANNOT_FREE_TEXT,)):
        notes.append({"subject": a.info["subject"], "link": d.xref_get_key(a.xref, "MimickLink")[1]})
print(json.dumps({"marks": marks, "notes": notes}))`, path.join(r.downloads, file)]).toString());
  const mine = found.marks.find((m) => m.plain.startsWith("Read this twice"));
  check("…the note is plain words for every reader", mine?.plain === "Read this twice\n• slowly", found.marks);
  check("…and rich text, bold and list, for Acrobat", /<b>this<\/b>/.test(mine?.rc) && /<li>slowly<\/li>/.test(mine?.rc), mine);
  check("…the sticky's title is its Subject", found.notes[0]?.subject === "Question", found.notes);
  check("…and it names the highlight it is linked to", !!mine && found.notes[0]?.link === mine.name && mine.name.startsWith("mimick-"),
        [found.notes, mine?.name]);
}

r.finish();
