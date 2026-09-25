/* Piper in a Web Worker, so synthesis never freezes the page.
 *
 * Messages in:
 *   { type: "load", voice, threads }   fetch (or reuse) the voice and start it
 *   { type: "speak", id, text, rate }  one sentence, sped up to `rate` at the same pitch
 *                                     say: [[word, sayAs]], js/pronounce.js
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
              "piper-core.js",
              "voices.js",
              "pronounce.js");

// Pinned to one revision of rhasspy/piper-voices and checked by hash, so the
// file cannot change underneath us or arrive altered. See "Security and
// privacy" in the desktop repo's docs/FUTURE-FEATURES.md. The revision, the
// hashes and the fetching are in js/voices.js.

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
  const files = await MimickVoices.fetchVoice(key, (loaded, total) => self.postMessage({ type: "progress", loaded, total }));

  // Without cross-origin isolation there is no SharedArrayBuffer, and ONNX
  // Runtime quietly runs on one thread whatever it is asked for.
  const isolated = self.crossOriginIsolated === true;
  ort.env.wasm.wasmPaths = new URL("../vendor/onnxruntime/", self.location.href).href;
  ort.env.wasm.numThreads = isolated ? threads : 1;

  const phonemize = await MimickPiper.createPhonemizer(createPiperPhonemize,
    (file) => new URL("../vendor/piper/" + file, self.location.href).href);
  voice = await MimickPiper.createVoice({
    ort, phonemize,
    config: JSON.parse(new TextDecoder().decode(files.json)),
    model: files.model,
    timing: MimickTiming,
  });
  self.postMessage({ type: "ready", voice: key, threads: ort.env.wasm.numThreads, isolated,
                     exactTiming: voice.exactTiming,
                     cached: files.cached, loadMs: performance.now() - t0 });
}

async function speak({ id, text, rate, say = [] }) {
  if (cancelled.delete(id)) throw new Error("cancelled");
  if (!voice) throw new Error("no voice loaded");
  // The reader's own pronunciations, swapped in, and their timings put back under the printed words.
  const swapped = MimickPronounce.apply(text, say);
  const r = await voice.speak(swapped.text, { rate });
  r.marks = MimickPronounce.unswap(r.marks, swapped.back);
  // At 1× the two are one array, which cannot be transferred twice.
  const natural = r.natural === r.samples ? null : r.natural;
  self.postMessage({ type: "spoken", id, samples: r.samples, natural, sampleRate: voice.sampleRate,
                     marks: r.marks, exactTiming: r.exactTiming,
                     phonemizeMs: r.phonemizeMs, inferMs: r.inferMs, timingMs: r.timingMs,
                     stretchMs: r.stretchMs,
                     audioMs: r.audioMs, heardMs: r.heardMs },
                   natural ? [r.samples.buffer, natural.buffer] : [r.samples.buffer]);
}
