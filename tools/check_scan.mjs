/* A PDF with no text -- a scan without OCR -- says so, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_scan.mjs
 *
 * Makes a two-page PDF of drawn shapes and no text in the document worker's own
 * PyMuPDF, opens it, and checks the reader says there is nothing to read and
 * why, rather than a greyed-out Read aloud and silence. Needs no voice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const r = await startReader("check-scan");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();

// Opening something first starts the document worker, which makes the scan.
await r.openPdf(path.join(root, "sample/sample.pdf"));
const made = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf
doc = pymupdf.open()
for n in range(2):
    page = doc.new_page(width=595.276, height=841.89)
    for k in range(30):
        page.draw_rect(pymupdf.Rect(72, 90 + k * 22, 520, 102 + k * 22), color=(0.2, 0.2, 0.2), fill=(0.3, 0.3, 0.3))
base64.b64encode(doc.tobytes()).decode()
\`))`);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-scan-"));
const scan = path.join(folder, "scanned.pdf");
fs.writeFileSync(scan, Buffer.from(made, "base64"));

const { root: dom } = (await r.t.send("DOM.getDocument")).result;
const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
await r.t.send("DOM.setFileInputFiles", { nodeId, files: [scan] });
await wait(`/no text/i.test(document.getElementById("status").textContent)`, 30000).catch(() => {});
const status = await r.status();
check("a PDF with no text says there is nothing to read, and that it may be a scan", /2 pages · This PDF has no text to read.*scan/.test(status), status);
check("…Read aloud stays greyed, and its tooltip says why", await ev(`document.getElementById("play").disabled
  && /no text/.test(document.getElementById("play").title)`), await ev(`document.getElementById("play").title`));
check("…the pages are still shown", await ev(`document.querySelectorAll(".page").length > 0`));
await sleep(1500);
check("…and the message stays put", /no text/.test(await r.status()), await r.status());

fs.rmSync(folder, { recursive: true, force: true });
r.finish();
