/* Everything that is not already a PDF, opened in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_documents.mjs
 *
 * Opens the seven sample/test-document.* files -- .docx, .odt, .epub, .html,
 * .md, .rtf and .fb2, all of them the same document in seven formats -- and
 * checks each is laid out as pages with its title, sentences to read and its
 * headings in the contents panel, and that its words are the document's own.
 * Six of the seven say exactly the same words, which is the point of them: a
 * set of notes means the same thing whichever one the reader opened. Then a
 * slide deck, which comes out a page per slide with its titles as contents
 * entries; that a highlight comes back when a file is opened again; and that a
 * file that only claims to be a Word document says it cannot be opened.
 *
 * The samples are tools/make_test_documents.sh's and tools/make_test_slides.py's,
 * except the .md and .fb2, which are written by hand. Needs no voice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const r = await startReader("check-documents");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`localStorage.setItem("mimick-click_read", "0")`);   // a click selects, and never starts the voice

const setFile = async (file) => {
  const { root: dom } = (await r.t.send("DOM.getDocument")).result;
  const { nodeId } = (await r.t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
  await r.t.send("DOM.setFileInputFiles", { nodeId, files: [file] });
};
const state = () => ev(`JSON.stringify({
  title: document.getElementById("title").textContent,
  status: document.getElementById("status").textContent,
  contents: [...document.querySelectorAll("#contents-list .toc-link")].map((l) => l.textContent),
  ready: !document.getElementById("play").disabled,
  pages: document.getElementById("total").textContent })`).then(JSON.parse);

/* What each format is expected to put in the contents panel. They differ
 * honestly: LibreOffice's .odt and .epub start the outline at the first
 * sub-heading rather than the document's own name, and Rich Text has no
 * headings at all to make entries out of -- it keeps the words and lets the
 * formatting go. `words` is the set the file's text is compared against. */
const HEADINGS = ["Notes on Listening", "Why listen", "How to begin", "A small table"];
const KINDS = [
  { kind: "docx", contents: HEADINGS },
  { kind: "odt", contents: HEADINGS.slice(1) },
  { kind: "epub", contents: ["Why listen"] },
  { kind: "html", contents: HEADINGS },
  { kind: "md", contents: HEADINGS },
  { kind: "rtf", contents: [] },
  // FictionBook is a format for prose, so its sample has the chapters and not
  // the table; the five words in that table are the only ones it lacks.
  { kind: "fb2", contents: HEADINGS.slice(0, 3), without: /Speed|Feeling|Careful/ },
];

const said = (text) => text.replace(/\s+/g, " ");
for (const { kind, contents, without } of KINDS) {
  const file = path.join(root, `sample/test-document.${kind}`);
  await r.openPdf(file);
  const s = await state();
  check(`.${kind} opens, titled`, s.title === "Notes on Listening", s.title);
  // The page count and the play button, not the status line: on a first visit
  // "Ready to work offline" lands on top of the status just as a file opens,
  // and which file it lands on is a matter of timing. check_firefox.mjs reads
  // it the same way, for the same reason.
  check(`…laid out as a page, with something to read`, s.pages === "of 1" && s.ready, `${s.pages}, play ${s.ready ? "on" : "off"}`);
  const words = await r.inWorker("document-worker.js", `python.then((py) => py.runPython("import reader; reader._open().doc[0].get_text()"))`);
  check(`…its words the document's own`, /eyes and the ears hold each other to the line/.test(said(words))
    && /That is the end of the document/.test(words), words.slice(0, 160));
  if (without) check(`…and only the words that format carries`, !without.test(words), said(words).slice(0, 160));
  else check(`…the table among them, as in every other format`, /Speed\s*Feeling/.test(said(words)), said(words).slice(0, 160));
  check(`…its headings in the contents panel`, JSON.stringify(s.contents) === JSON.stringify(contents), s.contents);
}

/* The bar shows from the moment a file is chosen, not only once there is a PDF
 * to open: a deck is several seconds of laying out, and before this it showed
 * nothing at all for them. Sampled while a deck opens, since a deck is the one
 * that counts its slides. */
{
  await r.load();
  await r.reset();
  await ev(`localStorage.setItem("mimick-click_read", "0")`);
  await ev(`window.__bar = [];
    window.__watch = setInterval(() => {
      const b = document.getElementById("loading");
      if (!b.hidden) window.__bar.push([document.getElementById("loading-label").textContent,
                                        parseInt(document.getElementById("loading-fill").style.width),
                                        document.getElementById("loading-detail").textContent]);
    }, 100);`);
  await setFile(path.join(root, "sample/test-slides.pptx"));
  await wait(`!document.getElementById("play").disabled`, 60000);
  await ev(`clearInterval(window.__watch)`);
  const seen = JSON.parse(await ev(`JSON.stringify(window.__bar)`));
  const labels = seen.map(([l]) => l);
  const widths = seen.map(([, w]) => w);
  check("the bar shows while a file is laid out, before any page exists",
    labels.some((l) => /^Reading the slides of test-slides\.pptx…$/.test(l)), [...new Set(labels)]);
  check("…and counts the slides as they are drawn",
    seen.some(([, , d]) => /^Slide \d+ of 3\.$/.test(d)), seen.map((s) => s[2]).filter(Boolean));
  check("…then carries the same bar on into opening it",
    labels.some((l) => /Opening|Drawing the pages|ready to read aloud/.test(l)), [...new Set(labels)]);
  check("…without ever going backwards",
    widths.every((w, i) => i === 0 || w >= widths[i - 1]), widths.join(" "));
}

/* A slide deck: one page per slide, each slide's title a contents entry. */
for (const kind of ["pptx", "odp"]) {
  await r.openPdf(path.join(root, `sample/test-slides.${kind}`));
  const s = await state();
  check(`.${kind} opens as one page per slide`, s.pages === "of 3" && s.ready, `${s.pages}, play ${s.ready ? "on" : "off"}`);
  check(`…every slide's title in the contents panel`,
    JSON.stringify(s.contents) === JSON.stringify(["Reading a Deck Aloud", "What a slide becomes", "What is left behind"]), s.contents);
  const words = await r.inWorker("document-worker.js", `python.then((py) => py.runPython("import reader; reader._open().doc[1].get_text()"))`);
  check(`…and the words on the slide, not just its title`, /The words land where the slide put them/.test(said(words)), said(words).slice(0, 160));
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
