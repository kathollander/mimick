/* Does the reader lay pages out, and draw them, the way it promises?
 *
 *     node tools/check_reader.mjs
 *
 * The parts of reader.html that do not need a screen:
 *
 *   1. js/page-layout.js -- pages in a column the same distances apart as the
 *      desktop's; the page under any height is the right one, gaps included;
 *      only pages actually on screen count as on screen, plus one either side
 *      for drawing ahead; a place in the document survives a zoom; and no
 *      page is ever drawn bigger than MAX_PAGE_PIXELS.
 *   2. reader.py and js/pixels.js, under Pyodide -- the sample opens, and a
 *      page comes back as an image of the right size with print on it.
 *
 * Scrolling, painting and the controls themselves are checked in Chrome; see
 * PORT-LOG.md, step 4b.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = require(path.join(root, "js/page-layout.js"));
const { rgbToRgba } = require(path.join(root, "js/pixels.js"));
const { loadReadingPython } = require(path.join(root, "js/python.js"));

const problems = [];
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  — " + detail : ""}`);
  if (!ok) problems.push(what);
};

// 1. Layout ---------------------------------------------------------------------
const A4 = [595.28, 841.89], LETTER = [612, 792];
const pages = [A4, A4, LETTER, A4, A4, A4];
const g = L.layout(pages, 1.25, 900);

check("pages sit in one column, 16px apart, 12px from the ends",
      g.offsets[0] === 12 && g.offsets.every((y, i) => i === 0 || y === g.offsets[i - 1] + g.sizes[i - 1][1] + 16)
      && g.height === g.offsets[5] + g.sizes[5][1] + 12,
      `tops ${g.offsets.join(", ")}; ${g.height}px in all`);
check("each page is centred, and the column is never narrower than the view",
      g.width === 900 && g.lefts.every((x, i) => x === Math.round((900 - g.sizes[i][0]) / 2)));
check("a page wider than the view widens the column instead",
      L.layout(pages, 3, 900).width === Math.round(612 * 3) + 24);

const everyY = [];
for (let y = 0; y < g.height; y += 7) everyY.push(y);
const wrong = everyY.filter((y) => {
  const p = g.pageAt(y);
  return !(g.offsets[p] - 16 <= y && (p === pages.length - 1 || y < g.offsets[p + 1] - 16));
});
check("the page at any height is the right one, the gap above a page counting as that page",
      wrong.length === 0, wrong.length ? `wrong at ${wrong.slice(0, 5).join(", ")}` : `${everyY.length} heights`);

const view = 700;
let badBand = 0, biggest = 0;
for (let top = 0; top < g.height - view; top += 23) {
  const shown = g.onScreen(top, view), band = g.band(top, view);
  const truly = pages.map((_, p) => p).filter((p) => g.offsets[p] < top + view && g.offsets[p] + g.sizes[p][1] > top);
  const expected = [];
  for (let p = Math.max(0, truly[0] - 1); p <= Math.min(pages.length - 1, truly.at(-1) + 1); p++) expected.push(p);
  if (JSON.stringify(shown) !== JSON.stringify(truly) || JSON.stringify(band) !== JSON.stringify(expected)) badBand++;
  biggest = Math.max(biggest, band.length);
}
check("only pages on screen count as on screen, and one more either side is drawn",
      badBand === 0, `${badBand} positions wrong; at most ${biggest} pages drawn at once`);

let drift = 0;
for (let top = 0; top < g.height - view; top += 97) {
  const where = g.anchor(top);
  const zoomed = L.layout(pages, 2.1, 900);
  const back = L.layout(pages, 1.25, 900).topFor(zoomed.anchor(zoomed.topFor(where)));
  drift = Math.max(drift, Math.abs(back - top));
}
check("a place in the document survives zooming in and back out", drift <= 2, `off by at most ${drift}px`);

const huge = L.layout(pages, L.ZOOM_MAX, 900);
const pixels = pages.map(([w, h], p) => { const s = huge.renderScale(p, 2); return Math.round(w * s) * Math.round(h * s); });
check("no page is drawn with more than MAX_PAGE_PIXELS, even at 400% on a dense screen",
      pixels.every((n) => n <= L.MAX_PAGE_PIXELS * 1.001), `largest ${(Math.max(...pixels) / 1e6).toFixed(1)} million`);
check("and below that, a page is drawn at exactly zoom × screen density",
      g.renderScale(0, 2) === 2.5);
check("zoom stays between 40% and 400%", L.clampZoom(0.1) === 0.4 && L.clampZoom(9) === 4);

// 2. Opening and drawing, under Pyodide ----------------------------------------
const py = await loadReadingPython({
  loadPyodide,
  readText: async (p) => fs.readFileSync(path.join(root, p), "utf8"),
  pyodideDir: path.join(root, "vendor/pyodide") + path.sep,
});
py.runPython("import reader");
const openFrom = py.runPython("lambda js, name: reader.open_document(js.to_bytes(), name)");
const info = openFrom(new Uint8Array(fs.readFileSync(path.join(root, "sample/mdpi-sample.pdf"))), "mdpi-sample.pdf");
const opened = info.toJs({ dict_converter: Object.fromEntries });
check("the sample opens, with its title, twelve pages and their sizes",
      opened.title.startsWith("Land Is Life") && opened.pages.length === 12
      && opened.pages.every(([w, h]) => Math.abs(w - 595.28) < 0.01 && Math.abs(h - 841.89) < 0.01)
      && opened.sentences === 272 && opened.words === 8395,
      `${opened.pages.length} pages, ${opened.sentences} sentences`);

const reader = py.globals.get("reader");
const t0 = performance.now();
const result = reader.render(0, 1.5);
const [width, height, samples] = result.toJs({ depth: 1 });
const buffer = samples.getBuffer("u8");
const rgba = rgbToRgba(buffer.data, width, height);
buffer.release();
const ms = performance.now() - t0;
let ink = 0, opaque = true;
for (let i = 0; i < rgba.length; i += 4) {
  if (rgba[i] < 100 && rgba[i + 1] < 100 && rgba[i + 2] < 100) ink++;
  if (rgba[i + 3] !== 255) opaque = false;
}
check("a page comes back the size asked for, opaque, with print on it",
      width === Math.round(595.28 * 1.5) && height === Math.round(841.89 * 1.5) && opaque && ink > 10000,
      `${width}×${height}, ${ink} dark pixels, ${ms.toFixed(0)} ms`);
let refused = false;
try { reader.render(12, 1); } catch { refused = true; }
check("a page past the end is refused, not drawn blank", refused);

console.log("");
if (problems.length) {
  console.log(`${problems.length} check(s) failed:`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("Pages are laid out and drawn as the reader promises.");
