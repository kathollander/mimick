/* Is each word highlighted when it is actually spoken?
 *
 *     node tools/check_timing.mjs
 *
 * Word timings come from the voice model's own phoneme durations (js/timing.js).
 * This holds them to the audio, not to themselves:
 *
 *   1. The patch exposes durations without changing a single sample, and the
 *      durations add up to the length of the sentence.
 *   2. Words land on the right spoken groups, including the awkward cases:
 *      "1,204" spoken as four groups, "of the" run together as one.
 *   3. After a comma the voice pauses, so the sound's return can be found in
 *      the audio. When it returns, the word highlighted must be the word being
 *      heard: the sound comes back after that word's mark and before the next
 *      one's. Not "exactly on the mark" -- a word opening on /b/ begins with a
 *      silent closure and one on /h/ with breath too quiet to measure, so the
 *      word starts before the loudness does. The offsets are printed, and the
 *      desktop's letter-count estimate is held to the same test.
 *   4. At 4x the marks divide by exactly 4, and the same holds in the
 *      sped-up audio.
 *
 * Needs en_US-lessac-low downloaded by the desktop app, in ~/.cache/mimick/piper/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createPhonemizer, createVoice, stretch } = require(path.join(root, "js/piper-core.js"));
const timing = require(path.join(root, "js/timing.js"));
const createPiperPhonemize = require(path.join(root, "vendor/piper/piper_phonemize.js"));
const ort = require(path.join(root, "vendor/onnxruntime/ort.wasm.min.js"));

const problems = [];
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  — " + detail : ""}`);
  if (!ok) problems.push(what);
};

const modelPath = path.join(process.env.MIMICK_CACHE_DIR || path.join(os.homedir(), ".cache/mimick"),
                            "piper", "en_US-lessac-low.onnx");
if (!fs.existsSync(modelPath)) {
  console.log(`no voice at ${modelPath}; download en_US-lessac-low in the desktop app first`);
  process.exit(1);
}
ort.env.wasm.wasmPaths = path.join(root, "vendor/onnxruntime") + path.sep;
ort.env.wasm.numThreads = 1;
const config = JSON.parse(fs.readFileSync(modelPath + ".json", "utf8"));
const model = new Uint8Array(fs.readFileSync(modelPath));
const phonemize = await createPhonemizer(createPiperPhonemize, (f) => path.join(root, "vendor/piper", f));
const rate = config.audio.sample_rate;

// 1. The patch --------------------------------------------------------------
const plain = await createVoice({ ort, phonemize, config, model });
const voice = await createVoice({ ort, phonemize, config, model, timing });
check("the model's phoneme durations can be exposed", voice.exactTiming);

const probe = "Nothing about the method is new; what is new is taking the correction as the result.";
const a = await plain.speak(probe, { steady: true });
const b = await voice.speak(probe, { steady: true });
const identical = a.samples.length === b.samples.length && a.samples.every((s, i) => s === b.samples[i]);
check("exposing them changes not one sample of the audio", identical,
      `${a.samples.length} vs ${b.samples.length} samples`);
const summed = b.samplesPerId.reduce((x, y) => x + y, 0);
check("the durations add up to the sentence", summed === b.samples.length,
      `${summed} vs ${b.samples.length} samples`);
check("and the timings are exact, not estimated", b.exactTiming);
await plain.release();

// 2. Words onto groups --------------------------------------------------------
async function groupsOf(text) {
  const r = await voice.speak(text, { steady: true });
  const groups = timing.spokenGroups({ ids: r.ids, phonemes: r.phonemes, samplesPerId: r.samplesPerId,
                                       idMap: config.phoneme_id_map });
  const startOf = (ms) => groups.findIndex((g) => Math.abs(g.start / rate * 1000 - ms) < 0.01);
  return { r, groups, startOf };
}
{
  const { r, groups, startOf } = await groupsOf("The survey reached 1,204 households last spring.");
  const at = Object.fromEntries(r.marks.map((m) => [m.word, startOf(m.atMs)]));
  check("\"1,204\" takes the four groups it is spoken as",
        at["1,204"] === 3 && at["households"] === 7 && groups.length === 10,
        `1,204 → group ${at["1,204"]}, households → group ${at["households"]}, ${groups.length} groups`);
}
{
  const { r, groups, startOf } = await groupsOf("She spoke to one of the elders at length.");
  const of = r.marks.find((m) => m.word === "of"), the = r.marks.find((m) => m.word === "the");
  const shared = groups.findIndex((g) => g.start / rate * 1000 <= of.atMs + 0.01 && of.atMs < g.end / rate * 1000);
  const sameGroup = shared >= 0 && the.atMs > of.atMs && the.atMs < groups[shared].end / rate * 1000;
  check("\"of the\", run together, share one group in order", sameGroup && startOf(of.atMs) === shared,
        `of at ${of.atMs.toFixed(0)} ms, the at ${the.atMs.toFixed(0)} ms`);
}
{
  const text = "Self-determination isn't co-operation — it's something else, Dr. Osei said.";
  const r = await voice.speak(text, { steady: true });
  const words = text.split(/\s+/);
  const ordered = r.marks.every((m, i) => i === 0 || m.atMs >= r.marks[i - 1].atMs);
  check("a mark for every word, in order, inside the sentence",
        r.exactTiming && r.marks.length === words.length && ordered &&
        r.marks.every((m) => m.atMs >= 0 && m.atMs <= r.audioMs),
        `${r.marks.length} marks for ${words.length} words`);
}

// 3 and 4. Marks against the sound itself ------------------------------------
const rms = (samples, fromMs, toMs, sr) => {
  const a = Math.max(0, Math.round(fromMs * sr / 1000)), b = Math.min(samples.length, Math.round(toMs * sr / 1000));
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return b > a ? Math.sqrt(sum / (b - a)) : 0;
};
// Where sound returns after the quietest moment near `ms`, in ms.
function soundReturns(samples, ms, sr, scale = 1) {
  let quietest = ms, level = Infinity;
  for (let t = ms - 150 * scale; t < ms + 150 * scale; t += 5 * scale) {
    const v = rms(samples, t, t + 20 * scale, sr);
    if (v < level) { level = v; quietest = t; }
  }
  for (let t = quietest; t < ms + 400 * scale; t += scale) if (rms(samples, t, t + 5 * scale, sr) > 0.02) return t;
  return Infinity;
}
const pauses = [
  "Most of them had never been asked, in any formal way, how the land should be used.",
  "The second round took longer, but the answers changed, and the notes were rewritten.",
  "Listen twice, write down the second answer, then read it back aloud.",
];
let afterComma = 0, exactRight = 0, estimateRight = 0, fastRight = 0, fastDivides = 0;
const offsets = [], guessed = [];
for (const text of pauses) {
  const r = await voice.speak(text, { steady: true });
  const words = text.split(/\s+/);
  const estimate = timing.estimateMarks(words, r.samples.length).map((m) => m.start / rate * 1000);
  const fast = await voice.speak(text, { steady: true, rate: 4 });
  const heard = stretch(r.samples, 4, rate);
  const next = (marks, i) => (i + 1 < marks.length ? marks[i + 1] : Infinity);
  for (let i = 1; i < words.length; i++) {
    if (!/,$/.test(words[i - 1])) continue;
    afterComma++;
    const exact = r.marks.map((m) => m.atMs);
    const returns = soundReturns(r.samples, exact[i], rate);
    const heardHere = (marks) => returns >= marks[i] - 10 && returns < next(marks, i);
    offsets.push(`${words[i]} +${(returns - exact[i]).toFixed(0)}`);
    guessed.push(`${(returns - estimate[i]) >= 0 ? "+" : ""}${(returns - estimate[i]).toFixed(0)}`);
    if (heardHere(exact)) exactRight++;
    if (heardHere(estimate)) estimateRight++;
    const quarter = exact.map((ms) => ms / 4);
    const fastReturns = soundReturns(heard, quarter[i], rate, 0.25);
    if (fastReturns >= quarter[i] - 10 && fastReturns < next(quarter, i)) fastRight++;
  }
  if (fast.marks.every((m, i) => Math.abs(m.heardAtMs - m.atMs / 4) < 1e-9)) fastDivides++;
}
check("after every comma, the word highlighted is the word heard", exactRight === afterComma,
      `${exactRight} of ${afterComma}; the desktop's estimate manages ${estimateRight}`);
console.log(`          sound returns, ms after the mark:     ${offsets.join(", ")}`);
console.log(`          and after the desktop's estimate:     ${guessed.join(", ")}`);
check("at 4× the marks are exactly a quarter", fastDivides === pauses.length);
check("and at 4× too, in the sped-up audio", fastRight === afterComma, `${fastRight} of ${afterComma}`);

await voice.release();
console.log("");
if (problems.length) {
  console.log(`${problems.length} check(s) failed:`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("Words are marked where they are spoken.");
