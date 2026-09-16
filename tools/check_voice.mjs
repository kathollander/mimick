/* Does the browser's Piper say what the desktop app's Piper says?
 *
 *     node tools/check_voice.mjs
 *
 * Two checks, in the order they would go wrong:
 *
 *   1. Phonemes. The browser phonemizes with its own build of espeak-ng. Every
 *      sentence in sample/expected-phonemes.json must come out as exactly the
 *      phoneme ids the desktop app produced, or differ only by KNOWN_DRIFT. A
 *      mismatch is a word pronounced differently, which nobody would spot by
 *      reading.
 *   2. Speed-up. Speech sped up to 4x is a quarter as long and at the same
 *      pitch. A pure tone makes that measurable without anyone listening.
 *   3. Audio. The voice model runs, returns sound rather than silence, and runs
 *      faster than real time. Timings here are Node on this machine; the tab is
 *      what counts, and voice.html measures that.
 *
 * The audio check needs en_US-lessac-low downloaded by the desktop app, into
 * ~/.cache/mimick/piper/. Without it only the phonemes are checked.
 *
 * Regenerate the baseline after a deliberate change: see the top of
 * tools/phoneme_baseline.py.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createPhonemizer, createVoice, stretch } = require(path.join(root, "js/piper-core.js"));
const createPiperPhonemize = require(path.join(root, "vendor/piper/piper_phonemize.js"));
const ort = require(path.join(root, "vendor/onnxruntime/ort.wasm.min.js"));

const problems = [];
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  — " + detail : ""}`);
  if (!ok) problems.push(what);
};

const phonemize = await createPhonemizer(createPiperPhonemize,
  (file) => path.join(root, "vendor/piper", file));

// Differences already found and accepted, as (desktop, browser) phoneme
// spellings. The browser's espeak-ng is an older build than the one inside the
// desktop's piper-tts 1.8, and says "four"/"forty" with a slightly different
// vowel and "ninety" without the glide before the next word. Same words, a
// shade apart in sound. Anything not listed here still fails.
const KNOWN_DRIFT = [
  ["fˈɔːɹ", "fˈoːɹ"],
  ["nˈaɪntiʲ", "nˈaɪnti"],
];
const allowDrift = (s) => KNOWN_DRIFT.reduce((acc, [desktop, web]) => acc.split(desktop).join(web), s);

const baseline = JSON.parse(fs.readFileSync(path.join(root, "sample/expected-phonemes.json"), "utf8"));
for (const { text, phonemes, ids } of baseline.sentences) {
  const result = await phonemize(text, "en-us");
  const got = result.phoneme_ids;
  const spoken = result.phonemes.flat().join("");
  const same = got.length === ids.length && got.every((id, i) => id === ids[i]);
  const knownOnly = !same && allowDrift(phonemes) === spoken;
  let detail = knownOnly ? "apart from the known number drift" : "";
  if (!same && !knownOnly) detail = `\n          desktop  ${phonemes}\n          browser  ${spoken}`;
  check(`pronounced as the desktop does: ${JSON.stringify(text)}`, same || knownOnly, detail);
}

// A long reading. Each sentence phonemizes twice -- itself, then its words for
// timing -- and the phonemizer used to crash on about its 55th call, a few
// passages in, with "memory access out of bounds" (PORT-LOG.md, step 3).
{
  const sentence = baseline.sentences[1].text;
  const words = sentence.split(/\s+/);
  const first = JSON.stringify(await phonemize(sentence, "en-us"));
  let failure = null, drifted = 0, calls = 0;
  try {
    for (let i = 0; i < 400; i++) {
      if (JSON.stringify(await phonemize(sentence, "en-us")) !== first) drifted++;
      await phonemize(words, "en-us");
      calls += 2;
    }
  } catch (err) {
    failure = err.message;
  }
  const made = phonemize.instances;
  check("800 calls in a row, as a long reading makes, and the last is still right",
        !failure && drifted === 0,
        failure ? `failed after ${calls} calls: ${failure}`
                : `${drifted} came out different; ${made ?? "?"} phonemizers made`);
}

// A 220 Hz tone, one second long, at 1.5x to 4x. Pitch is counted from
// upward zero crossings in the middle of the result, away from the fade at
// either end.
{
  const rateHz = 22050;
  const tone = Float32Array.from({ length: rateHz }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rateHz));
  for (const speed of [1.5, 2, 4]) {
    const out = stretch(tone, speed, rateHz);
    const lengthRatio = tone.length / out.length;
    const lo = Math.floor(out.length * 0.2), hi = Math.floor(out.length * 0.8);
    let crossings = 0;
    for (let i = lo + 1; i < hi; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    const hz = crossings / ((hi - lo) / rateHz);
    check(`sped up to ${speed}× at the same pitch`,
          Math.abs(lengthRatio / speed - 1) < 0.05 && Math.abs(hz / 220 - 1) < 0.03,
          `${lengthRatio.toFixed(2)}× shorter, ${hz.toFixed(0)} Hz`);
  }
}

const modelPath = path.join(process.env.MIMICK_CACHE_DIR || path.join(os.homedir(), ".cache/mimick"),
                            "piper", "en_US-lessac-low.onnx");
if (!fs.existsSync(modelPath)) {
  console.log(`\n  skip  the audio check — no voice at ${modelPath}`);
} else {
  ort.env.wasm.wasmPaths = path.join(root, "vendor/onnxruntime") + path.sep;
  ort.env.wasm.numThreads = 1;
  const voice = await createVoice({
    ort, phonemize,
    config: JSON.parse(fs.readFileSync(modelPath + ".json", "utf8")),
    model: new Uint8Array(fs.readFileSync(modelPath)),
  });

  let audio = 0, spent = 0, silent = 0, shortened = 0;
  for (const { text } of baseline.sentences) {
    const r = await voice.speak(text, { rate: 4 });
    if (Math.abs(r.audioMs / r.heardMs / 4 - 1) > 0.01) shortened++;
    audio += r.audioMs;
    spent += r.phonemizeMs + r.inferMs + r.stretchMs;
    let peak = 0;
    for (const s of r.samples) peak = Math.max(peak, Math.abs(s));
    if (peak < 0.05) silent++;
    // Ids alternate with padding, so a sentence runs at a few tens of ms per
    // id; far outside that is a model fed the wrong ids, or scales in the
    // wrong order.
    const perId = r.audioMs / r.ids.length;
    if (perId < 15 || perId > 90) problems.push(`implausible length for ${JSON.stringify(text)}: ${perId.toFixed(0)} ms/id`);
  }
  check("every sentence is sound, not silence", silent === 0, `${silent} silent`);
  check("every sentence at 4× is a quarter as long", shortened === 0, `${shortened} are not`);
  check("every sentence is a plausible length", !problems.some((p) => p.startsWith("implausible")));
  check("faster than real time at 4×, speed-up included, one thread, in Node", audio > spent,
        `${(audio / 1000).toFixed(1)}s of speech in ${(spent / 1000).toFixed(1)}s — ${(audio / spent).toFixed(1)}× real time`);
  await voice.release();
}

console.log("");
if (problems.length) {
  console.log(`${problems.length} check(s) failed:`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("The browser's Piper pronounces the sample as the desktop app does.");
