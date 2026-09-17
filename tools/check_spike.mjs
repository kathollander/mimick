/* Does the browser build read a page the same way the desktop app does?
 *
 *     node tools/check_spike.mjs
 *
 * Runs layout.analyse under Pyodide and compares every region -- kind, reason,
 * rectangle and text -- against sample/expected-native.json, which the desktop
 * app produced from the same PDF. Anything but an exact match means the two
 * versions have started reading documents differently, which is the one thing
 * the port must not do quietly. Exits non-zero when they disagree.
 *
 * Regenerate the baseline from the desktop repo after a deliberate change:
 *   .venv/bin/python -c "import sys,json; sys.path[:0]=['../Mimick','../Mimick/py']; \
 *       import spike; r=spike.run(open('../Mimick/sample/sample.pdf','rb').read()); \
 *       r.pop('pymupdf',None); print(json.dumps(r,sort_keys=True))" > ../Mimick/sample/expected-native.json
 */
import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p));

// Pin the same PyMuPDF the desktop app uses. Pyodide bundles 1.26.3, which
// extracts one character more than 1.28.2 in twelve regions of the sample --
// see docs/PORT-LOG.md. Version drift between the two builds is exactly the
// silent difference this tool exists to catch, so the version is not left to
// whatever the runtime happens to ship.
const WHEEL = "pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl";

const py = await loadPyodide({ indexURL: path.join(root, "vendor/pyodide/") });
await py.loadPackage(path.join(root, "vendor/pyodide/" + WHEEL));
for (const name of ["py/layout.py", "py/citations.py", "py/speech.py", "spike.py"])
  py.FS.writeFile("/home/pyodide/" + path.basename(name), read(name).toString("utf8"));
py.globals.set("pdf_bytes", new Uint8Array(read("sample/sample.pdf")));

const got = JSON.parse(await py.runPythonAsync(`
import sys, json
sys.path.insert(0, "/home/pyodide")
import spike
r = spike.run(bytes(pdf_bytes.to_py()))
r.pop("pymupdf", None)
json.dumps(r, sort_keys=True)
`));
const want = JSON.parse(read("sample/expected-native.json").toString("utf8"));

const problems = [];
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  — " + detail : ""}`);
  if (!ok) problems.push(what);
};

check("the document opens at all", got.ok === true);
check("with the same number of pages", got.page_count === want.page_count,
      `${got.page_count} vs ${want.page_count}`);

const flat = (d) => d.pages.flatMap((p) => p.regions.map((r) => ({ page: p.page, ...r })));
const [a, b] = [flat(got), flat(want)];
check("and the same number of regions", a.length === b.length, `${a.length} vs ${b.length}`);

let mismatched = 0, firstBad = "";
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
    mismatched++;
    if (!firstBad) firstBad = `p${b[i].page} region ${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`;
  }
}
check("every region matches the desktop app exactly", mismatched === 0,
      mismatched ? `${mismatched} differ; first: ${firstBad}` : "");

// Region order is the cut's order, and on a two-column page that means the
// left column is finished before the right one starts. See trap 12.
const body = got.pages.flatMap((p) => p.regions.filter((r) => r.reads));
check("something is actually read", body.length > 0, `${body.length} readable regions`);

console.log("");
if (problems.length) {
  console.log(`${problems.length} check(s) failed:`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("The browser reads the sample exactly as the desktop app does.");
