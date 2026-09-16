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

  // Load the phonemizer once and call it once per sentence. Its runtime is
  // built not to exit, so callMain can run again; each call prints one line
  // of JSON, which `print` hands to whichever sentence is waiting for it.
  async function createPhonemizer(createPiperPhonemize, locateFile) {
    let waiting = null;
    const module = await createPiperPhonemize({
      print: (line) => { if (waiting) { const w = waiting; waiting = null; w.resolve(line); } },
      printErr: (line) => { if (waiting) { const w = waiting; waiting = null; w.reject(new Error(line)); } },
      locateFile,
    });
    let queue = Promise.resolve();
    return function phonemize(text, espeakVoice) {
      const run = () => new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        module.callMain(["-l", espeakVoice, "--input", JSON.stringify([{ text }]),
                         "--espeak_data", "/espeak-ng-data"]);
        if (waiting) { waiting = null; reject(new Error("the phonemizer printed nothing")); }
      }).then((line) => JSON.parse(line));
      // One sentence at a time: callMain shares one `print`.
      const result = queue.then(run, run);
      queue = result.catch(() => {});
      return result;
    };
  }

  // A loaded voice. `config` is the model's .onnx.json; `model` its bytes.
  async function createVoice({ ort, phonemize, config, model, speaker = 0 }) {
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    const multiSpeaker = Object.keys(config.speaker_id_map || {}).length > 0;

    return {
      sampleRate: config.audio.sample_rate,

      /* One sentence to samples, with the time each half took.
       * lengthScale below 1 speaks faster -- but Piper shortens phonemes and
       * not the pauses between them (desktop trap 13), so the page plays fast
       * speech by rate instead and this stays at the model's own pace. */
      async speak(text, { lengthScale, rate = 1 } = {}) {
        const t0 = now();
        const phonemes = await phonemize(text, config.espeak.voice);
        const ids = phonemes.phoneme_ids;
        const t1 = now();
        const inf = config.inference;
        const feeds = {
          input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
          input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)])),
          scales: new ort.Tensor("float32", Float32Array.from(
            [inf.noise_scale, lengthScale ?? inf.length_scale, inf.noise_w])),
        };
        if (multiSpeaker) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(speaker)]));
        const { output } = await session.run(feeds);
        const t2 = now();
        const natural = new Float32Array(output.data);
        output.dispose?.();
        const samples = stretch(natural, rate, config.audio.sample_rate);
        const t3 = now();
        return {
          samples,
          ids,
          phonemes: phonemes.phonemes,
          phonemizeMs: t1 - t0,
          inferMs: t2 - t1,
          stretchMs: t3 - t2,
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
