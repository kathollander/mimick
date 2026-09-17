/* Word, OpenDocument and EPUB files, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_documents.mjs
 *
 * Opens sample/test-document.docx, .odt and .epub (made from
 * tools/test-document.html by tools/make_test_documents.sh) and checks each is
 * laid out as pages with its title, sentences to read and its headings in the
 * contents panel, that its words are the document's own, and that a highlight
 * on one comes back when it is opened again. Then that a file that only claims
 * to be a Word document says it cannot be opened. Needs no voice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const r = await startReader("check-documents");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();

const setFile = async (file) => {
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [file] });
};
const state = () => ev(`JSON.stringify({
  title: document.getElementById("title").textContent,
  status: document.getElementById("status").textContent,
  contents: [...document.querySelectorAll("#contents-list .toc-link")].map((l) => l.textContent),
  pages: document.getElementById("total").textContent })`).then(JSON.parse);

for (const kind of ["docx", "odt", "epub"]) {
  const file = path.join(root, `sample/test-document.${kind}`);
  await r.openPdf(file);
  const s = await state();
  check(`.${kind} opens, titled`, s.title === "Notes on Listening", s.title);
  check(`…laid out as pages, with sentences to read`, /^1 page · ([5-9]|[1-9][0-9]) sentences to read/.test(s.status), s.status);
  const words = await r.inWorker("document-worker.js", `python.then((py) => py.runPython("import reader; reader._open().doc[0].get_text()"))`);
  check(`…its words the document's own`, /eyes and the ears hold each other to the line/.test(words.replace(/\s+/g, " "))
    && /That is the end of the document/.test(words), words.slice(0, 160));
  if (kind !== "epub") {
    check(`…its headings in the contents panel`, JSON.stringify(s.contents) === JSON.stringify(["Notes on Listening", "Why listen", "How to begin", "A small table"]), s.contents);
  } else {
    check(`…its table of contents in the panel`, s.contents[0] === "Notes on Listening", s.contents);
  }
}

// A highlight on the Word file comes back.
await r.openPdf(path.join(root, "sample/test-document.docx"));
await r.click(await r.at(200, 200));
await r.key("a", CTRL); await sleep(300);
await r.key("h", CTRL); await sleep(1500);
check("a highlight can be made on it", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);
await r.load();
await r.openPdf(path.join(root, "sample/test-document.docx"));
await wait(`document.querySelectorAll(".hl.annot").length > 0`, 20000).catch(() => {});
check("…and comes back when it is opened again", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);

// Not really a Word file.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-documents-"));
const fake = path.join(folder, "broken.docx");
fs.writeFileSync(fake, "this is not a zip file");
await setFile(fake);
await wait(`/Could not open broken\\.docx/.test(document.getElementById("status").textContent)`, 30000).catch(() => {});
check("a file that is not really a Word document says it cannot be opened", /Could not open broken\.docx: .*Word document/.test(await r.status()), await r.status());
fs.rmSync(folder, { recursive: true, force: true });
r.finish();
