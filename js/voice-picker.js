/* Choosing voices on purpose: the voice picker, and keeping the default voice.
 *
 * The voice box in the top bar lists only voices kept in this browser, and
 * ends with "Select a new voice…", which opens this window: every voice in
 * js/voices.js, each with its publisher's recording of the rainbow passage
 * (voices/, shipped with the app, so nothing downloads to hear one), a note of
 * which can be used for Convert to MP3, and a box to tick. Ticked voices
 * download together, one after another; a kept voice can be removed, except
 * the default, which comes with the app. Kat asked
 * for it this way (17 September) so that people choose a voice by listening,
 * not by downloading one after another to try them, 60-75 MB each.
 *
 *   MimickVoicePicker.create(ctx)  ctx: { current() -> key, pauseReading(),
 *                                         changed({ added, removed }), status(text) }
 *       .open()
 *   MimickVoicePicker.keepDefault()   keep the default voice, which ships with
 *                                     the app, if it is not kept already, and ask
 *                                     the browser not to clear what is kept
 */
(function (root) {
  "use strict";

  const Voices = root.MimickVoices;
  const $ = (id) => document.getElementById(id);
  const mb = (bytes) => (bytes / 1e6).toFixed(0);
  const el = (tag, props = {}, ...children) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...children);
    return e;
  };

  function create(ctx) {
    const dialog = $("voices-dialog");
    let kept = new Set();
    let downloading = null;         // an AbortController while a download runs
    let sample = null, sampleKey = null;

    function stopSample() {
      if (sample) { sample.pause(); sample = null; }
      sampleKey = null;
      for (const b of dialog.querySelectorAll(".voice-play")) { b.textContent = "▶"; b.title = "Hear this voice"; }
    }

    function play(key, button) {
      if (sampleKey === key) { stopSample(); return; }
      stopSample();
      ctx.pauseReading();
      const audio = sample = new Audio(Voices.sampleUrl(key));
      sampleKey = key;
      button.textContent = "■";
      button.title = "Stop";
      const done = () => { if (sample === audio) stopSample(); };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    }

    function ticked() {
      return [...dialog.querySelectorAll(".voice-tick:checked")].map((box) => box.value);
    }

    function summarise() {
      const keys = ticked(), size = keys.reduce((sum, k) => sum + Voices.byKey[k].mb, 0);
      const go = $("voices-download");
      go.disabled = !keys.length || !!downloading;
      go.textContent = keys.length ? `Download ${keys.length === 1 ? "1 voice" : `${keys.length} voices`} (${size} MB)` : "Download";
    }

    async function showSpace() {
      const used = [...kept].reduce((sum, k) => sum + Voices.byKey[k].mb, 0);
      let text = `Voices kept in this browser: ${kept.size} (${used} MB).`;
      try {
        const { quota, usage } = await navigator.storage.estimate();
        if (quota) text += ` Room left for Mimick: about ${((quota - usage) / 1e9).toFixed(1)} GB.`;
      } catch { /* no estimate */ }
      $("voices-space").textContent = text;
    }

    function draw() {
      const list = $("voices-list");
      list.replaceChildren();
      const current = ctx.current();
      for (const v of Voices.LIST) {
        const have = kept.has(v.key);
        const play_ = el("button", { type: "button", className: "square voice-play", textContent: "▶", title: "Hear this voice" });
        play_.setAttribute("aria-label", `Hear ${v.name}`);
        play_.onclick = () => play(v.key, play_);

        let tick;
        if (have || v.bundled) {
          tick = el("span", { className: "voice-kept", textContent: "✓", title: v.bundled ? "Comes with Mimick" : "Downloaded" });
        } else {
          tick = el("input", { type: "checkbox", className: "voice-tick", value: v.key, disabled: !!downloading });
          tick.setAttribute("aria-label", `Download ${v.name}`);
          tick.onchange = summarise;
        }
        const label = el("label", { className: "voice-name" }, el("b", { textContent: v.name }), ` (${v.accent})`,
          el("span", { className: "dim", textContent: ` — ${v.note}` }));
        if (!have && !v.bundled) label.htmlFor = tick.id = `voice-tick-${v.key}`;

        const mp3 = el("span", { className: v.mp3 ? "voice-mp3" : "voice-mp3 no" ,
          textContent: v.mp3 ? "MP3 ✓" : "Reading only",
          title: v.mp3 ? "No licence questions: can be used for Convert to MP3"
            : "Reads aloud in Mimick. Its licence is not clear enough for making MP3s to keep or share — see About → Voices" });

        let end;
        if (v.bundled) {
          end = el("span", { className: "dim voice-size", textContent: "Built in", title: "Comes with Mimick, so there is always a voice" });
        } else if (have) {
          end = el("button", { type: "button", className: "voice-remove", textContent: "Remove", disabled: !!downloading });
          if (v.key === current) { end.disabled = true; end.title = "This voice is in use: choose another in the voice box first"; }
          else end.title = `Remove ${v.name} from this browser, freeing ${v.mb} MB`;
          end.onclick = () => remove(v.key);
        } else {
          end = el("span", { className: "dim voice-size", textContent: `${v.mb} MB` });
        }
        list.append(el("div", { className: "voice-row" + (have ? " kept" : "") }, tick, play_, label, mp3, end));
      }
      summarise();
      showSpace();
    }

    async function refresh() {
      kept = new Set(await Voices.keptKeys());
      draw();
    }

    async function remove(key) {
      stopSample();
      await Voices.remove(key);
      $("voices-status").textContent = `${Voices.byKey[key].name} removed.`;
      await refresh();
      ctx.changed({ added: [], removed: [key] });
    }

    async function download() {
      const keys = ticked();
      if (!keys.length || downloading) return;
      stopSample();
      const abort = downloading = new AbortController();
      $("voices-progress").hidden = false;
      $("voices-close").textContent = "Stop downloading";
      draw();
      const added = [];
      try {
        for (const [i, key] of keys.entries()) {
          const v = Voices.byKey[key];
          const line = (loaded, total) => {
            $("voices-status").textContent = `Downloading ${v.name}${keys.length > 1 ? ` (${i + 1} of ${keys.length})` : ""}: `
              + `${mb(loaded)} of ${total ? mb(total) : v.mb} MB`;
            $("voices-progress").value = total ? loaded / total : 0;
          };
          line(0, 0);
          await Voices.fetchVoice(key, line, abort.signal);
          added.push(key);
          kept.add(key);
        }
        $("voices-status").textContent = `${added.map((k) => Voices.byKey[k].name).join(", ")} ready, offline too.`;
      } catch (err) {
        $("voices-status").textContent = abort.signal.aborted
          ? `Stopped.${added.length ? ` ${added.map((k) => Voices.byKey[k].name).join(", ")} kept.` : ""}`
          : `Could not download: ${err.message || err}. Check the connection and try again.`;
      } finally {
        downloading = null;
        $("voices-progress").hidden = true;
        $("voices-close").textContent = "Done";
        await refresh();
        if (added.length) ctx.changed({ added, removed: [] });
      }
    }

    $("voices-download").onclick = download;
    $("voices-close").onclick = (e) => {
      e.preventDefault();
      if (downloading) { downloading.abort(); return; }
      dialog.close();
    };
    dialog.addEventListener("cancel", (e) => { if (downloading) e.preventDefault(); });
    dialog.addEventListener("close", stopSample);

    return {
      async open() {
        $("voices-status").textContent = "";
        await refresh();
        if (!dialog.open) dialog.showModal();
      },
    };
  }

  /* The default voice, which ships with the app, copied into the voices' cache
   * on the first visit (and again if the browser ever clears it), so there is
   * always a voice, offline too. Resolves to true when it is kept. */
  let keeping = null;
  function keepDefault() {
    return keeping ??= (async () => {
      try { await navigator.storage?.persist?.(); } catch { /* the browser decides */ }
      if (await Voices.kept(Voices.DEFAULT)) return true;
      try { await Voices.fetchVoice(Voices.DEFAULT); return true; }
      catch (err) { console.warn("Mimick: the default voice could not be kept yet:", err); keeping = null; return false; }
    })();
  }

  root.MimickVoicePicker = { create, keepDefault };
})(window);
