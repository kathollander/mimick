/* Piper in a Web Worker, so synthesis never freezes the page.
 *
 * Messages in:
 *   { type: "load", voice, threads }   fetch (or reuse) the voice and start it
 *   { type: "speak", id, text, rate }  one sentence, sped up to `rate` at the same pitch
 *   { type: "cancel", ids }            speak requests no longer wanted; each is
 *                                      answered with an error saying "cancelled"
 * Messages out:
 *   { type: "progress", loaded, total }
 *   { type: "ready", voice, threads, isolated, cached, loadMs }
 *   { type: "spoken", id, samples, natural, sampleRate, marks, exactTiming,
 *     phonemizeMs, inferMs, timingMs, stretchMs, audioMs, heardMs }
 *   { type: "error", id?, message }
 *
 * The thread count is fixed once a voice is loaded -- ONNX Runtime reads it
 * when the session is created -- so trying another count means a new worker.
 */
importScripts("../vendor/piper/piper_phonemize.js",
              "../vendor/onnxruntime/ort.wasm.min.js",
              "timing.js",
              "piper-core.js");

// Pinned to one revision of rhasspy/piper-voices and checked by hash, so the
// file cannot change underneath us or arrive altered. See "Security and
// privacy" in the desktop repo's docs/FUTURE-FEATURES.md.
const REVISION = "1162a9173d0ce503555aed757976b7a9912eae4c";
const VOICES = {
  "en_US-lessac-low": {
    path: "en/en_US/lessac/low/en_US-lessac-low",
    onnx: "f7d01dde371555732c4c314111ac79672b1a5ce2fc19266ab42178fd8df7f375",
    json: "45754dfdebb3b8661c3fc564713772deec6e064feeb5b4e9594857dc7305193a",
  },
};
const CACHE = "mimick-voices-v1";

let voice = null;

// One message at a time. The page asks for a whole passage at once, and an
// async handler would otherwise start the next sentence while the last is still
// in the model: two runs of one ONNX Runtime session at once, which on threads
// fails with "null function" or "unaligned accesses" -- and only when the
// timing lines up, so it read fine for a while and then broke (PORT-LOG.md).
// Read as soon as it arrives, not in turn, or it would wait behind the very
// sentences it is cancelling.
const cancelled = new Set();
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === "cancel") { for (const id of data.ids) cancelled.add(id); return; }
  queue = queue.then(async () => {
    try {
      if (data.type === "load") await load(data);
      else if (data.type === "speak") await speak(data);
    } catch (err) {
      self.postMessage({ type: "error", id: data.id, message: String(err && err.message || err) });
    }
  });
};

async function load({ voice: key, threads }) {
  const t0 = performance.now();
  const entry = VOICES[key];
  if (!entry) throw new Error(`no such voice: ${key}`);

  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${REVISION}/${entry.path}`;
  const json = await fetchVerified(base + ".onnx.json", entry.json, false);
  const model = await fetchVerified(base + ".onnx", entry.onnx, true);

  // Without cross-origin isolation there is no SharedArrayBuffer, and ONNX
  // Runtime quietly runs on one thread whatever it is asked for.
  const isolated = self.crossOriginIsolated === true;
  ort.env.wasm.wasmPaths = new URL("../vendor/onnxruntime/", self.location.href).href;
  ort.env.wasm.numThreads = isolated ? threads : 1;

  const phonemize = await MimickPiper.createPhonemizer(createPiperPhonemize,
    (file) => new URL("../vendor/piper/" + file, self.location.href).href);
  voice = await MimickPiper.createVoice({
    ort, phonemize,
    config: JSON.parse(new TextDecoder().decode(json.bytes)),
    model: model.bytes,
    timing: MimickTiming,
  });
  self.postMessage({ type: "ready", voice: key, threads: ort.env.wasm.numThreads, isolated,
                     exactTiming: voice.exactTiming,
                     cached: model.cached, loadMs: performance.now() - t0 });
}

async function speak({ id, text, rate }) {
  if (cancelled.delete(id)) throw new Error("cancelled");
  if (!voice) throw new Error("no voice loaded");
  const r = await voice.speak(text, { rate });
  // At 1× the two are one array, which cannot be transferred twice.
  const natural = r.natural === r.samples ? null : r.natural;
  self.postMessage({ type: "spoken", id, samples: r.samples, natural, sampleRate: voice.sampleRate,
                     marks: r.marks, exactTiming: r.exactTiming,
                     phonemizeMs: r.phonemizeMs, inferMs: r.inferMs, timingMs: r.timingMs,
                     stretchMs: r.stretchMs,
                     audioMs: r.audioMs, heardMs: r.heardMs },
                   natural ? [r.samples.buffer, natural.buffer] : [r.samples.buffer]);
}

// A file from the cache if it is there, else from the network. Either way it
// is hashed before use; a download is only cached once it has passed.
async function fetchVerified(url, sha256, reportProgress) {
  const cache = await caches.open(CACHE);
  let response = await cache.match(url);
  const cached = !!response;
  let bytes;
  if (response) {
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    bytes = await readAll(response, reportProgress);
  }
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (digest !== sha256) {
    await cache.delete(url);
    throw new Error(`${url.split("/").pop()} did not match its expected hash`);
  }
  if (!cached) await cache.put(url, new Response(bytes));
  return { bytes, cached };
}

async function readAll(response, reportProgress) {
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    if (reportProgress) self.postMessage({ type: "progress", loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return bytes;
}
