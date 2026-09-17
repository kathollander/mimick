/* Convert to MP3, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_convert.mjs
 *
 * Drives the reader with real clicks and keys (tools/cdp.mjs), against the
 * test paper (sample/test-paper.pdf). Converts its first page for real -- the first run downloads
 * en_US-norman-medium, 61 MB, into this check's own Chrome profile -- and checks
 * the file with ffprobe; then starts the whole document and cancels it. A
 * headless Chrome has no save window to answer, so this takes the download
 * path, which every browser without showSaveFilePicker takes too.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/test-paper.pdf");
const r = await startReader("check-convert");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker; "showSaveFilePicker" in window`);
await r.openPdf(SAMPLE);

const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
const set = (id, value, event = "change") => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)});
  e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)})); })()`);

// 1. The menu and the dialog.
await r.click(await r.centre("#file-menu")); await sleep(300);
const labels = await r.menuLabels();
check("File lists Open, Find, Save, Export notes, Forget and Convert to MP3", JSON.stringify(labels) === JSON.stringify(["Open…", "Find in document…", "Save a copy (PDF)…", "Export notes…", "Forget this document…", "Convert to MP3…"]), labels);
await r.menu("Convert to MP3…");
check("Convert to MP3 opens its window", await ev(`document.getElementById("convert-dialog").open`));
check("…offering only the voice with no licence question, Norman",
      JSON.stringify(await ev(`[...document.getElementById("convert-voice").options].map((o) => o.value)`)) === JSON.stringify(["en_US-norman-medium"]));
await wait(`/^Conversion from text to audio: /.test(document.getElementById("convert-time").textContent)`, 20000);
check("…with the name, and an estimate for the whole document",
      (await ev(`document.getElementById("convert-name").value`)).startsWith("Listening to the Page") && (await ev(`document.getElementById("convert-time").dataset.sentences`)) === "29",
      [await text("convert-time"), await text("convert-length")]);
await set("convert-scope", "pages");
await set("convert-to", "1", "input");
await wait(`!/Working out/.test(document.getElementById("convert-time").textContent)`, 20000);
const pageOne = Number(await ev(`document.getElementById("convert-time").dataset.sentences`));
check("Pages 1 to 1 narrows it", pageOne > 0 && pageOne < 29, await text("convert-time"));
const atOne = await text("convert-length");
await set("convert-speed", "2");
await sleep(500);
check("…and the length follows the speed", /^Finished Audio Length: .+ approximately\.$/.test(await text("convert-length"))
      && (await text("convert-length")) !== atOne, [atOne, await text("convert-length")]);
check("the cleanup starts as Display has it", await ev(`document.getElementById("convert-clean").checked`));
const cleaned = Number(await ev(`document.getElementById("convert-time").dataset.sentences`));
await ev(`(() => { const e = document.getElementById("convert-clean"); e.checked = false; e.dispatchEvent(new Event("change")); })()`);
check("…and unticked, it says the document is read again", /^Reading the document again with the cleanup off/.test(await text("convert-time")), await text("convert-time"));
await wait(`!/Working out|Reading the document again/.test(document.getElementById("convert-time").textContent)`, 60000);
const verbatim = Number(await ev(`document.getElementById("convert-time").dataset.sentences`));
// The reference list, on page 3, is left out by the cleanup, and read verbatim.
const pageThree = (tidy) => r.inWorker("document-worker.js", `python.then((py) => py.runPython(
  "import reader, json; json.dumps(reader.convert_texts('pages', 2, 2, ${tidy ? "True" : "False"}))"))`).then(JSON.parse);
const [tidied, asPrinted] = [await pageThree(true), await pageThree(false)];
const reference = (texts) => texts.some((t) => t.includes("Rivera, A."));
check("…and unticked, the text is read verbatim for this conversion, reference list and all",
      verbatim > 0 && reference(asPrinted) && !reference(tidied), [cleaned, verbatim, asPrinted.length, tidied.length]);
await ev(`(() => { const e = document.getElementById("convert-clean"); e.checked = true; e.dispatchEvent(new Event("change")); })()`);
await wait(`!/Working out/.test(document.getElementById("convert-time").textContent)`, 20000);
await set("convert-name", "page one");

// 2. Convert it.
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.click(await r.centre("#convert-go"));
await sleep(500);
check("Convert closes the window and shows progress in the corner",
      !(await ev(`document.getElementById("convert-dialog").open`)) && !(await ev(`document.getElementById("convert-progress").hidden`)));
check("…and the reader stays usable meanwhile", (await text("play")) === "Read aloud");
await wait(`/^Saved|did not finish/.test(document.getElementById("convert-progress-heading").textContent)`, 400000);
check("it finishes", /^Saved page one\.mp3/.test(await text("convert-progress-heading")),
      [await text("convert-progress-heading"), await text("convert-progress-detail")]);
let file = null;
for (let i = 0; i < 40 && !file; i++) { await sleep(250); file = fs.readdirSync(r.downloads).find((f) => f.endsWith(".mp3")); }
check("…and downloads page one.mp3", file === "page one.mp3", fs.readdirSync(r.downloads));
if (file) {
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,channels",
                                         "-of", "json", path.join(r.downloads, file)]).toString();
  const { streams: [stream], format } = JSON.parse(probe);
  check("…which is a mono MP3 with sound in it", stream.codec_name === "mp3" && stream.channels === 1 && Number(format.duration) > 5,
        [stream.codec_name, stream.channels, format.duration]);
  const said = (await text("convert-progress-detail")).match(/about (\d+) minute|under a minute/);
  check("…as long as it says", !!said, [await text("convert-progress-detail"), format.duration]);
}
await r.click(await r.centre("#convert-stop")); await sleep(300);
check("Close puts the corner window away", await ev(`document.getElementById("convert-progress").hidden`));

// 3. Start the whole document, and cancel it.
for (const f of fs.readdirSync(r.downloads)) fs.unlinkSync(path.join(r.downloads, f));
await r.click(await r.centre("#file-menu")); await sleep(300);
await r.menu("Convert to MP3…");
await wait(`/^Conversion from text to audio: /.test(document.getElementById("convert-time").textContent)`, 20000);
await r.click(await r.centre("#convert-go"));
await wait(`/Sentence [3-9] of/.test(document.getElementById("convert-progress-detail").textContent)`, 120000);
check("the whole document counts its sentences as it goes", / of 29 · /.test(await text("convert-progress-detail")), await text("convert-progress-detail"));
await r.click(await r.centre("#file-menu")); await sleep(300);
check("…and File says one is running", (await r.menuLabels())?.includes("(off) Converting to MP3…"), await r.menuLabels());
await r.key("Escape");
await r.click(await r.centre("#convert-stop")); await sleep(1500);
check("Cancel stops it and says nothing was saved", /cancelled — nothing was saved/.test(await r.status())
      && await ev(`document.getElementById("convert-progress").hidden`), await r.status());
await sleep(1500);
check("…and nothing is downloaded", fs.readdirSync(r.downloads).length === 0, fs.readdirSync(r.downloads));
r.finish();
