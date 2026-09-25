/* Piper, without a server: text -> phonemes -> audio samples.
 *
 * The same code runs in the browser worker (js/piper-worker.js) and under Node
 * (tools/check_voice.mjs), so what the check tool proves is what the page runs.
 * It is a plain script rather than a module because the phonemizer is one, and
 * a classic worker can load both with importScripts.
 *
 * Two engines do the work:
 *   - piper_phonemize, espeak-ng compiled to WebAssembly, turns text into the
 *     phoneme ids a Piper model takes. Its ids match the desktop app's
 *     piper-tts exactly; tools/check_voice.mjs holds it to that.
 *   - ONNX Runtime Web runs the voice model itself.
 */
(function (root) {
  "use strict";

  // The phonemizer's runtime is built not to exit, so callMain can run again --
  // but every call copies its arguments onto the WebAssembly stack and never
  // takes them back. The stack is about 24 KB and cannot grow: each call costs
  // ~190 bytes plus the length of its arguments, and when the stack runs into
  // the heap espeak aborts, and every call after that fails with "memory access
  // out of bounds". A reading of 8 sentences makes 16 calls, so it died on the
  // fourth. So the phonemizer is thrown away and made again, which takes about
  // 55 ms, well before its stack is half used. Measured in PORT-LOG.md.
  const STACK_BUDGET = 12000;           // bytes; the stack holds ~24,500
  const CALL_OVERHEAD = 256;            // bytes a call costs besides its arguments

  // Call it once per sentence. Each call takes a list of texts and prints one
  // line of JSON for each, in order.
  async function createPhonemizer(createPiperPhonemize, locateFile) {
    let lines = null, failure = null;
    const make = () => createPiperPhonemize({
      print: (line) => { if (lines) lines.push(line); },
      printErr: (line) => { failure = line; },
      locateFile,
    });
    let module = await make(), used = 0, instances = 1;
    const encoder = new TextEncoder();
    const cost = (args) => args.reduce((n, arg) => n + encoder.encode(arg).length + 5, CALL_OVERHEAD);

    const call = async (list, espeakVoice) => {
      const args = ["-l", espeakVoice, "--input", JSON.stringify(list.map((text) => ({ text }))),
                    "--espeak_data", "/espeak-ng-data"];
      const bytes = cost(args);
      if (bytes > STACK_BUDGET) {
        // Too much for one call: halve the list, or give up on one huge text
        // rather than let it corrupt the stack.
        if (list.length === 1) throw new Error(`a text of ${list[0].length} characters is too long to phonemize at once`);
        const half = Math.ceil(list.length / 2);
        return [...await call(list.slice(0, half), espeakVoice), ...await call(list.slice(half), espeakVoice)];
      }
      if (used + bytes > STACK_BUDGET) {
        module = await make();
        used = 0;
        instances++;
      }
      used += bytes;
      lines = []; failure = null;
      module.callMain(args);
      const got = lines; lines = null;
      if (got.length !== list.length)
        throw new Error(failure || `the phonemizer printed ${got.length} lines for ${list.length} texts`);
      return got.map((line) => JSON.parse(line));
    };

    let queue = Promise.resolve();
    // phonemize(text, voice) -> one result; phonemize([texts], voice) -> a list.
    const phonemize = function phonemize(texts, espeakVoice) {
      const many = Array.isArray(texts);
      const list = many ? texts : [texts];
      const run = async () => {
        const results = await call(list, espeakVoice);
        return many ? results : results[0];
      };
      // One call at a time: every call shares the one `print`.
      const result = queue.then(run, run);
      queue = result.catch(() => {});
      return result;
    };
    // How many phonemizers have been made so far; tools/check_voice.mjs reads it.
    Object.defineProperty(phonemize, "instances", { get: () => instances });
    return phonemize;
  }

  // A loaded voice. `config` is the model's .onnx.json; `model` its bytes.
  // Word timings come from the model when it can give them (js/timing.js),
  // which needs `timing`; without it, or for a model that cannot, they are
  // the desktop's estimate.
  async function createVoice({ ort, phonemize, config, model, speaker = 0, timing = null }) {
    const patched = timing ? timing.patchForAlignment(model) : { model, name: null };
    const session = await ort.InferenceSession.create(patched.model, { executionProviders: ["wasm"] });
    const alignmentOutput = session.outputNames.includes(patched.name) ? patched.name : null;
    const hop = config.hop_length || (timing ? timing.DEFAULT_HOP_LENGTH : 256);
    const multiSpeaker = Object.keys(config.speaker_id_map || {}).length > 0;

    return {
      sampleRate: config.audio.sample_rate,
      exactTiming: !!alignmentOutput,

      /* One sentence to samples, with the time each half took.
       * lengthScale below 1 speaks faster -- but Piper shortens phonemes and
       * not the pauses between them (desktop trap 13), so the page plays fast
       * speech by rate instead and this stays at the model's own pace. */
      // `steady` turns off the model's randomness, so two runs of a sentence
      // give the same samples; tools/check_timing.mjs relies on it.
      async speak(text, { lengthScale, rate = 1, steady = false } = {}) {
        const t0 = now();
        const phonemes = await phonemize(text, config.espeak.voice);
        const ids = phonemes.phoneme_ids;
        const t1 = now();
        const inf = config.inference;
        const feeds = {
          input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
          input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)])),
          scales: new ort.Tensor("float32", Float32Array.from(
            [steady ? 0 : inf.noise_scale, lengthScale ?? inf.length_scale, steady ? 0 : inf.noise_w])),
        };
        if (multiSpeaker) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(speaker)]));
        const results = await session.run(feeds);
        const t2 = now();
        const natural = new Float32Array(results.output.data);
        let samplesPerId = null;
        if (alignmentOutput) {
          samplesPerId = Array.from(results[alignmentOutput].data, (frames) => Math.round(frames * hop));
        }
        for (const tensor of Object.values(results)) tensor.dispose?.();

        // Word timings, in samples at the model's own pace.
        const words = text.split(/\s+/).filter(Boolean);
        let marks = null;
        if (timing && samplesPerId) {
          const groups = timing.spokenGroups({ ids, phonemes: phonemes.phonemes, samplesPerId,
                                               idMap: config.phoneme_id_map });
          if (groups) {
            const alone = (await phonemize(words, config.espeak.voice)).map((r) => r.phonemes);
            marks = timing.alignWords(words, alone, groups);
          }
        }
        const exact = !!marks;
        if (!marks && timing) marks = timing.estimateMarks(words, natural.length);
        const t3 = now();

        const samples = stretch(natural, rate, config.audio.sample_rate);
        const t4 = now();
        const ms = (n) => (n / config.audio.sample_rate) * 1000;
        return {
          samples,
          // The same sentence at the model's own pace, so the page can speed up
          // what is left of a sentence already playing when the speed changes.
          natural,
          ids,
          samplesPerId,
          phonemes: phonemes.phonemes,
          // Seconds are what the reader needs; the rate divides them exactly,
          // because stretch keeps a sentence's length exactly input / rate.
          marks: marks && marks.map((m) => ({ word: m.word, index: m.index,
                                              atMs: ms(m.start), heardAtMs: ms(m.start) / rate })),
          exactTiming: exact,
          phonemizeMs: t1 - t0,
          inferMs: t2 - t1,
          timingMs: t3 - t2,
          stretchMs: t4 - t3,
          // Length of the sentence at its own pace, and as it will be heard.
          audioMs: (natural.length / config.audio.sample_rate) * 1000,
          heardMs: (samples.length / config.audio.sample_rate) * 1000,
        };
      },

      release: () => session.release(),
    };
  }

  /* Faster speech at the same pitch: the browser's answer to the desktop's
   * ffmpeg atempo (desktop trap 13). Web Audio's playbackRate raises the pitch
   * along with the speed, and <audio>'s pitch-preserving rate cannot be used
   * because Chrome will not start an <audio> element in a tab that has not
   * been in front.
   *
   * WSOLA: take overlapping windows from the input `rate` times further apart
   * than they are laid down in the output, nudging each one within a small
   * range to wherever it lines up best with what is already there, so the
   * waveform joins without a click or a warble. */
  function stretch(samples, rate, sampleRate) {
    if (rate === 1) return samples;
    const size = Math.round(sampleRate * 0.03) & ~1;   // 30 ms windows
    const hop = size / 2;                              // laid down every 15 ms
    const seek = Math.round(sampleRate * 0.01);        // nudged up to 10 ms
    if (samples.length < 2 * size + seek) return samples;  // too short to have a joint
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);

    // Exactly the input's length divided by the rate, so a sentence's timing
    // -- and later the word timings inside it -- scale by the rate and nothing else.
    const target = Math.round(samples.length / rate);
    const frames = Math.ceil(Math.max(0, target - size) / hop) + 1;
    const out = new Float32Array(frames * hop + size);
    const last = samples.length - size;
    let previous = 0;                                  // where the last window was taken from
    for (let f = 0; f < frames; f++) {
      const nominal = Math.min(Math.round(f * hop * rate), last);
      let from = nominal;
      if (f > 0) {
        // The input that naturally follows the last window is what the next
        // one should sound like; find the offset that matches it best.
        const natural = previous + hop;
        let best = -Infinity;
        const lo = Math.max(0, nominal - seek);
        const hi = Math.min(last, nominal + seek);
        for (let at = lo; at <= hi; at += 2) {
          let score = 0;
          for (let i = 0; i < hop; i += 4) score += samples[at + i] * samples[natural + i];
          if (score > best) { best = score; from = at; }
        }
      }
      const to = f * hop;
      for (let i = 0; i < size; i++) out[to + i] += samples[from + i] * window[i];
      previous = from;
    }
    return out.subarray(0, target);
  }

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const api = { createPhonemizer, createVoice, stretch };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickPiper = api;
})(typeof self !== "undefined" ? self : globalThis);
