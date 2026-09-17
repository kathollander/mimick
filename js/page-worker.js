/* A page worker: Pyodide and MuPDF, drawing pages (pages.py). The reader runs
 * two or three of these beside the document worker, so pages show while the
 * sentences are still being built, and so a scanned book -- whose pages can
 * take most of a second each -- is drawn several pages at a time.
 *
 * Messages in:
 *   { type: "open", id, bytes, name }        bytes: ArrayBuffer, transferred
 *   { type: "render", id, page, scale, keep }
 *       scale: device pixels per PDF point. keep: also give the page back as a
 *       compressed image, to be kept (js/page-store.js).
 * Messages out:
 *   { type: "ready", loadMs }
 *   { type: "opened", id, title, pages: [[w, h] in points], outline: [[level, title, page, y, open]] }
 *   { type: "rendered", id, page, scale, bitmap, blob?, renderMs }   bitmap transferred
 *   { type: "error", id?, message }
 *
 * One message at a time, in order, as in the document worker. Every message
 * with an id gets exactly one answer -- the page waits on each -- so nothing in
 * here may fail without saying so.
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
  py.runPython("import pages");
  self.postMessage({ type: "ready", loadMs: performance.now() - started });
  return py;
});
python.catch((err) => self.postMessage({ type: "error", message: "Python did not start: " + err.message }));

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const py = await python;
      if (data.type === "open") open(py, data);
      else if (data.type === "render") await render(py, data);
    } catch (err) {
      self.postMessage({ type: "error", id: data.id, message: String(err && err.message || err) });
    }
  });
};

function open(py, { id, bytes, name }) {
  const openFrom = py.runPython("lambda js, name: pages.open_pages(js.to_bytes(), name)");
  try {
    const info = openFrom(new Uint8Array(bytes), name);
    const out = info.toJs({ dict_converter: Object.fromEntries });
    info.destroy();
    self.postMessage({ type: "opened", id, ...out });
  } finally {
    openFrom.destroy();
  }
}

async function render(py, { id, page, scale, keep }) {
  const t0 = performance.now();
  const pages = py.globals.get("pages");
  let width, height, rgba;
  try {
    const result = pages.render(page, scale);
    const [w, h, samples] = result.toJs({ depth: 1 });
    const buffer = samples.getBuffer("u8");
    try {
      rgba = MimickPixels.rgbToRgba(buffer.data, w, h);
    } finally {
      buffer.release();
      samples.destroy();
      result.destroy();
    }
    [width, height] = [w, h];
  } finally {
    pages.destroy();
  }
  const image = new ImageData(rgba, width, height);
  let blob;
  if (keep) {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").putImageData(image, 0, 0);
    // WebP where the browser can write it; a browser that cannot hands back
    // PNG instead, several times the size, so JPEG then.
    blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  }
  const bitmap = await createImageBitmap(image);
  self.postMessage({ type: "rendered", id, page, scale, bitmap, blob, renderMs: performance.now() - t0 }, [bitmap]);
}
