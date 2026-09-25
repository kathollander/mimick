/* A PDF with no text -- a scan without OCR -- says so, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_scan.mjs
 *
 * Makes a two-page PDF of drawn shapes and no text in the document worker's own
 * PyMuPDF, opens it, and checks the reader says there is nothing to read and
 * why, rather than a greyed-out Read aloud and silence. Then a page whose only
 * region is skipped in the reading order: it says how to choose what is read,
 * again after a reload, and the reading order can still put it back. Needs no voice.
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
check("a PDF with no text says there is nothing to read, and that it may be a scan", /^2 pages · This PDF has no text to read.*scan/.test(status), status);
check("…Read aloud stays greyed, and its tooltip says why", await ev(`document.getElementById("play").disabled
  && /no text/.test(document.getElementById("play").title)`), await ev(`document.getElementById("play").title`));
check("…the pages are still shown", await ev(`document.querySelectorAll(".page").length > 0`));
await sleep(1500);
check("…and the message stays put", /no text/.test(await r.status()), await r.status());

// Words, but none of them read: its only region switched off in the reading order.
const refs = await r.inWorker("document-worker.js", `python.then((py) => py.runPython(\`
import base64, pymupdf
doc = pymupdf.open()
page = doc.new_page(width=595.276, height=841.89)
page.insert_textbox(pymupdf.Rect(72, 90, 520, 400), chr(10).join(["References", "1. Rivera, A.; Okafor, B. Listening and reading together. J. Study Skills 2021, 8, 101-115.", "2. Chen, L. Speed and attention in audio learning. Learn. Res. Q. 2019, 14, 22-37."]), fontsize=11)
base64.b64encode(doc.tobytes()).decode()
\`))`);
const only = path.join(folder, "one-page.pdf");
fs.writeFileSync(only, Buffer.from(refs, "base64"));
await r.t.send("DOM.setFileInputFiles", { nodeId: (await r.t.send("DOM.querySelector", { nodeId: (await r.t.send("DOM.getDocument")).result.root.nodeId, selector: "#file" })).result.nodeId, files: [only] });
await wait(`/^1 page · /.test(document.getElementById("status").textContent) && !/getting/.test(document.getElementById("status").textContent)`, 30000).catch(() => {});
await sleep(500);
check("a page of text opens with sentences to read", /^1 page · [1-9]\d* sentences to read/.test(await r.status()), await r.status());
await r.key("r", 2); await sleep(1200);
const region = await r.at(150, 125);
await r.click(region); await sleep(2500);
let said = await r.status();
check("skipping the only region leaves nothing to read, and Read aloud says so",
  /Now skipping that region — 0 sentences/.test(said) && await ev(`document.getElementById("play").disabled
    && /Nothing here is set to be read/.test(document.getElementById("play").title)`), said);
await r.load();
await r.t.send("DOM.setFileInputFiles", { nodeId: (await r.t.send("DOM.querySelector", { nodeId: (await r.t.send("DOM.getDocument")).result.root.nodeId, selector: "#file" })).result.nodeId, files: [only] });
await wait(`/^1 page · /.test(document.getElementById("status").textContent) && !/getting/.test(document.getElementById("status").textContent)`, 30000).catch(() => {});
await sleep(800);
said = await r.status();
check("opened again, it says how to choose what is read", /^1 page · Nothing here is set to be read.*reading order/.test(said), said);
check("…the reading order still shows for it", (await ev(`document.querySelectorAll(".plan").length`)) > 0);
await r.click(await r.at(150, 125)); await sleep(2500);
said = await r.status();
check("…and clicking the region puts it back, readable", /Now reading that region — [1-9]/.test(said) && !(await ev(`document.getElementById("play").disabled`)), said);

fs.rmSync(folder, { recursive: true, force: true });
r.finish();
