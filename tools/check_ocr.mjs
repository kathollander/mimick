/* Recognising the text of a scan (OCR), in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_ocr.mjs
 *
 * Makes a scan of the test paper in the document worker -- each page drawn as a
 * picture at 150 dpi into a new PDF, with no text -- and opens it. Checks it
 * recognises its own text as it opens, with a Stop beside it; that recognising reads
 * the words back, near enough the printed ones, as sentences to read that Find
 * finds and that can be highlighted, with each word's box over the word in the
 * picture; that opening the scan again puts the text back without reading the
 * pages again; and that Forget this document takes the recognised text away
 * too, and Stop stops it; that a half-scanned PDF recognises only its pictures;
 * that a scan with only some of its words is left alone until the Reading menu
 * is asked, which adds the words it lacked and no second copy of the others;
 * and that a scan of more than 20 pages asks first, with a button. Needs no voice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const r = await startReader("check-ocr");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`localStorage.setItem("mimick-click_read", "0")`);
await r.openPdf(path.join(root, "sample/test-paper.pdf"));

const made = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf, reader
src = reader._open().doc
out = pymupdf.open()
for p in src:
    page = out.new_page(width=p.rect.width, height=p.rect.height)
    page.insert_image(page.rect, pixmap=p.get_pixmap(dpi=150, annots=False))
base64.b64encode(out.tobytes(deflate=True)).decode()
\`))`);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-ocr-"));
const scan = path.join(folder, "scanned paper.pdf");
fs.writeFileSync(scan, Buffer.from(made, "base64"));
const openScan = async () => {
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [scan] });
};

// 1. A short scan recognises its own text as it opens (Kat, 23 September).
const t0 = Date.now();
await openScan();
await wait(`/Recognising text: page/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
check("a short scan starts recognising by itself, and says how far it has got", /Recognising text: page \d of 3/.test(await r.status()), await r.status());
check("…with a Stop beside it", await ev(`!document.getElementById("status-do").hidden && document.getElementById("status-do").textContent === "Stop"`));
await wait(`/sentences to read/.test(document.getElementById("status").textContent)`, 180000).catch(() => {});
const seconds = Math.round((Date.now() - t0) / 1000);
const said = await r.status();
const sentences = Number(said.match(/(\d+) sentences to read/)?.[1] ?? 0);
check(`the words are read back, as sentences to read (${seconds}s for 3 pages)`, sentences >= 20, said);
const text = await r.inWorker("document-worker.js", `python.then((py) => py.runPython("import reader; ' '.join(p.get_text() for p in reader._open().doc)"))`);
const flat = text.replace(/\s+/g, " ");
check("…near enough the printed words", /Reading a long article is tiring for anyone/.test(flat) && /Highlighting while listening was common/.test(flat), flat.slice(0, 300));
const box = JSON.parse(await r.inWorker("document-worker.js", `python.then((py) => py.runPython(
  "import reader, json; json.dumps([list(map(round, w[:4])) for w in reader._open().doc[0].get_text('words') if w[4] == 'Introduction'][0])"))`));
check("…each where it is in the picture (Introduction, in points)", Array.isArray(box) && Math.abs(box[0] - 84) < 6 && Math.abs(box[1] - 197) < 6, box);   // printed at [84.2, 196.6]

await r.key("f", CTRL); await sleep(300);
await r.type("listening"); await sleep(1000);
check("Find finds the recognised words", /^1 of [3-9]/.test(await ev(`document.getElementById("find-count").textContent`)),
      await ev(`document.getElementById("find-count").textContent`));
await r.key("Escape"); await sleep(300);
await r.click(await r.at(200, 300)); await sleep(200);
await r.key("a", CTRL); await sleep(500);
await r.key("h", CTRL); await sleep(1500);
check("a recognised page can be highlighted", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);
await sleep(1200);

// 3. Opened again: the text comes back without reading the pages again.
await r.load();
const t1 = Date.now();
await openScan();
await wait(`!document.getElementById("play").disabled`, 60000).catch(() => {});
check("opened again, the text is put back straight away", !(await ev(`document.getElementById("play").disabled`)) && Date.now() - t1 < 20000, [await r.status(), Date.now() - t1]);
await wait(`document.querySelectorAll(".hl.annot").length > 0`, 10000).catch(() => {});
check("…with the highlight", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);
await r.click(await r.centre("#reading-menu")); await sleep(300);
check("…and nothing left to recognise", (await r.menuLabels())?.includes("(off) Recognise text in this scan…"), await r.menuLabels());
await r.key("Escape"); await sleep(200);
await r.click(await r.centre("#file-menu")); await sleep(300);

// 4. Forget takes the recognised text too.
await r.menu("Forget this document…"); await sleep(300);
await r.click(await r.centre("#forget-go")); await sleep(1200);
await openScan();
await wait(`/Recognising text: page/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
check("after Forget, the scan has no text again, and is recognised afresh", /Recognising text: page/.test(await r.status()), await r.status());
await r.click(await r.centre("#status-do"));
await wait(`/Stopped recognising text/.test(document.getElementById("status").textContent)`, 30000).catch(() => {});
check("Stop stops it, and the button goes", /Stopped recognising text/.test(await r.status()) && await ev(`document.getElementById("status-do").hidden`), await r.status());

// 5. Half a scan: a page of text, then pages that are pictures. Only those are read.
await r.openPdf(path.join(root, "sample/test-paper.pdf"));
const halfMade = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf, reader
src = reader._open().doc
out = pymupdf.open()
out.insert_pdf(src, from_page=0, to_page=0)
for p in list(src)[1:]:
    page = out.new_page(width=p.rect.width, height=p.rect.height)
    page.insert_image(page.rect, pixmap=p.get_pixmap(dpi=150, annots=False))
base64.b64encode(out.tobytes(deflate=True)).decode()
\`))`);
const half = path.join(folder, "half scanned.pdf");
fs.writeFileSync(half, Buffer.from(halfMade, "base64"));
{
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [half] });
}
const firstCount = 8;           // the first page's sentences, read from its own text
await wait(`/Recognising text: page \\d of 2/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
check("…and recognises only those two", /Recognising text: page \d of 2/.test(await r.status()), await r.status());
await wait(`/sentences to read/.test(document.getElementById("status").textContent) && !/pictures/.test(document.getElementById("status").textContent)`, 120000).catch(() => {});
const halfAfter = await r.status();
check("…after which the whole paper reads", Number(halfAfter.match(/(\d+) sentences to read/)?.[1] ?? 0) > firstCount && !/pictures/.test(halfAfter), [firstCount, halfAfter]);

// 5b. A scan with only some of its words written in (Kat, 4 October): it has
// text, so it is left alone as it opens, but the Reading menu recognises the rest.
await r.openPdf(path.join(root, "sample/test-paper.pdf"));
const partMade = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf, reader
src = reader._open().doc
out = pymupdf.open()
for p in src:
    page = out.new_page(width=p.rect.width, height=p.rect.height)
    page.insert_image(page.rect, pixmap=p.get_pixmap(dpi=150, annots=False))
    for x0, y0, x1, y1, text, *_ in p.get_text("words"):
        if y1 < 230:
            page.insert_text((x0, y1 - 2), text, fontsize=(y1 - y0) * 0.8, render_mode=3)
base64.b64encode(out.tobytes(deflate=True)).decode()
\`))`);
const part = path.join(folder, "partly recognised.pdf");
fs.writeFileSync(part, Buffer.from(partMade, "base64"));
{
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [part] });
}
await wait(`/partly recognised/.test(document.title) && /sentences to read/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
await sleep(3000);
const partBefore = await r.status();
const partCount = Number(partBefore.match(/(\d+) sentences to read/)?.[1] ?? 0);
check("a scan with some of its words is not recognised by itself", partCount > 0 && !/Recognising|pictures/.test(partBefore)
      && await ev(`document.getElementById("status-do").hidden`), partBefore);
await r.click(await r.centre("#reading-menu")); await sleep(300);
check("…but the Reading menu offers to", (await r.menuLabels())?.includes("Recognise text in this scan…"), await r.menuLabels());
await r.menu("Recognise text in this scan…");
await wait(`/Recognising text: page \\d of 3/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
check("…and reads all three pages", /Recognising text: page \d of 3/.test(await r.status()), await r.status());
await wait(`/sentences to read/.test(document.getElementById("status").textContent)`, 180000).catch(() => {});
const partAfter = await r.status();
check("…after which there is more to read", Number(partAfter.match(/(\d+) sentences to read/)?.[1] ?? 0) > partCount + 10, [partBefore, partAfter]);
const twice = JSON.parse(await r.inWorker("document-worker.js", `python.then((py) => py.runPython(
  "import reader, json; t = ' '.join(' '.join(p.get_text() for p in reader._open().doc).split()); json.dumps([t.count('Introduction'), t.count('Highlighting while listening')])"))`));
check("…the words it had are not written in twice, and the ones it lacked are there", twice[0] === 1 && twice[1] === 1, twice);
await sleep(1500);
await r.click(await r.centre("#reading-menu")); await sleep(300);
check("…and nothing is left to recognise", (await r.menuLabels())?.includes("(off) Recognise text in this scan…"), await r.menuLabels());
await r.key("Escape"); await sleep(200);

// 6. A long scan asks first: 21 pages, the paper seven times over as pictures.
await r.openPdf(path.join(root, "sample/test-paper.pdf"));
const longMade = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf, reader
src = reader._open().doc
out = pymupdf.open()
for _ in range(7):
    for p in src:
        page = out.new_page(width=p.rect.width, height=p.rect.height)
        page.insert_image(page.rect, pixmap=p.get_pixmap(dpi=40, annots=False))
base64.b64encode(out.tobytes(deflate=True)).decode()
\`))`);
const long = path.join(folder, "long scan.pdf");
fs.writeFileSync(long, Buffer.from(longMade, "base64"));
{
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [long] });
}
await wait(`!document.getElementById("status-do").hidden`, 60000).catch(() => {});
await sleep(3000);
check("a scan of 21 pages does not start by itself, and says how long it would take",
      /^21 pages · 21 pages are pictures with no text\. Recognising the words takes about a minute/.test(await r.status()), await r.status());
check("…and offers a button to start it", (await ev(`document.getElementById("status-do").textContent`)) === "Recognise the text");
await r.click(await r.centre("#status-do"));
await wait(`/Recognising text: page \\d+ of 21/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
check("…which starts it", /Recognising text: page \d+ of 21/.test(await r.status()), await r.status());
await r.click(await r.centre("#status-do"));
await wait(`/Stopped recognising text/.test(document.getElementById("status").textContent)`, 30000).catch(() => {});

fs.rmSync(folder, { recursive: true, force: true });
r.finish();
