/* Reading aloud: the voice, the playhead, and which word is being said.
 *
 * The browser's player.py. A Piper voice in js/piper-worker.js makes each
 * sentence, a few ahead of the one playing (PREFETCH, as on the desktop); the
 * document worker's `align` puts the voice's words onto the page's; Web Audio
 * plays it, and the audio clock -- what the ear hears, not the page's clock --
 * decides which word is lit. Pausing suspends the audio clock itself, so the
 * voice and the highlight stop together and start together.
 *
 * No DOM. The reader page draws the highlight from onSentence and onWord.
 *
 *   const reader = MimickReadAloud.create({ askDocument, onSentence, onWord, onState, onStatus });
 *   reader.open(sentenceCount)   a new document; stops any reading
 *   reader.play(from?)           from a sentence, or carry on
 *   reader.prepare()             in the click or key press that starts reading
 *   reader.pause() / toggle() / skip(±1) / setRate(r) / stop()
 *
 * States: "stopped", "loading" (the voice), "buffering", "playing", "paused".
 */
(function (root) {
  "use strict";

  const VOICE = "en_US-lessac-low";
  const PREFETCH = 5;
  const CHUNK = 40;            // sentences asked of the document worker at once
  // A voice worker queues everything it is asked; a clip this far behind the
  // playhead, or this far past the prefetch, is not worth keeping.
  const KEEP_BEHIND = 1, KEEP_AHEAD = PREFETCH + 2;

  function create({ askDocument, onSentence, onWord, onState, onStatus }) {
    let count = 0;                 // sentences in the document
    let rate = 1;
    let index = 0;                 // the sentence playing, or about to
    let state = "stopped";
    let session = 0;               // bumped on every stop, seek and document
    const sentences = new Map();   // index -> sentence data, a chunk at a time
    const chunks = new Map();      // first index of a chunk -> its promise
    const clips = new Map();       // index -> { rate, promise, voiceId }

    const setState = (next) => { if (state !== next) { state = next; onState(next); } };

    // --- the voice ---------------------------------------------------------------

    let worker = null, voiceReady = null, context = null, nextId = 0;
    const pending = new Map();

    function loadVoice() {
      if (voiceReady) return voiceReady;
      worker = new Worker("js/piper-worker.js");
      voiceReady = new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") {
            const mb = (n) => (n / 1048576).toFixed(0);
            onStatus(`Downloading the voice, once: ${mb(data.loaded)} of ${mb(data.total)} MB`);
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
      worker.postMessage({ type: "load", voice: VOICE, threads });
      voiceReady.catch(() => { worker.terminate(); worker = null; voiceReady = null; });
      return voiceReady;
    }

    function speak(text) {
      const id = nextId++;
      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "speak", id, text, rate });
      });
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
        chunks.set(start, askDocument({ type: "sentences", start, count: CHUNK }).then(({ sentences: got }) => {
          got.forEach((s, k) => sentences.set(start + k, s));
        }).catch((err) => { chunks.delete(start); throw err; }));
      }
      return chunks.get(start).then(() => sentences.get(i));
    }

    /* A sentence made and aligned: { samples, sampleRate, words, lit } where
     * lit is [[seconds heard, position in words]]. */
    function clip(i) {
      const have = clips.get(i);
      if (have && have.rate === rate) return have.promise;
      if (have) cancel([have]);
      const entry = { rate, voiceId: -1, promise: null };
      entry.promise = sentence(i).then((s) => {
        const spoken = speak(s.text);
        entry.voiceId = spoken.id;
        return spoken.promise.then(async (made) => {
          const marks = (made.marks || []).map((m) => [m.heardAtMs / 1000, m.word]);
          const { aligned } = await askDocument({ type: "align", sentence: i, marks });
          return { samples: made.samples, sampleRate: made.sampleRate, words: s.words, lines: s.lines, lit: aligned };
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

    let source = null, frame = 0, finish = null;
    const nextFrame = (fn) => (document.hidden ? setTimeout(fn, 15) : requestAnimationFrame(fn));
    const cancelFrame = () => { cancelAnimationFrame(frame); clearTimeout(frame); };

    function halt() {
      session++;
      cancelFrame();
      if (source) { source.onended = null; try { source.stop(); } catch { /* not started */ } source = null; }
      finish?.();
      finish = null;
    }

    async function run(mine) {
      while (mine === session && index < count) {
        const i = index;
        // This one first: the voice makes sentences in the order it is asked.
        const current = clip(i);
        prefetch(i);
        const waiting = setTimeout(() => mine === session && setState("buffering"), 60);
        let made;
        try {
          made = await current;
        } catch (err) {
          clearTimeout(waiting);
          if (mine !== session) return;
          clips.delete(i);
          if (err.message === "cancelled") continue;        // asked again, at the new speed
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

        const buffer = context.createBuffer(1, made.samples.length, made.sampleRate);
        buffer.copyToChannel(made.samples, 0);
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const startedAt = context.currentTime + 0.02;
        let shown = -1;
        const follow = () => {
          const heard = context.currentTime - startedAt;
          let k = shown;
          while (k + 1 < made.lit.length && made.lit[k + 1][0] <= heard) k++;
          if (k !== shown) { shown = k; onWord(i, made.lit[k][1]); }
          frame = nextFrame(follow);
        };
        await new Promise((resolve) => {
          finish = resolve;
          source.onended = resolve;
          source.start(startedAt);
          frame = nextFrame(follow);
        });
        cancelFrame();
        if (mine !== session) return;
        source = null;
        clips.delete(i);
        index = i + 1;
      }
      if (mine === session) { setState("stopped"); onSentence(null, null); index = 0; }
    }

    async function play(from = null) {
      if (!count) return;
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
      setState(source ? "playing" : "buffering");
    }

    const api = {
      VOICE,
      get state() { return state; },
      get index() { return index; },
      get rate() { return rate; },
      open(total) {
        stop();
        count = total;
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
      setRate(next) {
        if (next === rate) return;
        rate = next;
        // The sentence playing finishes at the old speed; the ones made for
        // after it are made again.
        const later = [...clips].filter(([i]) => i > index);
        cancel(later.map(([, c]) => c));
        for (const [i] of later) clips.delete(i);
        if (state !== "stopped") prefetch(index);
      },
      stop() { stop(); },
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
