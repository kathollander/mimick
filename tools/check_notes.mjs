/* Highlights, notes, the notes panel and the Highlight/Add note strip, in a
 * real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_notes.mjs
 *
 * Drives the reader with real clicks and keys (tools/cdp.mjs), against the
 * test paper (sample/test-paper.pdf), which carries one note of its own on page 2. Checks
 * highlighting, undo and redo (Ctrl+Z, Ctrl+Y), picking out, copying, the note editor, the
 * right-click menu, stepping between notes, notes coming back after a reload,
 * Download a copy (opened again with PyMuPDF from the desktop's venv), the
 * panel and its filters, and the strip's four homes. Needs no voice.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CTRL, SHIFT, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/test-paper.pdf");
const r = await startReader("check-notes");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);

const state = () => ev(`JSON.stringify({
  onPage: document.querySelectorAll('.page[data-page="0"] .hl.annot').length,
  colours: [...document.querySelectorAll('.page[data-page="0"] .hl.annot')].map((b) => b.style.background),
  cards: [...document.querySelectorAll("#cards .note-card")].map((c) => c.textContent),
  picked: document.querySelectorAll("#cards .note-card.picked").length,
  badge: document.querySelectorAll(".page .remove").length,
  quotes: document.getElementById("filter-quotes").textContent,
  notes: document.getElementById("filter-notes").textContent,
  count: document.getElementById("note-count").textContent,
  kept: document.getElementById("notes-kept").textContent,
  status: document.getElementById("status").textContent })`).then(JSON.parse);

let s = await state();
check("the sample's own note is counted", s.notes === "Notes  1" && s.quotes === "Highlights", [s.quotes, s.notes]);

// 1. Select and highlight.
const phrase = [await r.at(243, 260), await r.at(330, 260)];
await r.drag(...phrase);
await r.key("h", CTRL);
await sleep(600);
s = await state();
check("Ctrl+H highlights the selection", s.onPage === 1 && /Highlighted — 2 in this document/.test(s.status), [s.onPage, s.status]);
check("…and its card is in the panel, quoting it", s.cards.length === 1 && s.cards[0].includes("voice keeps the pace"), s.cards);
check("…counted on the chip", s.quotes === "Highlights  1", s.quotes);

// 2. Undo and redo.
await r.key("z", CTRL); await sleep(500);
s = await state();
check("Ctrl+Z takes it back", s.onPage === 0 && s.cards.length === 0 && /Highlight removed/.test(s.status), [s.onPage, s.status]);
await r.key("z", CTRL | SHIFT); await sleep(500);
s = await state();
check("Ctrl+Shift+Z puts it back", s.onPage === 1 && /Highlight put back/.test(s.status), [s.onPage, s.status]);
await r.key("z", CTRL); await sleep(500);
await r.key("y", CTRL); await sleep(500);
s = await state();
check("…and so does Ctrl+Y", s.onPage === 1 && /Highlight put back/.test(s.status), [s.onPage, s.status]);

// 3. Pick it out and copy it.
await r.click(await r.at(290, 260)); await sleep(400);
s = await state();
check("clicking it picks it out: card lit, × in the margin", s.picked === 1 && s.badge === 1, [s.picked, s.badge]);
await r.key("c", CTRL); await sleep(400);
const copied = await ev(`navigator.clipboard.readText()`);
check("Ctrl+C with nothing selected copies the highlight", copied === "voice keeps the pace", copied);

// 4. Write a note on it.
await r.click(await r.at(290, 260), 2); await sleep(500);
check("double-clicking it opens the note editor", await ev(`document.getElementById("note-dialog").open`));
await r.click(await r.centre("#note-title"));
await r.type("Where it lives");
await r.click(await r.centre("#note-text"));
await r.type("Knowledge sits in the land.");
await sleep(200);
s = await state();
check("the card shows the note as it is typed", s.cards[0]?.includes("Knowledge sits in the land."), s.cards);
await r.click(await r.centre('#note-colours .swatch[title="Green"]'));
// Back in the note, where the cursor is when someone has just finished writing.
await r.click(await r.centre("#note-text"));
await r.key("Enter", CTRL); await sleep(600);
s = await state();
check("Ctrl+Enter saves it: heading and note on the card", !(await ev(`document.getElementById("note-dialog").open`))
      && s.cards[0]?.startsWith("Where it lives") && /Note saved/.test(s.status), [s.cards, s.status]);
check("…in the colour picked", s.colours[0]?.startsWith("rgba(158, 230, 153"), s.colours);
check("…and the chips count it as a note now", s.notes === "Notes  2" && s.quotes === "Highlights", [s.quotes, s.notes]);
await r.key("z", CTRL); await sleep(500);
s = await state();
check("Ctrl+Z undoes the note change", !s.cards[0]?.includes("Knowledge") && /Note change undone/.test(s.status), s.cards);
await r.key("z", CTRL | SHIFT); await sleep(500);

// 5. The right-click menu on a highlight, and deleting.
await r.rightClick(await r.at(290, 260));
const labels = await r.menuLabels();
check("right-click on it offers copy, edit, read and delete",
      ["Copy the highlighted passage", "Copy the note", "Copy both", "Edit this note…", "Read this passage", "Delete this highlight"]
        .every((l) => labels?.includes(l)), labels);
await r.menu("Copy both"); await sleep(300);
const both = await ev(`navigator.clipboard.readText()`);
check("Copy both gives the passage and the note", both === "“voice keeps the pace”\n\nWhere it lives\nKnowledge sits in the land.", both);
await r.rightClick(await r.at(290, 260));
await r.menu("Delete this highlight"); await sleep(500);
s = await state();
check("Delete this highlight removes it", s.onPage === 0 && /Ctrl\+Z puts it back/.test(s.status), [s.onPage, s.status]);
await r.key("z", CTRL); await sleep(500);
s = await state();
check("…and Ctrl+Z brings it back with its note", s.onPage === 1 && s.cards[0]?.includes("Knowledge"), s.cards);

// 6. A second highlight, removed with its ×.
await r.drag(await r.at(120, 304), await r.at(200, 304));
await r.key("h", CTRL); await sleep(500);
await r.click(await r.at(160, 304)); await sleep(300);
await r.click(await r.centre(".page .remove")); await sleep(500);
s = await state();
check("the × on a picked-out highlight removes it", s.onPage === 1, s.onPage);

// 7. Next and previous note.
await r.click(await r.at(40, 40));
await r.key("j", CTRL); await sleep(400);
await r.key("j", CTRL); await sleep(600);
const page = Number(await ev(`document.getElementById("page").value`));
s = await state();
check("Ctrl+J twice goes to the sample's own note, on page 2", page === 2 && /Already in the file/.test(s.status + s.cards.join()), [page, s.status]);
await r.key("k", CTRL); await sleep(600);
check("Ctrl+K comes back to page 1", Number(await ev(`document.getElementById("page").value`)) === 1);
// The bottom of page 1 and the top of page 2 on screen: the notes of both stay in the column.
await ev(`(() => { const v = document.getElementById("view"); v.scrollTop = document.querySelector('.page[data-page="1"]').offsetTop - v.clientHeight / 4; })()`);
await sleep(600);
s = await state();
check("with two pages on screen, the column has the notes of both",
      s.cards.some((c) => c.includes("Knowledge")) && s.cards.some((c) => c.includes("Already in the file")), s.cards);
await ev(`document.getElementById("view").scrollTop = 0`); await sleep(800);

// 8. Kept in the browser: reload and open the same PDF again.
await wait(`/Kept in this browser/.test(document.getElementById("notes-kept").textContent)`, 10000);
check("the panel says they are kept", true);
await r.load();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);
await sleep(500);
s = await state();
check("after a reload, the highlights come back", s.onPage === 1 && s.notes === "Notes  2" && /from last time are back/.test(s.status),
      [s.onPage, s.notes, s.status]);

// 9. Save a copy. Headless Chrome has no save window to answer, so take the
// download every browser without showSaveFilePicker takes.
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker`);
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.key("s", CTRL);
let file = null;
for (let i = 0; i < 40 && !file; i++) {
  await sleep(250);
  file = fs.readdirSync(r.downloads).find((f) => f.endsWith(".pdf"));
}
check("Ctrl+S downloads a copy named (notes)", file === "test-paper (notes).pdf", file);
if (file) {
  const found = execFileSync(path.join(root, "../Mimick-linux/.venv/bin/python"), ["-c", `
import pymupdf, sys
d = pymupdf.open(sys.argv[1])
print(sorted((a.info["subject"], a.info["content"]) for p in d for a in p.annots()))`, path.join(r.downloads, file)]).toString().trim();
  check("…with both notes in it as real PDF annotations",
        found.includes("('Where it lives', 'Knowledge sits in the land.')") && found.includes("Already in the file."), found);
}

// 9b. Export notes, as Markdown, from File.
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.click(await r.centre("#file-menu")); await sleep(300);
await r.menu("Export notes…");
let md = null;
for (let i = 0; i < 40 && !md; i++) {
  await sleep(250);
  md = fs.readdirSync(r.downloads).find((f) => f.endsWith(".md"));
}
check("File → Export notes downloads the notes as text", md === "test-paper (notes).md", md);
if (md) {
  const text = fs.readFileSync(path.join(r.downloads, md), "utf8");
  check("…headed with the title, each under its page and section, the passage quoted, heading and note after",
        text.startsWith("# Notes: Listening to the Page") && text.includes("## Page 2 · 2. What Students Chose to Hear")
        && text.includes("> Highlighting while listening was common.") && text.includes("**Where it lives**")
        && text.includes("Knowledge sits in the land.") && text.includes("Already in the file."), text);
}

// 10. The panel and the strip.
await r.click(await r.centre("#filter-quotes")); await r.click(await r.centre("#filter-notes")); await sleep(300);
check("switching both filters off empties the panel", (await state()).cards.length === 0);
await r.click(await r.centre("#filter-quotes")); await r.click(await r.centre("#filter-notes")); await sleep(300);
const home = () => ev(`JSON.stringify([document.getElementById("markup").dataset.home, document.getElementById("markup").parentElement.id,
  document.getElementById("markup-top").hidden, document.getElementById("markup-bottom").hidden, document.getElementById("notes").hidden])`).then(JSON.parse);
check("the strip starts in the notes panel", JSON.stringify(await home()) === JSON.stringify(["panel", "markup-panel", true, true, false]), await home());
await r.key("b", CTRL); await sleep(400);
check("Ctrl+B hides the panel, and the strip moves to the top", JSON.stringify(await home()) === JSON.stringify(["top", "markup-top", false, true, true]), await home());
const grip = await r.centre("#markup-grip");
await r.drag(grip, [600, 450], 8);
check("dragged over the page, it floats there", (await home())[0] === "float");
// It cannot be lost: dragged past the window's edge it stops at it, and a
// smaller window keeps it in view.
const barBox = () => ev(`(() => { const b = document.getElementById("markup").getBoundingClientRect(), m = document.getElementById("main").getBoundingClientRect();
  return JSON.stringify([b.left >= m.left - 0.5 && b.right <= m.right + 0.5 && b.top >= m.top - 0.5 && b.bottom <= m.bottom + 0.5, Math.round(b.right), Math.round(m.right)]); })()`).then(JSON.parse);
{
  const from = await r.centre("#markup-grip");
  await r.mouse("mousePressed", from); await sleep(100);
  for (const x of [900, 1200, 1500, 2000]) { await r.mouse("mouseMoved", [x, 450]); await sleep(60); }
  check("dragged past the right edge, it stops at the edge", (await barBox())[0], await barBox());
  await r.mouse("mouseReleased", [2000, 450]); await sleep(400);
  check("…and stays inside once let go", (await home())[0] === "float" && (await barBox())[0], await barBox());
  await r.t.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  check("a smaller window keeps it in view", (await barBox())[0], await barBox());
  await r.t.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const [, right, edge] = await barBox();
  check("…and a bigger one puts it back where it was left", Math.abs(right - edge) <= 2, [right, edge]);
}
await r.drag(await r.centre("#markup-grip"), [600, 830], 8);
check("dragged to the foot, it goes across the bottom", JSON.stringify((await home()).slice(0, 4)) === JSON.stringify(["bottom", "markup-bottom", true, false]), await home());
await r.key("b", CTRL); await sleep(400);
await r.drag(await r.centre("#markup-grip"), await r.centre("#cards"), 8);
check("dragged onto the notes panel, it goes back in", (await home())[0] === "panel", await home());
await r.key("h", CTRL | SHIFT); await sleep(300);
check("Ctrl+Shift+H hides it", await ev(`document.getElementById("markup").hidden`));
await r.key("h", CTRL | SHIFT); await sleep(300);

// 10b. Keys pressed while the note editor is still on its way belong to it:
// Enter straight after Ctrl+M must not start reading.
await r.drag(await r.at(160, 275), await r.at(250, 275));
await r.key("m", CTRL);
await r.key("Enter");
await wait(`document.getElementById("note-dialog").open`);
await sleep(300);
check("Enter pressed as the note editor opens does not start reading",
      (await ev(`document.getElementById("play").textContent`)) === "Read aloud");
await r.key("Escape"); await sleep(500);
s = await state();
check("Esc on a new note keeps the highlight, and says so", /^Highlighted — /.test(s.status), s.status);
await r.key("z", CTRL); await sleep(500);

// 11. The menus in the header.
await r.click(await r.centre("#display-menu"));
const display = await r.menuLabels();
check("Display lists the panel, its filters, and where the buttons go",
      ["Notes panel", "Show highlights in the panel", "Highlight and note buttons", "Loose over the page"].every((l) => display?.includes(l)), display);
await r.key("Escape");
await r.click(await r.centre("#notes-menu"));
const notesMenu = await r.menuLabels();
check("Notes lists highlighting, stepping, undo and download",
      ["Highlight selection", "Go to next note", "Undo the last highlight or note", "Save a copy with your notes (PDF)…", "Export notes as text…", "Note appearance…"]
        .every((l) => notesMenu?.some((m) => m.endsWith(l))), notesMenu);
await r.menu("Note appearance…");
await r.click(await r.centre("#style-size"));
await ev(`(() => { const i = document.getElementById("style-size"); i.value = 14; i.dispatchEvent(new Event("input")); })()`);
await r.key("Enter"); await sleep(300);
const size = await ev(`document.getElementById("cards").style.fontSize`);
check("Note appearance changes the size of the cards", size === `${14 * 1.25}pt`, size);
r.finish();
