/* The document worker: Pyodide, MuPDF and the desktop's document.py, off the
 * page's own thread so opening a document never freezes it (FUTURE-FEATURES.md,
 * roadblock 3). Pages are drawn by js/page-worker.js, so they can show while
 * this is still opening.
 *
 * Messages in:
 *   { type: "open", id, bytes, name, options? }   bytes: ArrayBuffer, transferred;
 *       options: { skip_citations, clean_text, read_footnotes }, each true unless said
 *   { type: "sentences", id, start?, count?, source? }   source: "document" or "selection"
 *   { type: "align", id, sentence, marks, source? }  marks: [[seconds, word]] from the voice
 *   { type: "sentenceAt", id, page, x, y }  x, y in PDF points
 *   { type: "firstSentenceOn", id, page }
 *   { type: "call", id, name, args }       one of CALLS in reader.py -- selecting
 *                                          and the text cursor
 * Messages out:
 *   { type: "ready", loadMs }
 *   { type: "opened", id, title, pages: [[w, h] in points], sentences, words, openMs }
 *   { type: "sentences", id, sentences }
 *       each { page, text, words: [[index, page, [x0, y0, x1, y1]]],
 *              lines: [[page, [x0, y0, x1, y1]]] }   see reader.sentences
 *   { type: "aligned", id, sentence, aligned: [[seconds, position in words]] }
 *   { type: "sentenceAt", id, sentence }    sentence: an index, or null
 *   { type: "firstSentenceOn", id, sentence }   the same
 *   { type: "called", id, result }
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
      else if (data.type === "firstSentenceOn") firstSentenceOn(py, data);
      else if (data.type === "call") call(py, data);
    } catch (err) {
      self.postMessage({ type: "error", id: data.id, message: String(err && err.message || err) });
    }
  });
};

async function open(py, { id, bytes, name, options = {} }) {
  const t0 = performance.now();
  // A typed array reaches Python as a JsProxy; to_bytes() copies it once, so
  // reader.py only ever sees plain bytes, as it would on the desktop.
  const openFrom = py.runPython(
    "lambda js, name, o: reader.open_document(js.to_bytes(), name, o.skip_citations, o.clean_text, o.read_footnotes)");
  const settings = { skip_citations: true, clean_text: true, read_footnotes: true, ...options };
  try {
    const info = openFrom(new Uint8Array(bytes), name, settings);
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

function sentences(py, { id, start = 0, count = null, source = "document" }) {
  self.postMessage({ type: "sentences", id, sentences: callReader(py, "sentences", start, count, source) });
}

// The alignment stays in Python -- one copy, the desktop's align_marks.
function align(py, { id, sentence, marks, source = "document" }) {
  self.postMessage({ type: "aligned", id, sentence, aligned: callReader(py, "align", sentence, marks, source) });
}

const CALLS = new Set(["select_range", "selection_text", "selection_boxes", "word_at", "sentence_span",
                       "page_span", "caret_step", "caret_place",
                       "annotations", "annotation_add", "annotation_set", "annotation_remove",
                       "snapshot", "restore", "notes_pdf", "set_author", "set_reading",
                       "regions", "region_counts", "set_region_choices", "toggle_region", "reset_regions",
                       "convert_texts", "forget_alternate", "sentence_lengths", "find", "found_on"]);

function call(py, { id, name, args = [] }) {
  if (!CALLS.has(name)) throw new Error(`reader.py has no ${name} for the page`);
  const result = callReader(py, name, ...args);
  self.postMessage({ type: "called", id, result: result ?? null });
}

function sentenceAt(py, { id, page, x, y }) {
  const sentence = callReader(py, "sentence_at", page, x, y);
  self.postMessage({ type: "sentenceAt", id, sentence: sentence ?? null });
}

function firstSentenceOn(py, { id, page }) {
  const sentence = callReader(py, "first_sentence_on", page);
  self.postMessage({ type: "firstSentenceOn", id, sentence: sentence ?? null });
}
