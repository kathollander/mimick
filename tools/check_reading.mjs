/* Does the browser read a document into the same sentences as the desktop app?
 *
 *     node tools/check_reading.mjs
 *
 * Runs the desktop's document.py, unchanged, under Pyodide, and compares what
 * it makes of the sample against sample/expected-reading.json, which the
 * desktop app produced: every sentence's text, every word's index, text and
 * rectangle, which words are spoken, and where the voice's words land on the
 * page words (align_marks). Both with the reading cleanup on and off, because
 * word indices must not move between the two -- annotations depend on it
 * (desktop trap 9).
 *
 * Anything but an exact match means the two versions would read or highlight
 * differently. Regenerate the baseline after a deliberate change; the command
 * is at the top of reading.py.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { loadReadingPython } = require(path.join(root, "js/python.js"));

const problems = [];
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  — " + detail : ""}`);
  if (!ok) problems.push(what);
};

const py = await loadReadingPython({
  loadPyodide,
  readText: async (p) => fs.readFileSync(path.join(root, p), "utf8"),
  pyodideDir: path.join(root, "vendor/pyodide") + path.sep,
});
py.globals.set("pdf_bytes", new Uint8Array(fs.readFileSync(path.join(root, "sample/mdpi-sample.pdf"))));
const started = performance.now();
const got = JSON.parse(await py.runPythonAsync(`
import json, reading
json.dumps(reading.read(bytes(pdf_bytes.to_py())), ensure_ascii=False, sort_keys=True)
`));
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const want = JSON.parse(fs.readFileSync(path.join(root, "sample/expected-reading.json"), "utf8"));

for (const mode of ["clean", "raw"]) {
  const a = got[mode], b = want[mode];
  const label = mode === "clean" ? "cleaned up for reading" : "as extracted";
  check(`${label}: the same pages, words and readable words`,
        a.pages === b.pages && a.words === b.words && a.readable === b.readable,
        `${a.words} words, ${a.readable} readable, vs ${b.words}, ${b.readable}`);
  check(`${label}: the same number of sentences`, a.sentences.length === b.sentences.length,
        `${a.sentences.length} vs ${b.sentences.length}`);

  const differ = (field) => {
    let count = 0, first = "";
    for (let i = 0; i < Math.min(a.sentences.length, b.sentences.length); i++) {
      if (JSON.stringify(a.sentences[i][field]) !== JSON.stringify(b.sentences[i][field])) {
        count++;
        if (!first) first = `sentence ${i}: ${JSON.stringify(a.sentences[i][field]).slice(0, 160)}` +
                            ` vs ${JSON.stringify(b.sentences[i][field]).slice(0, 160)}`;
      }
    }
    return { count, first };
  };
  for (const [field, what] of [["text", "every sentence says the same words"],
                               ["page", "and starts on the same page"],
                               ["words", "every word has the same index, text and rectangle"],
                               ["aligned", "the voice's words land on the same page words"]]) {
    const { count, first } = differ(field);
    check(`${label}: ${what}`, count === 0, count ? `${count} differ; first: ${first}` : "");
  }
}

// Trap 9: switching the cleanup must not move a word. Its text may change --
// the cleanup mends ligatures -- but not its index or where it sits.
const indexOf = (mode) => new Map(got[mode].sentences.flatMap((s) => s.words.map((w) => [w[0], JSON.stringify(w[2])])));
const [clean, raw] = [indexOf("clean"), indexOf("raw")];
let moved = 0;
for (const [index, word] of clean) if (raw.has(index) && raw.get(index) !== word) moved++;
check("no word moves when the cleanup is switched", moved === 0, `${moved} moved`);
console.log(`          opened both ways in ${seconds}s under Pyodide, in Node`);

console.log("");
if (problems.length) {
  console.log(`${problems.length} check(s) failed:`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("The browser reads the sample into the same sentences as the desktop app.");
