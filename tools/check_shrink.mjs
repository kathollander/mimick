/* A big PDF of photographs is shrunk to 150 dpi as it opens, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_shrink.mjs
 *
 * Makes a "photographed" copy of the test paper in the document worker -- each
 * page a 400 dpi JPEG (each copy a dot finer, so PyMuPDF does not reuse one
 * picture for them all) with the page's own text over it, so it is not a scan to
 * recognise -- big enough to be shrunk, and opens it. Checks the bottom bar
 * says so, that the pictures the reader holds are 150 dpi, that a highlight
 * made on the shrunk copy comes back when the same file is opened again (the
 * key is the original file's), and that a small PDF is left as it is. Needs
 * no voice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const r = await startReader("check-shrink");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`localStorage.setItem("mimick-click_read", "0")`);
await r.openPdf(path.join(root, "sample/test-paper.pdf"));
await wait(`/sentences to read/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
check("a small PDF is not shrunk", !/shrunk/.test(await r.status()), await r.status());

// Made in the worker and handed over in pieces: one answer of several
// megabytes is more than the debugging connection carries.
const length = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf, reader
src = reader._open().doc
out = pymupdf.open()
for copy in range(3):
    for p in src:
        page = out.new_page(width=p.rect.width, height=p.rect.height)
        page.insert_image(page.rect, stream=p.get_pixmap(dpi=400 + copy, annots=False).tobytes("jpeg", jpg_quality=95))
        page.show_pdf_page(page.rect, src, p.number)
reader._made = base64.b64encode(out.tobytes(deflate=True)).decode()
len(reader._made)
\`))`);
let made = "";
for (let at = 0; at < length; at += 2_000_000) {
  made += await r.inWorker("document-worker.js", `python.then((py) => py.runPython("import reader; reader._made[${at}:${at + 2_000_000}]"))`);
}
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-shrink-"));
const photos = path.join(folder, "photographed paper.pdf");
fs.writeFileSync(photos, Buffer.from(made, "base64"));
const size = fs.statSync(photos).size;
check(`the photographed copy is big enough to be shrunk (${(size / 1e6).toFixed(1)} MB)`, size >= 5e6, size);
const openPhotos = async () => {
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [photos] });
};

await openPhotos();
await wait(`/^9 pages.*sentences to read/.test(document.getElementById("status").textContent)`, 120000).catch(() => {});
const said = await r.status();
check("opening it says its pictures were shrunk to 150 dpi, and by how much",
      /^9 pages \(pictures shrunk to 150 dpi, \d+ MB → \d+ MB\) · \d+ sentences to read/.test(said), said);
const dpi = JSON.parse(await r.inWorker("document-worker.js", `python.then((py) => py.runPython(
  "import reader, json; d = reader._open().doc; json.dumps([round(i['width'] / ((i['bbox'][2] - i['bbox'][0]) / 72)) for p in d for i in p.get_image_info()])"))`));
check("the pictures the reader holds are 150 dpi", dpi.length === 9 && dpi.every((n) => n >= 140 && n <= 155), dpi);
check("…and every page is still drawn", await ev(`document.querySelectorAll(".page canvas, .page img").length > 0`));

await r.click(await r.at(200, 300)); await sleep(200);
await r.key("a", CTRL); await sleep(500);
await r.key("h", CTRL); await sleep(1500);
check("a shrunk page can be highlighted", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);
await sleep(1200);

await r.load();
await openPhotos();
await wait(`/^9 pages.*sentences to read/.test(document.getElementById("status").textContent)`, 120000).catch(() => {});
await wait(`document.querySelectorAll(".hl.annot").length > 0`, 20000).catch(() => {});
check("opened again, the highlight comes back (the key is the original file's)",
      (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0, await r.status());

fs.rmSync(folder, { recursive: true, force: true });
r.finish();
