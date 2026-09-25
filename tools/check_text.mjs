/* Opening a plain text file, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_text.mjs
 *
 * A .txt file is laid out as a PDF in the document worker (reader.text_to_pdf)
 * and then read as one. Checks it opens with its name as the title, reads,
 * keeps its line breaks, finds text, takes a highlight that comes back when the
 * same file is opened again, and that a file with no text says so. Needs no voice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CTRL, startReader } from "./cdp.mjs";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-text-"));
const file = path.join(folder, "Reading notes.txt");
const lines = [
  "Week three: listening while reading.",
  "",
  "The first chapter argues that a steady voice keeps attention from drifting.",
  "The second chapter disagrees, and says the reader should set the pace.",
  "",
  "Questions for the seminar:",
  "one, does speed matter;",
  "two, does the voice matter more than the speed?",
];
fs.writeFileSync(file, "﻿" + lines.join("\r\n") + "\r\n");
const empty = path.join(folder, "empty.txt");
fs.writeFileSync(empty, "\n\n   \n");

const r = await startReader("check-text");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(file);
check("a text file opens, titled with its name", (await ev(`document.getElementById("title").textContent`)) === "Reading notes",
      await ev(`document.getElementById("title").textContent`));
const status = await r.status();
check("…laid out as pages, with sentences to read", /1 pages? · [4-9] sentences to read/.test(status), status);
const text = await r.inWorker("document-worker.js", `python.then((py) => py.runPython("import reader; reader._open().doc[0].get_text()"))`);
check("…its line breaks kept as written", /seminar:\s*\none, does speed matter;\s*\ntwo,/.test(text), text.slice(0, 200));

await r.key("f", CTRL); await sleep(300);
await r.type("the speed"); await sleep(800);
check("Find works in it", (await ev(`document.getElementById("find-count").textContent`)) === "1 of 1",
      await ev(`document.getElementById("find-count").textContent`));
await r.key("Escape"); await sleep(400);
await r.key("h", CTRL); await sleep(800);
check("the found words can be highlighted", /Highlighted/.test(await r.status()), await r.status());
await sleep(1500);

await r.load();
await r.openPdf(file);
await wait(`document.querySelectorAll(".hl.annot").length > 0`, 20000).catch(() => {});
check("opened again, the highlight comes back", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);

const { root: dom } = (await r.t.send("DOM.getDocument")).result;
const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
await r.t.send("DOM.setFileInputFiles", { nodeId, files: [empty] });
await wait(`/Could not open empty\\.txt/.test(document.getElementById("status").textContent)`, 20000).catch(() => {});
check("a text file with nothing in it says so", /Could not open empty\.txt: .*no text/.test(await r.status()), await r.status());
fs.rmSync(folder, { recursive: true, force: true });
r.finish();
