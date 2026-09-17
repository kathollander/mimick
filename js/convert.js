/* Convert to MP3: the desktop's ExportDialog, ExportWorker and progress window.
 *
 * A voice worker of its own (js/piper-worker.js) makes each sentence, and
 * js/mp3-worker.js encodes it as it comes, so reading aloud can carry on while
 * a book converts. Where the browser lets a page save a file as it is made
 * (showSaveFilePicker), the reader chooses where first and the MP3 is written a
 * sentence at a time; a cancelled or failed conversion is thrown away, never
 * left half-written. Elsewhere it is kept in memory and downloaded at the end.
 *
 * What gets spoken comes from the document worker (reader.convert_texts), by
 * the same rules as reading aloud, so the two never drift. The cleanup follows
 * Display, as the reading does: the desktop can override it for one
 * conversion because it can open the PDF twice, which the browser cannot yet.
 */
(function (root) {
  "use strict";

  // The desktop's export.py, measured there.
  const CHARS_PER_SECOND_SPEECH = 15.1;
  const SENTENCE_GAP = 0.18;
  // Seconds of speech made per second, at the start, before this conversion
  // has timed itself. Measured 6.5× in Chrome on 4 threads; held low so the
  // estimate runs long rather than short.
  const REAL_TIME = 4;
  const KBPS = 64;

  function describeDuration(seconds) {
    seconds = Math.max(seconds, 0);
    if (seconds < 45) return "under a minute";
    const minutes = Math.round(seconds / 60);
    if (seconds / 60 < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    return rest ? `about ${hours} h ${rest} min` : `about ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  /* A file name from a title, as the desktop's _safe_filename. */
  const safeName = (name) => (name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
                              || "Mimick audio");

  /* Talk to a worker whose answers carry the id they were asked with. `extra`
   * sees everything else it says. */
  function asker(worker, extra = () => {}) {
    const pending = new Map();
    let nextId = 0, dead = null;
    worker.onmessage = ({ data }) => {
      const waiting = data.id != null ? pending.get(data.id) : null;
      if (!waiting) { extra(data); return; }
      pending.delete(data.id);
      if (data.type === "error") waiting.reject(new Error(data.message));
      else waiting.resolve(data);
    };
    const fail = (err) => { dead = err; for (const { reject } of pending.values()) reject(err); pending.clear(); };
    worker.onerror = (e) => fail(new Error(e.message || "a worker stopped"));
    return {
      ask(message, transfer = []) {
        if (dead) return Promise.reject(dead);
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ ...message, id }, transfer);
        });
      },
      /* Stop the worker; everything waiting on it hears why. */
      kill(why) { worker.terminate(); fail(why); },
    };
  }

  function create(ctx) {
    const $ = (id) => document.getElementById(id);
    const dialog = $("convert-dialog"), panel = $("convert-progress");
    const Voices = root.MimickVoices;
    let job = null;
    let texts = new Map();       // scope key -> promise of the texts it covers

    for (const v of Voices.LIST) $("convert-voice").append(new Option(`${v.name} (${v.accent}) — ${v.note}`, v.key));
    for (const s of ctx.speeds) $("convert-speed").append(new Option(`${s}×`, s));

    const scope = () => {
      const kind = $("convert-scope").value, pages = ctx.pageCount();
      if (kind === "pages") {
        const clamp = (n) => Math.max(1, Math.min(pages, Math.round(Number(n)) || 1));
        return { kind, first: clamp($("convert-from").value) - 1, last: clamp($("convert-to").value) - 1 };
      }
      if (kind === "selection") { const [first, last] = chosen.selection; return { kind, first, last }; }
      return { kind: "all", first: 0, last: 0 };
    };
    const textsFor = (s) => {
      const key = `${s.kind}:${s.first}:${s.last}`;
      if (!texts.has(key)) texts.set(key, ctx.call("convert_texts", s.kind, s.first, s.last));
      return texts.get(key);
    };

    let chosen = { selection: null, generation: -1 };

    function open() {
      if (!ctx.ready()) { ctx.status("Converting is ready once the document is"); return; }
      if (job) { ctx.status("A conversion is already running — its window is in the corner"); return; }
      texts = new Map();
      chosen = { selection: ctx.selection(), generation: ctx.generation(), title: ctx.title() };
      $("convert-heading").textContent = `Convert “${chosen.title}” to an audio file`;
      $("convert-name").value = safeName(chosen.title);
      $("convert-voice").value = ctx.voice();
      $("convert-speed").value = ctx.rate();
      const pages = ctx.pageCount(), scopeBox = $("convert-scope");
      scopeBox.replaceChildren(new Option(`Whole document (${pages} page${pages === 1 ? "" : "s"})`, "all"),
                               new Option("Pages…", "pages"));
      if (chosen.selection) {
        const words = chosen.selection[1] - chosen.selection[0] + 1;
        scopeBox.append(new Option(`Selected text (${words} word${words === 1 ? "" : "s"})`, "selection"));
        scopeBox.value = "selection";
      }
      Object.assign($("convert-from"), { min: 1, max: pages, value: 1 });
      Object.assign($("convert-to"), { min: 1, max: pages, value: pages });
      $("convert-clean").textContent = ctx.cleanText()
        ? "Tidied for reading, as Display → Clean up text for reading is set: no reference list, masthead or declarations."
        : "Read verbatim, as Display → Clean up text for reading is set: the reference list and all.";
      $("convert-where").textContent = root.showSaveFilePicker
        ? "You choose where to save it next, and it is written as it is made."
        : "It downloads when it is finished.";
      refresh();
      dialog.showModal();
      $("convert-go").focus();
    }

    let refreshing = 0;
    async function refresh() {
      $("convert-range").hidden = $("convert-scope").value !== "pages";
      const mine = ++refreshing, s = scope(), speed = Number($("convert-speed").value), key = $("convert-voice").value;
      $("convert-time").textContent = "Working out how long it takes…";
      $("convert-length").textContent = "";
      let got;
      try { got = await textsFor(s); } catch (err) { got = null; $("convert-time").textContent = "Could not read that: " + err.message; }
      if (mine !== refreshing || !got) return;
      $("convert-go").disabled = got.length === 0;
      if (!got.length) { $("convert-time").textContent = "Nothing to convert in this range."; return; }
      const chars = got.reduce((n, t) => n + t.length, 0);
      const speech = chars / CHARS_PER_SECOND_SPEECH;
      const kept = await ctx.voiceKept(key);
      if (mine !== refreshing) return;
      $("convert-time").textContent = `Converting takes ${describeDuration(speech / REAL_TIME)} — ${got.length} sentence${got.length === 1 ? "" : "s"}`
        + (kept ? "." : `, after downloading ${Voices.byKey[key].name} (${Voices.byKey[key].mb} MB) once.`);
      $("convert-length").textContent = `The finished audio runs ${describeDuration(speech / speed + SENTENCE_GAP * got.length)} at ${speed}×.`;
    }
    for (const id of ["convert-scope", "convert-voice", "convert-speed"]) $(id).addEventListener("change", refresh);
    for (const id of ["convert-from", "convert-to"]) $(id).addEventListener("input", refresh);
    $("convert-cancel").onclick = () => dialog.close();

    $("convert-go").onclick = async (e) => {
      e.preventDefault();
      if (job) return;
      const name = safeName($("convert-name").value.replace(/\.mp3$/i, "")) + ".mp3";
      const settings = { scope: scope(), voice: $("convert-voice").value, rate: Number($("convert-speed").value),
                         title: chosen.title, name };
      // Asked straight away: the browser only offers its save window in the click itself.
      let sink = null;
      if (root.showSaveFilePicker) {
        try {
          const handle = await root.showSaveFilePicker({ suggestedName: name,
            types: [{ description: "MP3 audio", accept: { "audio/mpeg": [".mp3"] } }] });
          settings.name = handle.name;
          sink = await handle.createWritable();
        } catch (err) {
          if (err.name === "AbortError") return;      // they closed the save window: stay in the dialog
          sink = null;                                 // anything else: download it instead
        }
      }
      if (chosen.generation !== ctx.generation()) { sink?.abort(); dialog.close(); ctx.status("That document is closed now"); return; }
      let got;
      try {
        got = await textsFor(settings.scope);
      } catch (err) {
        sink?.abort();
        ctx.status("Could not start converting: " + err.message);
        return;
      }
      dialog.close();
      run({ ...settings, texts: got, sink });
    };

    // --- the job -----------------------------------------------------------------

    function show(heading, detail, fraction, finished = false) {
      panel.hidden = false;
      $("convert-progress-heading").textContent = heading;
      $("convert-progress-detail").textContent = detail;
      const bar = $("convert-bar");
      if (fraction === null) bar.removeAttribute("value"); else bar.value = fraction;
      bar.hidden = finished;
      $("convert-stop").textContent = finished ? "Close" : "Cancel";
    }

    $("convert-stop").onclick = () => {
      if (!job) { panel.hidden = true; return; }
      job.cancelled = true;
      show("Stopping…", "Nothing will be saved.", null);
      job.kill(new Error("cancelled"));
    };

    async function run(settings) {
      const { texts: all, sink, rate } = settings;
      const parts = [];
      const voiceWorker = asker(new Worker("js/piper-worker.js"), (data) => {
        if (data.type === "progress" && job === current) {
          const mb = (n) => (n / 1048576).toFixed(0);
          show(`Converting to ${settings.name}`, `Downloading ${Voices.byKey[settings.voice].name}, once: ${mb(data.loaded)} of ${mb(data.total)} MB`, null);
        } else if (data.type === "ready") {
          loaded.resolve(data);
        }
      });
      const encoder = asker(new Worker("js/mp3-worker.js"));
      let loaded;
      const voiceReady = new Promise((resolve, reject) => { loaded = { resolve, reject }; });
      voiceReady.catch(() => {});
      const current = job = {
        cancelled: false,
        kill(why) { loaded.reject(why); voiceWorker.kill(why); encoder.kill(why); },
      };
      const total = all.length, totalChars = all.reduce((n, t) => n + t.length, 0);
      let doneChars = 0, skipped = 0, seconds = 0;
      show(`Converting to ${settings.name}`, "Getting the voice ready…", null);
      window.addEventListener("beforeunload", holdPage);

      const write = async (bytes) => {
        if (!bytes.byteLength) return;
        if (sink) await sink.write(bytes);
        else parts.push(bytes);
      };

      try {
        // Threads need cross-origin isolation, which coi-serviceworker.js gives.
        const threads = Math.min(4, navigator.hardwareConcurrency || 1);
        // It answers a load with "ready", which carries no id, or with an error that does.
        voiceWorker.ask({ type: "load", voice: settings.voice, threads }).catch((err) => loaded.reject(err));
        await voiceReady;
        const t0 = performance.now();
        const speak = (i) => voiceWorker.ask({ type: "speak", text: all[i], rate });
        let started = false, next = total ? speak(0) : null;
        for (let i = 0; i < total; i++) {
          let made = null;
          try {
            made = await next;
          } catch (err) {
            if (current.cancelled) throw err;
            skipped++;               // a sentence the voice could not say is passed over, as when reading
          }
          next = i + 1 < total ? speak(i + 1) : null;
          next?.catch(() => {});
          if (made && made.samples.length) {
            if (!started) {
              await encoder.ask({ type: "start", sampleRate: made.sampleRate, kbps: KBPS });
              started = true;
            }
            seconds += made.samples.length / made.sampleRate + SENTENCE_GAP;
            const { bytes } = await encoder.ask({ type: "add", samples: made.samples, gap: SENTENCE_GAP }, [made.samples.buffer]);
            await write(bytes);
          }
          doneChars += all[i].length;
          const elapsed = (performance.now() - t0) / 1000;
          const left = doneChars > 0 && i >= 4 ? describeDuration(elapsed / doneChars * (totalChars - doneChars)) + " left"
            : "working out how long";
          show(`Converting to ${settings.name}`, `Sentence ${i + 1} of ${total} · ${left}`, doneChars / totalChars);
        }
        if (!started) throw new Error("no audio was made for that — it has nothing the voice can read");
        await write((await encoder.ask({ type: "finish" })).bytes);
        if (sink) {
          await sink.close();
        } else {
          const url = URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
          Object.assign(document.createElement("a"), { href: url, download: settings.name }).click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        const note = skipped ? ` ${skipped} sentence${skipped === 1 ? "" : "s"} could not be read and ${skipped === 1 ? "was" : "were"} left out.` : "";
        show(`Saved ${settings.name}`, `${describeDuration(seconds)} of audio, at ${rate}×.${note}`, 1, true);
        ctx.status(`Saved ${settings.name}`);
      } catch (err) {
        try { await sink?.abort(); } catch { /* already gone */ }
        if (current.cancelled) {
          panel.hidden = true;
          ctx.status("Conversion cancelled — nothing was saved");
        } else {
          show("The conversion did not finish", `Nothing was saved: ${err.message}`, 0, true);
        }
      } finally {
        job = null;
        current.kill(new Error("finished"));
        window.removeEventListener("beforeunload", holdPage);
      }
    }

    function holdPage(e) { e.preventDefault(); e.returnValue = ""; }

    return {
      open,
      get running() { return !!job; },
    };
  }

  root.MimickConvert = { create, describeDuration, safeName };
})(typeof self !== "undefined" ? self : globalThis);
