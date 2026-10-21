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
// Any Python with PyMuPDF will do, to read the saved copy: MIMICK_PYTHON says which.
const PYTHON = process.env.MIMICK_PYTHON || path.join(root, "../Mimick-linux/.venv/bin/python");
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
// The editor moves: drag its grip, and it opens there again next time.
const editorBox = () => ev(`(({ left, top }) => JSON.stringify([Math.round(left), Math.round(top)]))(document.getElementById("note-dialog").getBoundingClientRect())`).then(JSON.parse);
const middle = await editorBox();
const noteGrip = await r.centre("#note-grip");
await r.drag(noteGrip, [noteGrip[0] - 300, noteGrip[1] + 200], 10); await sleep(300);
const moved = await editorBox();
check("dragging the editor's grip moves it", Math.abs(moved[0] - (middle[0] - 300)) < 4 && Math.abs(moved[1] - (middle[1] + 200)) < 4, [middle, moved]);
check("…and the page stays shaded behind it", await ev(`getComputedStyle(document.getElementById("note-dialog"), "::backdrop").backgroundColor !== "rgba(0, 0, 0, 0)"`));
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
await r.click(await r.at(290, 260), 2); await sleep(500);
const reopened = await editorBox();
check("the editor opens where it was dragged to", Math.abs(reopened[0] - moved[0]) < 4 && Math.abs(reopened[1] - moved[1]) < 4, [moved, reopened]);
await r.click(await r.centre("#note-grip"), 2); await sleep(300);
const back = await editorBox();
check("…and double-clicking its grip puts it back in the middle", Math.abs(back[0] - middle[0]) < 4 && Math.abs(back[1] - middle[1]) < 4, [middle, back]);
await r.key("Escape"); await sleep(400);
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

// 8. A recovery copy in the browser, until the work is in a file (Kat, 20
// October): after a crash, opening the same PDF again offers it back.
await wait(`/recovery copy \\d/.test(document.getElementById("notes-kept").textContent)`, 10000);
check("the panel and the status bar say the work is not in a file", /^Not saved to a file/.test((await state()).kept)
      && await ev(`!document.getElementById("unsaved").hidden && /Export your work before closing this tab/.test(document.getElementById("unsaved").textContent)`));
await r.crashReload();
await r.openPdf(SAMPLE);
await r.recover();
await wait(`!document.getElementById("markup-highlight").disabled`);
await sleep(500);
s = await state();
check("after a crash, Recover brings the highlights back, still unsaved", s.onPage === 1 && s.notes === "Notes  2"
      && /^Recovered: 1 highlight added or changed/.test(s.status) && await ev(`!document.getElementById("unsaved").hidden`), [s.onPage, s.notes, s.status]);

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
  const found = execFileSync(PYTHON, ["-c", `
import pymupdf, sys
d = pymupdf.open(sys.argv[1])
print(sorted((a.info["subject"], a.info["content"]) for p in d for a in p.annots()))`, path.join(r.downloads, file)]).toString().trim();
  check("…with both notes in it as real PDF annotations",
        found.includes("('Where it lives', 'Knowledge sits in the land.')") && found.includes("Already in the file."), found);
}

// 9b. Export notes, from File: a dialog asks which kind, Word first.
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.click(await r.centre("#file-menu")); await sleep(300);
await r.menu("Export notes…");
check("Export notes asks which kind, offering Word first", await ev(`document.getElementById("export-dialog").open
  && document.querySelector('input[name="export-kind"]:checked')?.value === "docx"`));
await r.click(await r.centre("#export-go"));
let docx = null;
for (let i = 0; i < 60 && !docx; i++) { await sleep(250); docx = fs.readdirSync(r.downloads).find((f) => f.endsWith(".docx")); }
check("…and exports a Word document", docx === "test-paper (notes).docx", fs.readdirSync(r.downloads));
if (docx) {
  const inside = execFileSync(PYTHON, ["-c", `
import zipfile, sys, re
z = zipfile.ZipFile(sys.argv[1])
print(" ".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", z.read("word/document.xml").decode())))`, path.join(r.downloads, docx)]).toString();
  check("…with the passages quoted, their pages, and the notes", inside.includes("Knowledge sits in the land.")
        && /\(p\. \d+\)/.test(inside) && inside.includes("Notes: Listening to the Page"), inside.slice(0, 300));
}
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.click(await r.centre("#file-menu")); await sleep(300);
await r.menu("Export notes…");
check("…and the kind chosen last comes first next time", await ev(`document.querySelector('input[name="export-kind"]:checked')?.value === "docx"`));
await r.click(await r.centre('input[name="export-kind"][value="md"]'));
await r.click(await r.centre("#export-go"));
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
        && text.includes("Highlighting while listening was common.”") && text.includes("**Where it lives**")
        && text.includes("Knowledge sits in the land.") && text.includes("Already in the file."), text);
}

// 9c. A browser can block a download the page starts, and not say so (Brave,
// once a tab has downloaded before). So the file waits in the bottom bar, and
// the reader's own click on it downloads it again.
check("the status says where the file went, without claiming it arrived",
      /^Sent test-paper \(notes\)\.md to your downloads: 2 highlights/.test(await r.status()), await r.status());
check("…and the bar offers it again", await ev(`!document.getElementById("status-file").hidden
  && document.getElementById("status-file").download === "test-paper (notes).md"`));
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.click(await r.centre("#status-file"));
let again = null;
for (let i = 0; i < 40 && !again; i++) { await sleep(250); again = fs.readdirSync(r.downloads).find((f) => f.endsWith(".md")); }
check("…and clicking it downloads it again", again === "test-paper (notes).md", fs.readdirSync(r.downloads));

// 10. The panel and the strip.
await r.click(await r.centre("#filter-quotes")); await r.click(await r.centre("#filter-notes")); await sleep(300);
check("switching both filters off empties the panel", (await state()).cards.length === 0);
await r.click(await r.centre("#filter-quotes")); await r.click(await r.centre("#filter-notes")); await sleep(300);
// The editing tools are three pieces, each with its own ⋯ (Kat, 19 October).
const home = (name = "mark") => ev(`(() => { const p = document.getElementById("piece-${name}");
  return JSON.stringify([p.dataset.home, p.parentElement.closest(".strip, .dock, #main").id,
  document.getElementById("markup-top").hidden, document.getElementById("markup-bottom").hidden, document.getElementById("notes").hidden]); })()`).then(JSON.parse);
// They start across the top: highlighting and sticky notes on the left, text
// formatting in the middle (Kat, 20 October).
check("the pieces start across the top", JSON.stringify(await home()) === JSON.stringify(["top-left", "markup-top", false, true, false])
      && (await home("sticky"))[0] === "top-left" && (await home("format"))[0] === "top-middle"
      && await ev(`document.getElementById("piece-mark").nextElementSibling === document.getElementById("piece-sticky")`),
      [await home(), await home("sticky"), await home("format")]);
await r.click(await r.centre("#display-menu"));
await r.menu("In the notes panel"); await sleep(400);
check("Display ▾ puts them all in the notes panel", JSON.stringify(await home()) === JSON.stringify(["panel", "markup-panel", true, true, false])
      && (await home("sticky"))[0] === "panel" && (await home("format"))[0] === "panel", await home());
await r.key("b", CTRL); await sleep(400);
check("Ctrl+B hides the panel, and the pieces go with it", JSON.stringify(await home()) === JSON.stringify(["panel", "markup-panel", true, true, true]), await home());
await r.key("b", CTRL); await sleep(400);
check("…and come back with it", JSON.stringify(await home()) === JSON.stringify(["panel", "markup-panel", true, true, false]), await home());
const grip = await r.centre("#grip-mark");
await r.drag(grip, [600, 450], 8);
check("dragged over the page, a piece floats there", (await home())[0] === "float");
check("…and the others stay in the panel", (await home("sticky"))[0] === "panel" && (await home("format"))[0] === "panel",
      [await home("sticky"), await home("format")]);
await r.key("b", CTRL); await sleep(400);
check("a loose piece stays loose when the panel is hidden", JSON.stringify(await home()) === JSON.stringify(["float", "main", true, true, true])
      && await ev(`document.getElementById("piece-mark").offsetParent !== null`), await home());
// It cannot be lost: dragged past the window's edge it stops at it, and a
// smaller window keeps it in view.
const barBox = () => ev(`(() => { const b = document.getElementById("piece-mark").getBoundingClientRect(), m = document.getElementById("main").getBoundingClientRect();
  return JSON.stringify([b.left >= m.left - 0.5 && b.right <= m.right + 0.5 && b.top >= m.top - 0.5 && b.bottom <= m.bottom + 0.5, Math.round(b.right), Math.round(m.right)]); })()`).then(JSON.parse);
{
  const from = await r.centre("#grip-mark");
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
// The top and bottom are split in three (Kat, 19 October).
const slotted = (name) => ev(`(() => { const p = document.getElementById("piece-${name}").getBoundingClientRect(),
  s = document.getElementById("piece-${name}").parentElement.closest(".strip")?.getBoundingClientRect();
  if (!s) return "[null, null]";
  return JSON.stringify([Math.round(p.left - s.left), Math.round(s.right - p.right)]); })()`).then(JSON.parse);
await r.drag(await r.centre("#grip-mark"), [650, 830], 8);
check("dragged to the foot's middle, it goes there", JSON.stringify((await home()).slice(0, 4)) === JSON.stringify(["bottom-middle", "markup-bottom", true, false]), await home());
{ const [l, rt] = await slotted("mark"); check("…centred in the bar", Math.abs(l - rt) <= 4, [l, rt]); }
await r.key("b", CTRL); await sleep(400);
await r.drag(await r.centre("#grip-format"), [1000, 830], 8);
check("another piece dragged to the foot's right sits on the right", (await home("format"))[0] === "bottom-right"
      && (await slotted("format"))[1] <= 20, [await home("format"), await slotted("format")]);
await r.drag(await r.centre("#grip-sticky"), [200, await ev(`document.getElementById("main").getBoundingClientRect().top + 10`)], 8);
check("one dragged to the top's left goes there, and the top bar shows", JSON.stringify((await home("sticky")).slice(0, 3)) === JSON.stringify(["top-left", "markup-top", false]),
      await home("sticky"));
await r.drag(await r.centre("#grip-sticky"), [600, 450], 8);
check("dragged off again, the empty top bar goes away", (await home("sticky"))[2] === true, await home("sticky"));
await r.click(await r.centre("#grip-sticky"), 2); await sleep(300);
await r.click(await r.centre("#grip-format"), 2); await sleep(300);
check("double-clicking a ⋯ puts that piece back where it started", (await home("sticky"))[0] === "top-left" && (await home("format"))[0] === "top-middle",
      [await home("sticky"), await home("format")]);
{
  // Kat, 1 October: it was unclear that the right-hand side docks it. While
  // dragging, the place it will go is outlined and labelled; the whole column
  // counts, down to its foot and out to the window's edge.
  const from = await r.centre("#grip-mark");
  const ghost = () => ev(`(() => { const g = document.getElementById("markup-ghost"), n = document.getElementById("notes").getBoundingClientRect(),
    b = document.getElementById("piece-mark").getBoundingClientRect();
    return JSON.stringify([!g.hidden, g.dataset.home, Math.abs(b.left - n.left) < 2 && Math.abs(b.width - n.width) < 2, g.textContent]); })()`).then(JSON.parse);
  await r.mouse("mousePressed", from); await sleep(100);
  for (const y of [700, 600, 450]) { await r.mouse("mouseMoved", [600, y]); await sleep(60); }
  check("dragged over the page, no outline shows", !(await ghost())[0], await ghost());
  const right = await ev(`Math.round(innerWidth - 3)`);
  for (const x of [900, 1100, right]) { await r.mouse("mouseMoved", [x, 760]); await sleep(60); }
  const shown = await ghost();
  check("at the far right, low down, it snaps into the notes column's shape, labelled", shown[0] && shown[1] === "panel" && shown[2]
        && shown[3] === "Drag and drop here.", shown);
  await r.mouse("mouseReleased", [right, 760]); await sleep(400);
  check("…and let go there, it goes back in", (await home())[0] === "panel" && !(await ghost())[0], await home());
}
// The order within a place is the reader's: dropped short of the middle of
// the one there, a piece goes first (Kat, 20 October).
{
  const sticky = await ev(`JSON.stringify((({ left, top, height }) => [left, top + height / 2])(document.getElementById("piece-sticky").getBoundingClientRect()))`).then(JSON.parse);
  await r.drag(await r.centre("#grip-format"), [Math.max(2, sticky[0] - 4), sticky[1]], 8);
  const order = () => ev(`JSON.stringify([...document.querySelector('#markup-top [data-slot="left"]').children].map((p) => p.dataset.piece))`).then(JSON.parse);
  check("a piece dropped before another in the same place goes first", JSON.stringify(await order()) === JSON.stringify(["format", "sticky"])
        && (await home("format"))[0] === "top-left", [await order(), await home("format")]);
  check("…and the order is kept", /^\["format","sticky"/.test(await ev(`localStorage.getItem("mimick-order-top-left")`)),
        await ev(`localStorage.getItem("mimick-order-top-left")`));
  // Picked up, format leaves the slot, so sticky moves to its start: aim just past where its end will be.
  const past = await ev(`document.querySelector('#markup-top [data-slot="left"]').getBoundingClientRect().left
    + document.getElementById("piece-sticky").getBoundingClientRect().width + 10`);
  await r.drag(await r.centre("#grip-format"), [past, sticky[1]], 8);
  check("…and dropped past it, it goes after", JSON.stringify(await order()) === JSON.stringify(["sticky", "format"]), await order());
  await r.click(await r.centre("#grip-format"), 2); await sleep(300);
}
await r.key("h", CTRL | SHIFT); await sleep(300);
check("Ctrl+Shift+H hides them", await ev(`["mark", "sticky", "format"].every((n) => document.getElementById("piece-" + n).hidden)`));
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
      ["Notes panel", "Show highlights in the panel", "Note appearance…", "Highlight and note buttons", "Loose over the page"].every((l) => display?.includes(l)), display);
await r.key("Escape");
await r.click(await r.centre("#notes-menu"));
const notesMenu = await r.menuLabels();
check("Notes lists highlighting, stepping, undo and download",
      ["Highlight selection", "Go to next note", "Undo the last highlight or note", "Save a copy with your notes (PDF)…", "Export notes…"]
        .every((l) => notesMenu?.some((m) => m.endsWith(l))), notesMenu);
await r.key("Escape");
await r.click(await r.centre("#display-menu"));
await r.menu("Note appearance…");
await r.click(await r.centre("#style-size"));
await ev(`(() => { const i = document.getElementById("style-size"); i.value = 14; i.dispatchEvent(new Event("input")); })()`);
await r.key("Enter"); await sleep(300);
const size = await ev(`document.getElementById("cards").style.fontSize`);
check("Note appearance changes the size of the cards", size === `${14 * 1.25}px`, size);
// Its sample is the cards' size at any zoom, not only at the first one.
await ev(`document.getElementById("zoom-in").click()`); await sleep(500);
const leftOpen = await ev(`JSON.stringify([...document.querySelectorAll("dialog[open]")].map((d) => d.id))`).then(JSON.parse);
for (const d of leftOpen) await ev(`document.getElementById(${JSON.stringify(d)}).close()`);
await r.click(await r.centre("#display-menu")); await sleep(300);
await r.menu("Note appearance…");
const sizes = await ev(`JSON.stringify(["cards", "style-sample"].map((id) => getComputedStyle(document.getElementById(id)).fontSize))`).then(JSON.parse);
check("Note appearance's sample is the size of the cards", sizes[0] === sizes[1], [sizes, leftOpen]);
await r.key("Escape"); await sleep(200);
await ev(`document.getElementById("zoom-out").click()`); await sleep(500);

// 12. A reminder to save to a file, and the switch that stops it. The wait is
// made three seconds here; a reader's is fifteen minutes.
for (const d of await ev(`JSON.stringify([...document.querySelectorAll("dialog[open]")].map((d) => d.id))`).then(JSON.parse)) {
  await ev(`document.getElementById(${JSON.stringify(d)}).close()`);
}
await ev(`localStorage.setItem("mimick-save-reminder-minutes", "0.05")`);
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.drag(await r.at(160, 275), await r.at(250, 275));
await r.key("h", CTRL);
await wait(`!document.getElementById("status-do").hidden`, 20000).catch(() => {});
check("unsaved highlights bring a reminder, with a button that saves",
      (await ev(`document.getElementById("status-do").textContent`)) === "Save a copy now"
      && /without being saved to a file/.test(await r.status()), await r.status());
await r.click(await r.centre("#status-do"));
await sleep(1500);
// The download itself may be blocked -- this tab has downloaded several times
// already, which is 9c's case -- so what is checked is what Mimick sent.
check("…the button saves the copy, and goes away", /^Sent test-paper \(notes\)\.pdf to your downloads/.test(await r.status())
      && await ev(`document.getElementById("status-do").hidden && document.getElementById("status-file").download === "test-paper (notes).pdf"`),
      await r.status());
await sleep(6000);
check("…and once saved, there is no reminder", await ev(`document.getElementById("status-do").hidden`));
await r.click(await r.centre("#notes-menu"));
await r.menu("Remind me to save every 15 minutes");
check("Notes ▾ turns the reminder off", (await ev(`localStorage.getItem("mimick-save-reminder")`)) === "0" && /No more reminders/.test(await r.status()));
await r.key("z", CTRL); await sleep(6000);
check("…after which a change brings none", await ev(`document.getElementById("status-do").hidden`));
await ev(`localStorage.removeItem("mimick-save-reminder-minutes"); localStorage.removeItem("mimick-save-reminder")`);

// 13. My own order, in Export notes (the panel's All notes until 19 October):
// every note as a row, dragged.
const rowsNow = () => ev(`JSON.stringify([...document.querySelectorAll("#export-list .order-row")].map((c) => c.textContent))`).then(JSON.parse);
const openExport = async () => { await r.click(await r.centre("#file-menu")); await sleep(300); await r.menu("Export notes…"); await sleep(300); };
await openExport();
check("Export notes offers page order, by colour, and my own", await ev(`[...document.querySelectorAll('input[name="export-order"]')].map((i) => i.value).join()`) === "page,colour,own"
      && await ev(`document.getElementById("export-list").hidden`));
await r.click(await r.centre('input[name="export-order"][value="own"]')); await sleep(300);
const allRows = await rowsNow();
check("My own order lists every note, with its page", allRows.length >= 2 && allRows.every((t) => /^p\. \d+/.test(t)), allRows);
// A drag, as the browser sends it: the last row dropped on the top half of the first.
await ev(`(() => {
  const rows = [...document.querySelectorAll("#export-list .order-row")], from = rows.at(-1), to = rows[0];
  const data = new DataTransfer(), box = to.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 10, clientY: box.top + 3 };
  from.dispatchEvent(new DragEvent("dragstart", at));
  to.dispatchEvent(new DragEvent("dragover", at));
  to.dispatchEvent(new DragEvent("drop", at));
  from.dispatchEvent(new DragEvent("dragend", at));
})()`);
await sleep(500);
const reordered = await rowsNow();
check("dragging the last row onto the first puts it first", reordered[0] === allRows.at(-1) && reordered.length === allRows.length, reordered);
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker`);
await r.click(await r.centre('input[name="export-kind"][value="md"]'));
await r.click(await r.centre("#export-go"));
await sleep(2000);
const exported = await ev(`document.getElementById("status-file").href`).then((href) => ev(`fetch(${JSON.stringify(href)}).then((r) => r.text())`));
const firstQuoted = (exported.match(/^> “(.+)$/m) || [])[1] ?? "";
check("…and the export follows it", (firstQuoted.match(/\(p\. (\d+)\)$/) || [])[1] === (reordered[0].match(/^p\. (\d+)/) || [])[1],
      [firstQuoted, reordered[0]]);
// Only Save a copy counts as saved (Kat, 20 October): after an export the
// warning stays, and so does the recovery copy, to come back after a crash.
check("exporting notes leaves the work unsaved", await ev(`!document.getElementById("unsaved").hidden`)
      && /^Not saved to a file/.test(await ev(`document.getElementById("notes-kept").textContent`)));
await ev(`document.getElementById("view").focus()`);
await r.key("y", CTRL); await sleep(600); await r.key("z", CTRL); await sleep(1500);
await r.crashReload();
await r.openPdf(SAMPLE);
await r.recover();
await wait(`!document.getElementById("markup-highlight").disabled`);
await sleep(800);
await openExport();
check("the order, and the choice of it, are kept when the document is opened again",
      await ev(`document.querySelector('input[name="export-order"]:checked').value`) === "own"
      && JSON.stringify(await rowsNow()) === JSON.stringify(reordered), await rowsNow());
await r.click(await r.centre('input[name="export-order"][value="page"]')); await sleep(300);
check("Page order hides the list", await ev(`document.getElementById("export-list").hidden`));
await r.key("Escape"); await sleep(300);
r.finish();
