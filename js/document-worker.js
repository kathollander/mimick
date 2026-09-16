/* The document worker: Pyodide, MuPDF and the desktop's document.py, off the
 * page's own thread so opening a document or drawing a page never freezes it
 * (FUTURE-FEATURES.md, roadblock 3).
 *
 * Messages in:
 *   { type: "open", id, bytes, name }     bytes: ArrayBuffer, transferred
 *   { type: "render", id, page, scale }   scale: device pixels per PDF point
 * Messages out:
 *   { type: "ready", loadMs }
 *   { type: "opened", id, title, pages: [[w, h] in points], sentences, words, openMs }
 *   { type: "rendered", id, page, scale, bitmap, renderMs }   bitmap transferred
 *   { type: "error", id?, message }
 *
 * Python starts loading the moment the worker does. Messages are handled one at
 * a time, in order -- the voice worker taught that (HANDOFF.md, trap 7) -- so a
 * render asked for while a document opens simply waits for it.
 */
importScripts("../vendor/pyodide/pyodide.js", "python.js", "pixels.js");

const base = new URL("../", self.location.href).href;
const started = performance.now();
const python = MimickPython.loadReadingPython({
  loadPyodide,
  readText: async (p) => {
    const response = await fetch(base + p);
    if (!response.ok) throw new Error(`${p} answered ${response.status}`);
    return response.text();
  },
  pyodideDir: base + "vendor/pyodide/",
}).then((py) => {
  py.runPython("import reader");
  self.postMessage({ type: "ready", loadMs: performance.now() - started });
  return py;
});
python.catch((err) => self.postMessage({ type: "error", message: "Python did not start: " + err.message }));

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const py = await python;
      if (data.type === "open") await open(py, data);
      else if (data.type === "render") render(py, data);
    } catch (err) {
      self.postMessage({ type: "error", id: data.id, message: String(err && err.message || err) });
    }
  });
};

async function open(py, { id, bytes, name }) {
  const t0 = performance.now();
  // A typed array reaches Python as a JsProxy; to_bytes() copies it once, so
  // reader.py only ever sees plain bytes, as it would on the desktop.
  const openFrom = py.runPython("lambda js, name: reader.open_document(js.to_bytes(), name)");
  try {
    const info = openFrom(new Uint8Array(bytes), name);
    const out = info.toJs({ dict_converter: Object.fromEntries });
    info.destroy();
    self.postMessage({ type: "opened", id, ...out, openMs: performance.now() - t0 });
  } finally {
    openFrom.destroy();
  }
}

function render(py, { id, page, scale }) {
  const t0 = performance.now();
  const reader = py.globals.get("reader");
  const result = reader.render(page, scale);
  const [width, height, samples] = result.toJs({ depth: 1 });
  const buffer = samples.getBuffer("u8");
  let rgba;
  try {
    rgba = MimickPixels.rgbToRgba(buffer.data, width, height);
  } finally {
    buffer.release();
    samples.destroy();
    result.destroy();
    reader.destroy();
  }
  createImageBitmap(new ImageData(rgba, width, height)).then((bitmap) => {
    self.postMessage({ type: "rendered", id, page, scale, bitmap, renderMs: performance.now() - t0 },
                     [bitmap]);
  });
}
