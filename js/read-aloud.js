/* Reading aloud: the voice, the playhead, and which word is being said.
 *
 * The browser's player.py. A Piper voice in js/piper-worker.js makes each
 * sentence, a few ahead of the one playing (PREFETCH, as on the desktop); the
 * document worker's `align` puts the voice's words onto the page's; Web Audio
 * plays it, and the audio clock -- what the ear hears, not the page's clock --
 * decides which word is lit. Pausing suspends the audio clock itself, so the
 * voice and the highlight stop together and start together.
 *
 * A clip is kept at the model's own pace as well as sped up, so a change of
 * speed reaches the sentence already playing -- from the word it has got to --
 * and every clip made ahead, without asking the voice for any of them again.
 *
 * No DOM. The reader page draws the highlight from onSentence and onWord.
 *
 *   const reader = MimickReadAloud.create({ askDocument, onSentence, onWord, onState, onStatus,
 *                                           beforeLoad? });
 *       beforeLoad(key): a promise to wait on before the voice worker loads that
 *       voice -- the page's own download of it, so the worker does not fetch a
 *       second copy. Whatever it settles to, the worker then loads the voice.
 *   reader.open(count, source?)  a new set of sentences -- "document", or
 *                                "selection" -- and stops any reading
 *   reader.play(from?)           from a sentence, or carry on
 *   reader.prepare()             in the click or key press that starts reading
 *   reader.pause() / toggle() / skip(±1) / setRate(r) / stop()
 *   reader.back(seconds)         back through the audio, into earlier sentences if need be
 *   reader.setVoice(key)         another voice from js/voices.js; a reading carries on
 *                                in it from the sentence it was on
 *   reader.remake()              the pronunciation list changed: make the sentences ahead again
 *
 * States: "stopped", "loading" (the voice), "buffering", "playing", "paused".
 */
(function (root) {
  "use strict";

  const DEFAULT_VOICE = "en_US-norman-medium"; // must match MimickVoices.DEFAULT
  const PREFETCH = 5;
  const CHUNK = 40;            // sentences asked of the document worker at once
  // A voice worker queues everything it is asked; a clip this far behind the
  // playhead, or this far past the prefetch, is not worth keeping. Two behind
  // are kept so going back a sentence, or 10 seconds, plays at once.
  const KEEP_BEHIND = 2, KEEP_AHEAD = PREFETCH + 2;

  function create({ askDocument, onSentence, onWord, onState, onStatus, voice: firstVoice = DEFAULT_VOICE, voiceName = (k) => k,
                    pronunciations = () => [], beforeLoad = () => null }) {
    let voiceKey = firstVoice;
    let count = 0;                 // sentences in the document
    let rate = 1;
    let index = 0;                 // the sentence playing, or about to
    let state = "stopped";
    let session = 0;               // bumped on every stop, seek and document
    let startAt = 0;               // seconds into the first sentence a play starts from
    let source = "document";       // which sentences the document worker hands out
    const sentences = new Map();   // index -> sentence data, a chunk at a time
    const chunks = new Map();      // first index of a chunk -> its promise
    const clips = new Map();       // index -> { promise, voiceId }

    const setState = (next) => { if (state !== next) { state = next; onState(next); } };

    // --- the voice ---------------------------------------------------------------

    let worker = null, voiceReady = null, failLoad = null, context = null, nextId = 0;
    const pending = new Map();

    function loadVoice() {
      if (voiceReady) return voiceReady;
      worker = new Worker("js/piper-worker.js");
      voiceReady = new Promise((resolve, reject) => {
        failLoad = reject;
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") {
            const mb = (n) => (n / 1048576).toFixed(0);
            onStatus(`Downloading ${voiceName(voiceKey)}, once: ${mb(data.loaded)} of ${mb(data.total)} MB`);
          } else if (data.type === "ready") {
            resolve();
          } else if (data.type === "spoken" || data.type === "error") {
            const waiting = pending.get(data.id);
            if (waiting) {
              pending.delete(data.id);
              if (data.type === "error") waiting.reject(new Error(data.message));
              else waiting.resolve(data);
            } else if (data.type === "error") {
              reject(new Error(data.message));
            }
          }
        };
        worker.onerror = (e) => reject(new Error(e.message || "the voice did not start"));
      });
      // Threads need cross-origin isolation, which coi-serviceworker.js gives.
      const threads = Math.min(4, navigator.hardwareConcurrency || 1);
      const mine = worker, key = voiceKey;
      Promise.resolve(beforeLoad(key)).catch(() => {})
        .then(() => { if (worker === mine) worker.postMessage({ type: "load", voice: key, threads }); });
      voiceReady.catch(() => { if (worker === mine) { worker.terminate(); worker = null; voiceReady = null; } });
      return voiceReady;
    }

    /* Put the voice away: its worker, what it was making, and what it made. */
    function dropVoice() {
      worker?.terminate();
      failLoad?.(new Error("cancelled"));
      worker = null;
      voiceReady = null;
      failLoad = null;
      for (const { reject } of pending.values()) reject(new Error("cancelled"));
      pending.clear();
      clips.clear();
    }

    function speak(text) {
      const id = nextId++;
      const asked = rate;
      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "speak", id, text, rate: asked, say: pronunciations() });
      }).then((made) => ({ ...made, rate: asked }));
      return { id, promise };
    }

    function cancel(entries) {
      const ids = entries.map((c) => c.voiceId).filter((id) => pending.has(id));
      if (ids.length) worker?.postMessage({ type: "cancel", ids });
    }

    // --- sentences and clips -------------------------------------------------------

    function sentence(i) {
      if (sentences.has(i)) return Promise.resolve(sentences.get(i));
      const start = i - (i % CHUNK);
      if (!chunks.has(start)) {
        chunks.set(start, askDocument({ type: "sentences", source, start, count: CHUNK }).then(({ sentences: got }) => {
          got.forEach((s, k) => sentences.set(start + k, s));
        }).catch((err) => { chunks.delete(start); throw err; }));
      }
      return chunks.get(start).then(() => sentences.get(i));
    }

    /* A sentence made and aligned: { samples, rate, natural, sampleRate, words,
     * lines, lit }. `samples` is sped up to `rate`; `natural` is the model's own
     * pace, and lit is [[seconds into natural, position in words]]. */
    function clip(i) {
      const have = clips.get(i);
      if (have) return have.promise;
      const entry = { voiceId: -1, promise: null };
      const from = source;
      entry.promise = sentence(i).then((s) => {
        const spoken = speak(s.text);
        entry.voiceId = spoken.id;
        return spoken.promise.then(async (made) => {
          const marks = (made.marks || []).map((m) => [m.atMs / 1000, m.word]);
          const { aligned } = await askDocument({ type: "align", source: from, sentence: i, marks });
          return { samples: made.samples, rate: made.rate, natural: made.natural ?? made.samples,
                   sampleRate: made.sampleRate, words: s.words, lines: s.lines, lit: aligned };
        });
      });
      entry.promise.catch(() => {});     // a cancelled clip is nobody's error
      clips.set(i, entry);
      return entry.promise;
    }

    function prefetch(from) {
      for (let i = from + 1; i <= Math.min(count - 1, from + PREFETCH); i++) clip(i);
      const stale = [...clips].filter(([i]) => i < from - KEEP_BEHIND || i > from + KEEP_AHEAD);
      cancel(stale.map(([, c]) => c));
      for (const [i] of stale) clips.delete(i);
    }

    // --- playing -------------------------------------------------------------------

    // `node` plays the sentence `playing`; `playing.from` is how far into its
    // natural-pace audio the node started, and `playing.rate` how fast it goes.
    let node = null, playing = null, frame = 0, finish = null;
    const nextFrame = (fn) => (document.hidden ? setTimeout(fn, 15) : requestAnimationFrame(fn));
    const cancelFrame = () => { cancelAnimationFrame(frame); clearTimeout(frame); };

    function silence() {
      if (!node) return;
      node.onended = null;
      try { node.stop(); } catch { /* not started */ }
      node = null;
    }

    function halt() {
      session++;
      cancelFrame();
      silence();
      playing = null;
      finish?.();
      finish = null;
    }

    /* Seconds into the playing sentence's natural-pace audio, as heard. */
    const heardNow = () =>
      playing.from + Math.max(0, context.currentTime - playing.startedAt) * playing.rate;

    /* Play the sentence in `playing` from `from` seconds into it, at the
     * current speed: its own sped-up samples when they are what is wanted, and
     * otherwise what is left of the natural audio, sped up here. */
    function sound(from) {
      const made = playing.made;
      let samples = made.samples;
      if (from > 0 || made.rate !== rate) {
        const tail = made.natural.subarray(Math.min(made.natural.length, Math.round(from * made.sampleRate)));
        samples = rate === 1 ? tail : root.MimickPiper.stretch(tail, rate, made.sampleRate);
      }
      silence();
      if (!samples.length) { finish?.(); return; }
      const buffer = context.createBuffer(1, samples.length, made.sampleRate);
      buffer.copyToChannel(samples, 0);
      node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      Object.assign(playing, { from, rate, startedAt: context.currentTime + 0.02 });
      node.onended = () => finish?.();
      node.start(playing.startedAt);
    }

    async function run(mine) {
      while (mine === session && index < count) {
        const i = index;
        // This one first: the voice makes sentences in the order it is asked.
        const current = clip(i);
        prefetch(i);
        // Paused stays paused: a pause in these 60 ms used to be undone by this.
        const waiting = setTimeout(() => mine === session && state !== "paused" && setState("buffering"), 60);
        let made;
        try {
          made = await current;
        } catch (err) {
          if (mine !== session) return;
          clips.delete(i);
          onStatus(`Sentence ${i + 1} could not be read: ${err.message}`);
          index = i + 1;
          continue;
        } finally {
          clearTimeout(waiting);
        }
        if (mine !== session) return;
        onSentence(i, made);
        if (context.state === "suspended" && state !== "paused") await context.resume();
        if (state !== "paused") setState("playing");

        playing = { i, made };
        let shown = -1;
        const offset = startAt;
        startAt = 0;
        const follow = () => {
          const heard = heardNow();
          // Gone back within the sentence: find the word again from its start.
          let k = shown >= 0 && made.lit[shown][0] > heard ? -1 : shown;
          while (k + 1 < made.lit.length && made.lit[k + 1][0] <= heard) k++;
          if (k !== shown) { shown = k; onWord(i, made.lit[k][1]); }
          frame = nextFrame(follow);
        };
        await new Promise((resolve) => {
          finish = resolve;
          sound(Math.min(offset, made.natural.length / made.sampleRate));
          frame = nextFrame(follow);
        });
        cancelFrame();
        if (mine !== session) return;
        node = null;
        playing = null;
        finish = null;
        index = i + 1;
      }
      if (mine === session) { setState("stopped"); onSentence(null, null); index = 0; }
    }

    async function play(from = null, at = 0) {
      if (!count) return;
      startAt = at;
      // Made inside the click or key press, which is what lets it make sound.
      context ??= new AudioContext();
      if (from === null && state === "paused") { resume(); return; }
      halt();
      if (from !== null) index = Math.max(0, Math.min(count - 1, from));
      const mine = session;
      if (!voiceReady || state === "stopped") setState("loading");
      try {
        await loadVoice();
      } catch (err) {
        if (mine === session) { setState("stopped"); onStatus(`The voice could not be loaded: ${err.message}`); }
        return;
      }
      if (mine !== session) return;
      await context.resume();
      setState("buffering");
      run(mine);
    }

    function pause() {
      if (state !== "playing" && state !== "buffering") return;
      context?.suspend();
      setState("paused");
    }

    function resume() {
      if (state !== "paused") return;
      context.resume();
      setState(node ? "playing" : "buffering");
    }

    const api = {
      get voice() { return voiceKey; },
      /* Another voice. Reading carries on in it from the start of the sentence
       * it was on; paused, it stops there, and Read aloud carries on. */
      setVoice(next) {
        if (next === voiceKey) return;
        voiceKey = next;
        const was = state, at = index;
        halt();
        dropVoice();
        if (was === "stopped") return;
        if (was === "paused") { stop(); index = at; return; }
        play(at);
      },
      get state() { return state; },
      get index() { return index; },
      get rate() { return rate; },
      get source() { return source; },
      get count() { return count; },
      open(total, from = "document") {
        stop();
        count = total;
        source = from;
        sentences.clear();
        chunks.clear();
        cancel([...clips.values()]);
        clips.clear();
        index = 0;
      },
      play,
      pause,
      /* Make the audio context now, inside a click or key press: one made
       * later, after waiting on a worker, may not be allowed to make sound. */
      prepare() { context ??= new AudioContext(); },
      toggle() {
        if (state === "playing" || state === "buffering") pause();
        else play();
      },
      skip(step) {
        if (state === "stopped" || !count) return;
        const wasPaused = state === "paused";
        play(index + step).then(() => { if (wasPaused) pause(); });
      },
      /* Back `seconds` of the voice's own pace, as a podcast player's skip
       * back: within the sentence playing when it has been going that long,
       * otherwise into the sentences before it, made again to know how long
       * they are. Paused stays paused. */
      async back(seconds) {
        if (state === "stopped" || !count) return;
        const wasPaused = state === "paused";
        const heard = playing && playing.i === index ? heardNow() : 0;
        if (playing && node && heard >= seconds) { sound(heard - seconds); return; }
        const mine = session;
        let i = index, left = seconds - heard, at = 0;
        while (i > 0) {
          i--;
          let made;
          try { made = await clip(i); } catch { if (mine !== session) return; continue; }
          if (mine !== session) return;
          const length = made.natural.length / made.sampleRate;
          if (length >= left) { at = length - left; break; }
          left -= length;
        }
        await play(i, at);
        if (wasPaused) pause();
      },
      /* A new speed, heard at once: the sentence playing carries on from the
       * word it has reached, and clips made ahead are sped up when they play. */
      setRate(next) {
        if (next === rate) return;
        rate = next;
        if (playing && node) sound(heardNow());
      },
      stop() { stop(); },
      /* The pronunciations changed: sentences made ahead are made again. */
      remake() {
        const keep = playing ? playing.i : -1;
        const stale = [...clips].filter(([i]) => i !== keep);
        cancel(stale.map(([, c]) => c));
        for (const [i] of stale) clips.delete(i);
        if (state === "playing" || state === "buffering") prefetch(index);
      },
    };

    function stop() {
      halt();
      if (context?.state === "suspended") context.resume();
      if (state !== "stopped") { setState("stopped"); onSentence(null, null); }
    }
    return api;
  }

  const api = { create };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickReadAloud = api;
})(typeof self !== "undefined" ? self : globalThis);
