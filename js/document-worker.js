/* The document worker: Pyodide, MuPDF and the desktop's document.py, off the
 * page's own thread so opening a document never freezes it (FUTURE-FEATURES.md,
 * roadblock 3). Pages are drawn by js/page-worker.js, so they can show while
 * this is still opening.
 *
 * Messages in:
 *   { type: "open", id, bytes, name }     bytes: ArrayBuffer, transferred
 *   { type: "sentences", id }
 *   { type: "align", id, sentence, marks }  marks: [[seconds, word]] from the voice
 *   { type: "sentenceAt", id, page, x, y }  x, y in PDF points
 * Messages out:
 *   { type: "ready", loadMs }
 *   { type: "opened", id, title, pages: [[w, h] in points], sentences, words, openMs }
 *   { type: "sentences", id, sentences }
 *       each { page, text, words: [[index, page, [x0, y0, x1, y1]]],
 *              lines: [[page, [x0, y0, x1, y1]]] }   see reader.sentences
 *   { type: "aligned", id, sentence, aligned: [[seconds, position in words]] }
 *   { type: "sentenceAt", id, sentence }    sentence: an index, or null
 *   { type: "error", id?, message }
 *
 * Python starts loading the moment the worker does. Messages are handled one at
 * a time, in order -- the voice worker taught that (HANDOFF.md, trap 7) -- so a
 * question asked while a document opens simply waits for it.
 */
importScripts("../vendor/pyodide/pyodide.js", "python.js");

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
      else if (data.type === "sentences") sentences(py, data);
      else if (data.type === "align") align(py, data);
      else if (data.type === "sentenceAt") sentenceAt(py, data);
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

/* Calls a function in reader.py and gives back its result as plain data,
 * freeing every Python object it made on the way. */
function callReader(py, name, ...args) {
  const reader = py.globals.get("reader");
  const fn = reader[name];
  let pyArgs = [], result;
  try {
    pyArgs = args.map((a) => (a !== null && typeof a === "object" ? py.toPy(a) : a));
    result = fn(...pyArgs);
    return result && typeof result.toJs === "function"
      ? result.toJs({ dict_converter: Object.fromEntries }) : result;
  } finally {
    if (result && typeof result.destroy === "function") result.destroy();
    for (const a of pyArgs) if (a && typeof a.destroy === "function") a.destroy();
    fn.destroy();
    reader.destroy();
  }
}

function sentences(py, { id }) {
  self.postMessage({ type: "sentences", id, sentences: callReader(py, "sentences") });
}

// The alignment stays in Python -- one copy, the desktop's align_marks.
function align(py, { id, sentence, marks }) {
  self.postMessage({ type: "aligned", id, sentence, aligned: callReader(py, "align", sentence, marks) });
}

function sentenceAt(py, { id, page, x, y }) {
  const sentence = callReader(py, "sentence_at", page, x, y);
  self.postMessage({ type: "sentenceAt", id, sentence: sentence ?? null });
}
