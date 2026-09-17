/* The reader page: open a PDF, show its pages, scroll and zoom.
 *
 * Pages are drawn by two or three page workers (js/page-worker.js) and only
 * while they are on screen or next to it (js/page-layout.js); everything else
 * is an empty white rectangle of the right size, so the scrollbar is honest
 * from the start. The document worker (js/document-worker.js) builds the
 * sentences meanwhile, which on a long book takes half a minute, so the pages
 * show first.
 *
 * A document whose pages are slow to draw -- a scan, in practice -- is spotted
 * by how long its pages take, and from then on every page of it is drawn in
 * the background at 150 dpi, nearest the reader first, and kept in the
 * browser (js/page-store.js). Nothing is done to a document that does not
 * need it.
 */
(function () {
  "use strict";

  // The page is about to reload to put itself in the service worker's hands
  // (js/offline.js); starting four Pythons first would only waste the download.
  if (window.MimickOffline?.reloading) return;

  const L = MimickLayout;
  const Store = MimickPageStore;
  const $ = (id) => document.getElementById(id);
  const view = $("view"), pagesEl = $("pages");

  // A page taking longer than this to draw is a slow one; two of them make a
  // slow document. Born-digital pages draw in well under 100 ms, a scanned
  // book's in about 900.
  const SLOW_MS = 400, SLOW_PAGES = 2;
  const KEEP = Store.KEEP_SCALE;

  // --- workers ------------------------------------------------------------------

  /* A worker that answers each message carrying an id exactly once. */
  function startWorker(url, onReady) {
    const worker = new Worker(url);
    const pending = new Map();
    let nextId = 0;
    const self = {
      busy: false, dead: false, openedFor: 0,
      ask(message, transfer = []) {
        if (self.dead) return Promise.reject(new Error("the worker has stopped"));
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ ...message, id }, transfer);
        });
      },
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") { onReady(data); return; }
      const waiting = pending.get(data.id);
      if (data.type === "error" && !waiting) { status("Something went wrong: " + data.message); return; }
      if (!waiting) return;
      pending.delete(data.id);
      if (data.type === "error") waiting.reject(new Error(data.message));
      else waiting.resolve(data);
    };
    // A worker that dies takes its answers with it; say so, rather than leave
    // the page waiting on them for ever.
    worker.onerror = (e) => {
      self.dead = true;
      for (const { reject } of pending.values()) reject(new Error(e.message || "the worker failed"));
      pending.clear();
      status("The reader could not start: " + (e.message || "a worker failed"));
    };
    return self;
  }

  let pythonReady = false, pageWorkersReady = 0, saidReady = false;
  // Said once: each page worker that comes up later would otherwise write it
  // over whatever the status line has said since.
  const readyNow = () => {
    if (saidReady || !pythonReady || !pageWorkersReady) return;
    saidReady = true;
    if (!doc) status("Ready. Open a PDF to begin.");
    // Python is loaded, and kept as it came: now keep the rest for offline use.
    MimickOffline.complete();
  };
  const reading = startWorker("js/document-worker.js", () => { pythonReady = true; readyNow(); });
  // Each is a Python of its own, so a few, not one a core.
  const POOL = Math.max(2, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 4)));
  const pool = Array.from({ length: POOL }, () =>
    startWorker("js/page-worker.js", () => { pageWorkersReady++; readyNow(); update(); }));

  // --- state --------------------------------------------------------------------

  let doc = null;              // { title, pages, key, sentences?, words? }
  let zoom = L.ZOOM_DEFAULT;
  let geometry = L.layout([], zoom);
  let generation = 0;          // bumped on every open, so late answers are dropped
  const slots = new Map();     // page -> { el, canvas, drawnScale }
  const bitmaps = new Map();   // page -> { bitmap, scale }
  const inFlight = new Map();  // page -> scale, while a worker or the store fetches it
  const failed = new Map();    // page -> scale it could not be drawn at; not tried again
  let kept = new Set();        // pages of this document in the store
  let slow = false, slowPages = 0, storeFull = false;
  let openedStatus = "";

  const status = (text) => { $("status").textContent = text; $("status").title = text; };
  const dpr = () => window.devicePixelRatio || 1;

  // --- how long it takes to read -------------------------------------------------
  // In the corner of the bottom bar: the whole document at the speed chosen in
  // the top bar, or, while it reads, what is left at it. Changes with the speed
  // box. The desktop's measured speaking rate (export.py), so it is "about".

  const CHARS_PER_SECOND = 15.1;
  let before = null;               // before[i]: characters in the sentences ahead of sentence i

  async function measureReading() {
    const mine = generation;
    before = null;
    showReadingTime();
    if (!doc?.sentences) return;
    const lengths = await call("sentence_lengths").catch(() => null);
    if (mine !== generation || !lengths) return;
    before = new Float64Array(lengths.length + 1);
    lengths.forEach((n, i) => { before[i + 1] = before[i] + n; });
    showReadingTime();
  }

  function readingTime(chars, rate) {
    const minutes = Math.round(chars / CHARS_PER_SECOND / rate / 60);
    if (minutes < 1) return "under a minute";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  function showReadingTime() {
    const el = $("reading-time");
    if (!doc || !before) { el.hidden = true; return; }
    const total = before[before.length - 1], rate = voice.rate;
    if (voice.state !== "stopped" && voice.source === "document") {
      const left = total - before[Math.min(voice.index, before.length - 1)];
      el.textContent = `${readingTime(left, rate)} left at ${rate}×`;
    } else {
      el.textContent = `${readingTime(total, rate)} to read at ${rate}×`;
    }
    el.title = "About how long reading this document aloud takes at the speed chosen above";
    el.hidden = false;
  }

  function showProgress() {
    // While reading, the status line is the reading's.
    if (!doc || voice.state !== "stopped") return;
    const ahead = slow && !storeFull && kept.size < doc.pages.length
      ? ` · drawing pages ahead, ${kept.size} of ${doc.pages.length}` : "";
    status(openedStatus + ahead);
  }

  // --- opening ------------------------------------------------------------------

  async function openBytes(buffer, name) {
    const mine = ++generation;
    status(pythonReady ? `Opening ${name}…` : `Getting ready, then opening ${name}…`);
    $("empty").hidden = true;
    voice.open(0);
    closeMenu();
    notes.close();
    find.forget();
    order.forget();
    before = null;
    showReadingTime();
    resetMarks();
    clearPages();
    doc = null;
    setReadable(false);
    const t0 = performance.now();
    const key = await Store.hash(buffer);
    if (mine !== generation) return;
    // Every worker needs its own copy; the document worker takes the original.
    const copies = pool.map(() => buffer.slice(0));
    const options = Object.fromEntries(SWITCHES.map((s) => [s, switchOn(s)]));
    const sentences = reading.ask({ type: "open", bytes: buffer, name, options }, [buffer]);
    const opened = pool.map((worker, i) =>
      worker.ask({ type: "open", bytes: copies[i], name }, [copies[i]]).then((info) => {
        if (mine === generation) { worker.openedFor = mine; update(); }
        return info;
      }));
    try {
      const [info, stored] = await Promise.all([Promise.any(opened), Store.open(key)]);
      if (mine !== generation) return;
      doc = { title: info.title, pages: info.pages, key, name };
      kept = stored;
      slow = kept.size > 0;
      document.title = `${doc.title} — Mimick`;
      $("title").textContent = doc.title;
      $("title").title = doc.title;
      $("total").textContent = `of ${doc.pages.length}`;
      $("page").max = doc.pages.length;
      for (const id of ["prev", "next", "page"]) $(id).disabled = false;
      relayout({ page: 0, fraction: 0 });
      openedStatus = `${doc.pages.length} pages · getting the reading ready…`;
      showProgress();
      view.focus();
    } catch (err) {
      if (mine !== generation) return;
      const why = err instanceof AggregateError ? err.errors[0].message : err.message;
      status(`Could not open ${name}: ${why}`);
      $("empty").hidden = false;
      document.title = "Mimick";
      $("title").textContent = "";
      return;
    }
    try {
      const done = await sentences;
      if (mine !== generation) return;
      const restored = await order.restore();
      if (mine !== generation) return;
      if (restored) done.sentences = restored.sentences;
      Object.assign(doc, { sentences: done.sentences, words: done.words, hasFootnotes: done.has_footnotes });
      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      const n = restored?.restored ?? 0;
      openedStatus = `${doc.pages.length} pages · ${done.sentences} sentences to read · opened in ${seconds}s`
        + (n ? ` · ${n} reading-order change${n === 1 ? "" : "s"} of yours put back` : "");
      voice.open(done.sentences);
      setReadable(done.sentences > 0);
      notes.open(doc);
      redrawMarks();
      measureReading();
      find.opened();
    } catch (err) {
      if (mine !== generation) return;
      openedStatus = `${doc.pages.length} pages · this one cannot be read aloud: ${err.message}`;
    }
    showProgress();
  }

  async function openFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      status(`${file.name} is not a PDF.`);
      return;
    }
    openBytes(await file.arrayBuffer(), file.name);
  }

  const chooseFile = () => $("file").click();
  $("open-empty").onclick = chooseFile;
  $("file").onchange = () => { openFile($("file").files[0]); $("file").value = ""; };

  // Drop a PDF anywhere on the page.
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; view.classList.add("dragging"); });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; view.classList.remove("dragging"); } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    view.classList.remove("dragging");
    openFile(e.dataTransfer.files[0]);
  });

  // --- layout and drawing -------------------------------------------------------

  function clearPages() {
    for (const { bitmap } of bitmaps.values()) bitmap.close();
    bitmaps.clear();
    slots.clear();
    inFlight.clear();
    failed.clear();
    kept = new Set();
    slow = false; slowPages = 0; storeFull = false;
    pagesEl.replaceChildren();
    pagesEl.style.height = pagesEl.style.width = "0";
    geometry = L.layout([], zoom);
  }

  /* Lay the pages out again at the current zoom, and put the reader at `where`. */
  function relayout(where) {
    if (!doc) return;
    geometry = L.layout(doc.pages, zoom, view.clientWidth);
    pagesEl.style.width = geometry.width + "px";
    pagesEl.style.height = geometry.height + "px";
    for (const [page, slot] of slots) place(page, slot);
    view.scrollTop = geometry.topFor(where);
    showZoom();
    update();
  }

  function place(page, slot) {
    const [w, h] = geometry.sizes[page];
    Object.assign(slot.el.style, { left: geometry.lefts[page] + "px", top: geometry.offsets[page] + "px",
                                   width: w + "px", height: h + "px" });
    const cw = Math.round(w * dpr()), ch = Math.round(h * dpr());
    if (slot.canvas.width !== cw || slot.canvas.height !== ch) {
      slot.canvas.width = cw;
      slot.canvas.height = ch;
      slot.drawnScale = 0;
    }
  }

  function paint(page) {
    const slot = slots.get(page), drawn = bitmaps.get(page);
    if (!slot || !drawn || slot.drawnScale === drawn.scale) return;
    const ctx = slot.canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(drawn.bitmap, 0, 0, slot.canvas.width, slot.canvas.height);
    slot.drawnScale = drawn.scale;
  }

  // Once per frame at most. A hidden tab gets no frames at all (HANDOFF.md,
  // trap 5), and the page number and buttons still have to keep up there.
  let scheduled = false;
  function update() {
    if (scheduled) return;
    scheduled = true;
    const run = () => { scheduled = false; refresh(); };
    if (document.hidden) setTimeout(run, 16);
    else requestAnimationFrame(run);
  }
  document.addEventListener("visibilitychange", update);

  function refresh() {
    if (!doc) return;
    const top = view.scrollTop, height = view.clientHeight;
    const band = new Set(geometry.band(top, height));

    // Pages that have left the band give back their canvas and their pixels.
    for (const [page, slot] of slots) {
      if (!band.has(page)) { slot.el.remove(); slots.delete(page); }
    }
    for (const [page, drawn] of bitmaps) {
      if (!band.has(page)) { drawn.bitmap.close(); bitmaps.delete(page); }
    }
    for (const page of band) {
      if (slots.has(page)) continue;
      const el = document.createElement("div");
      el.className = "page";
      el.setAttribute("aria-label", `Page ${page + 1}`);
      el.dataset.page = page;
      const canvas = document.createElement("canvas");
      el.append(canvas);
      pagesEl.append(el);
      const slot = { el, canvas, drawnScale: 0 };
      slots.set(page, slot);
      place(page, slot);
      drawHighlight(page);
    }
    for (const page of band) paint(page);

    const current = geometry.pageAt(top + height / 3);
    if (document.activeElement !== $("page")) $("page").value = current + 1;
    $("prev").disabled = current <= 0;
    $("next").disabled = current >= doc.pages.length - 1;
    notes.pageShown();
    drawNext();
  }

  /* The scale a page is wanted at. A slow document's kept copy stands in
   * whenever it is sharp enough -- within 10% of the zoom -- and past that the
   * page is drawn for the zoom as any other would be. */
  function wanted(page) {
    const exact = geometry.renderScale(page, dpr());
    return slow && exact <= KEEP * 1.1 ? keepScale(page) : exact;
  }
  function keepScale(page) {
    const [w, h] = doc.pages[page];
    return Math.min(KEEP, Math.sqrt(L.MAX_PAGE_PIXELS / (w * h)));
  }
  const same = (a, b) => Math.abs(a - b) < 1e-6;

  /* Take a finished bitmap if it is nearer what the page wants than what it
   * has; a page drawn at another zoom stays up, stretched, until then. */
  function accept(page, scale, bitmap) {
    const have = bitmaps.get(page), want = wanted(page);
    if (!slots.has(page) || (have && Math.abs(have.scale - want) <= Math.abs(scale - want))) {
      bitmap.close();
      return;
    }
    have?.bitmap.close();
    bitmaps.set(page, { bitmap, scale });
    paint(page);
  }

  const idleWorker = () => pool.find((w) => !w.busy && !w.dead && w.openedFor === generation);

  /* Whatever is on screen first, nearest the middle first, then the pages
   * either side; then, for a slow document, the pages nobody is looking at yet. */
  function drawNext() {
    if (!doc) return;
    const top = view.scrollTop, height = view.clientHeight, middle = top + height / 2;
    const shown = geometry.onScreen(top, height);
    const band = geometry.band(top, height);
    const byDistance = (a, b) => Math.abs(geometry.offsets[a] + geometry.sizes[a][1] / 2 - middle)
                               - Math.abs(geometry.offsets[b] + geometry.sizes[b][1] / 2 - middle);
    for (const page of [...shown.sort(byDistance), ...band.filter((p) => !shown.includes(p))]) {
      const scale = wanted(page), have = bitmaps.get(page);
      if ((have && same(have.scale, scale)) || inFlight.has(page)) continue;
      if (failed.has(page) && same(failed.get(page), scale)) continue;
      const keeping = slow && same(scale, keepScale(page));
      if (keeping && kept.has(page)) { fromStore(page, scale); continue; }
      const worker = idleWorker();
      if (!worker) return;
      draw(worker, page, scale, keeping && !storeFull);
    }
    drawAhead();
  }

  function drawAhead() {
    if (!slow || storeFull || kept.size >= doc.pages.length) return;
    const from = geometry.pageAt(view.scrollTop + view.clientHeight / 3);
    for (let d = 0, worker = idleWorker(); worker && d < doc.pages.length; d++) {
      for (const page of d ? [from + d, from - d] : [from]) {
        if (!worker || page < 0 || page >= doc.pages.length) continue;
        if (kept.has(page) || inFlight.has(page) || failed.has(page)) continue;
        draw(worker, page, keepScale(page), true);
        worker = idleWorker();
      }
    }
  }

  function draw(worker, page, scale, keep) {
    const mine = generation;
    worker.busy = true;
    inFlight.set(page, scale);
    worker.ask({ type: "render", page, scale, keep })
      .then(({ bitmap, blob, renderMs }) => {
        if (mine !== generation) { bitmap.close(); return; }
        if (blob) {
          kept.add(page);
          Store.put(doc.key, page, blob).then((ok) => {
            if (mine !== generation || ok) return;
            kept.delete(page);
            storeFull = true;   // most likely out of space: draw as normal from here
          });
        }
        if (!slow && !keep && renderMs > SLOW_MS && ++slowPages >= SLOW_PAGES) {
          slow = true;
          Store.markSlow(doc.key, doc.pages.length);
        }
        accept(page, scale, bitmap);
        showProgress();
      })
      .catch((err) => {
        if (mine !== generation) return;
        failed.set(page, scale);
        status(`Page ${page + 1} could not be drawn: ${err.message}`);
      })
      .finally(() => {
        worker.busy = false;
        if (mine === generation && same(inFlight.get(page) ?? -1, scale)) inFlight.delete(page);
        update();
      });
  }

  function fromStore(page, scale) {
    const mine = generation;
    inFlight.set(page, scale);
    Store.get(doc.key, page)
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bitmap) => {
        if (mine !== generation) { bitmap?.close(); return; }
        if (bitmap) accept(page, scale, bitmap);
        else kept.delete(page);
      })
      .catch(() => { if (mine === generation) kept.delete(page); })
      .finally(() => {
        if (mine === generation) inFlight.delete(page);
        update();
      });
  }

  view.addEventListener("scroll", update, { passive: true });
  new ResizeObserver(() => doc && relayout(geometry.anchor(view.scrollTop))).observe(view);
  // A move to a screen of another density changes how many pixels a page needs.
  matchMedia(`(resolution: ${dpr()}dppx)`).addEventListener?.("change", () => doc && relayout(geometry.anchor(view.scrollTop)));

  // --- pages --------------------------------------------------------------------

  function goToPage(page) {
    if (!doc) return;
    page = Math.min(doc.pages.length - 1, Math.max(0, page));
    view.scrollTop = geometry.topFor({ page, fraction: 0 }) - L.PAGE_MARGIN;
    $("page").value = page + 1;
    update();
  }
  const currentPage = () => geometry.pageAt(view.scrollTop + view.clientHeight / 3);

  $("prev").onclick = () => goToPage(currentPage() - 1);
  $("next").onclick = () => goToPage(currentPage() + 1);
  $("page").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { goToPage(Number($("page").value) - 1); view.focus(); }
    if (e.key === "Escape") { $("page").value = currentPage() + 1; view.focus(); }
  });
  $("page").addEventListener("change", () => goToPage(Number($("page").value) - 1));

  // --- zoom ---------------------------------------------------------------------

  function setZoom(next, anchorAt = null) {
    next = L.clampZoom(next);
    if (!doc) { zoom = next; showZoom(); return; }
    if (Math.abs(next - zoom) < 1e-6) { showZoom(); return; }
    // Keep still whatever is under the pointer, or else the top of the view.
    const y = anchorAt ?? 0;
    const where = geometry.anchor(view.scrollTop + y);
    const xFraction = view.scrollWidth > view.clientWidth
      ? (view.scrollLeft + view.clientWidth / 2) / geometry.width : 0.5;
    zoom = next;
    relayout(where);
    notes.refreshAll();
    view.scrollTop = Math.max(0, view.scrollTop - y);
    view.scrollLeft = Math.max(0, xFraction * geometry.width - view.clientWidth / 2);
  }
  function showZoom() {
    const percent = Math.round(zoom * 100);
    $("zoom-slider").value = percent;
    if (document.activeElement !== $("zoom")) $("zoom").value = percent;
    $("zoom-out").disabled = zoom <= L.ZOOM_MIN + 1e-6;
    $("zoom-in").disabled = zoom >= L.ZOOM_MAX - 1e-6;
  }

  $("zoom-in").onclick = () => setZoom(zoom * L.ZOOM_STEP);
  $("zoom-out").onclick = () => setZoom(zoom / L.ZOOM_STEP);
  $("zoom-slider").oninput = () => setZoom(Number($("zoom-slider").value) / 100);
  // Once the mouse lets go, the keys go back to the page, or Page Up and Page
  // Down move the slider -- and the zoom -- instead of turning the page.
  $("zoom-slider").onpointerup = () => view.focus();
  $("zoom").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { setZoom(Number($("zoom").value) / 100); view.focus(); }
  });
  $("zoom").addEventListener("change", () => setZoom(Number($("zoom").value) / 100));

  // Ctrl + wheel, and a trackpad pinch, which arrives as the same thing: zoom
  // the page, not the whole browser tab.
  view.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
    setZoom(zoom * factor, e.clientY - view.getBoundingClientRect().top);
  }, { passive: false });

  // --- reading aloud ------------------------------------------------------------
  // js/read-aloud.js does the reading; this draws it on the page and gives it
  // its controls.

  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
  const remember = (name, value) => { try { localStorage.setItem(name, String(value)); } catch { /* not kept */ } };
  const recall = (name) => { try { return localStorage.getItem(name); } catch { return null; } };

  // What is lit: the sentence being read, as read-aloud.js made it, and the
  // position of the word being said in its words.
  let lit = { sentence: null, made: null, position: null };

  const Voices = MimickVoices;
  const savedVoice = recall("mimick-voice");
  const voiceLabel = (key) => { const v = Voices.byKey[key]; return v ? `${v.name} (${v.accent})` : key; };

  const voice = MimickReadAloud.create({
    askDocument: (message) => reading.ask(message),
    voice: Voices.byKey[savedVoice] ? savedVoice : Voices.DEFAULT,
    voiceName: voiceLabel,
    onSentence(index, made) {
      showReadingTime();
      lit = { sentence: index, made, position: null };
      if (made) {
        const [page, box] = made.lines[0];
        if (voice.source === "document") {
          remember(`mimick-position:${doc.key}`, index);
          status(`Sentence ${index + 1} of ${doc.sentences} · page ${page + 1}`);
        } else {
          status(`Reading your selection · sentence ${index + 1} of ${voice.count}`);
        }
        const [word, on, rect] = made.words[0];
        placeCaret(word, false, [on, rect[0], rect[1], rect[3]]);
        keepInView(page, box);
      }
      redrawMarks();
    },
    onWord(index, position) {
      if (index !== lit.sentence || !lit.made) return;
      lit.position = position;
      // The cursor rides along with the voice, so pausing leaves it where you
      // stopped listening and the arrow keys carry on from there.
      const [word, page, rect] = lit.made.words[position];
      placeCaret(word, false, [page, rect[0], rect[1], rect[3]]);
      redrawMarks();
      keepInView(page, rect);
    },
    onState(state) {
      $("play").textContent = { stopped: "Read aloud", loading: "Loading voice…", buffering: "Pause",
                                playing: "Pause", paused: "Resume" }[state];
      $("back").disabled = $("forward").disabled = state === "stopped";
      // A blinking cursor says the arrow keys move it, which is true unless the voice is reading.
      pagesEl.classList.toggle("reading", isReading(state));
      if (state === "paused") status("Paused — the arrow keys move the cursor, Shift selects");
      if (state === "loading") status("Getting the voice ready…");
      if (state === "stopped") showProgress();
      showReadingTime();
    },
    onStatus: status,
  });

  function setReadable(on) {
    $("play").disabled = !on;
    $("play").title = on ? "Start or pause reading  (Space)" : "Reading aloud is ready once the sentences are";
  }

  /* The sentence tint and the word, over one page, placed in fractions of the
   * page so a zoom moves them with it. */
  function drawHighlight(page) {
    const slot = slots.get(page);
    if (!slot || !doc) return;
    for (const old of slot.el.querySelectorAll(".hl, .caret, .remove, .plan")) old.remove();
    const [w, h] = doc.pages[page];
    const add = (kind, rect, pad = 0) => {
      const box = document.createElement("div");
      box.className = `hl ${kind}`;
      placeBox(box, page, rect, pad);
      slot.el.append(box);
    };
    order.draw(page, slot.el);
    notes.draw(page, slot.el);
    find.draw(page, slot.el);
    for (const [on, box] of selectionBoxes) if (on === page) add("selection", box, 1);
    if (lit.made) {
      for (const [on, box] of lit.made.lines) if (on === page) add("sentence", box);
      const word = lit.position === null ? null : lit.made.words[lit.position];
      if (word && word[1] === page) add("word", word[2], 1);
    }
    if (caret.place && caret.place[0] === page) {
      const [, x, y0, y1] = caret.place;
      const bar = document.createElement("div");
      bar.className = "caret";
      Object.assign(bar.style, { left: `${x / w * 100}%`, top: `${(y0 - 1) / h * 100}%`,
                                 height: `${(y1 - y0 + 2) / h * 100}%` });
      slot.el.append(bar);
    }
  }
  const redrawMarks = () => { for (const page of slots.keys()) drawHighlight(page); };

  /* Place an element over a rectangle of a page, in fractions of the page so a
   * zoom moves it with it. `pad` is in PDF points. */
  function placeBox(box, page, [x0, y0, x1, y1], pad = 0) {
    const [w, h] = doc.pages[page];
    Object.assign(box.style, { left: `${(x0 - pad) / w * 100}%`, top: `${(y0 - pad) / h * 100}%`,
                               width: `${(x1 - x0 + 2 * pad) / w * 100}%`, height: `${(y1 - y0 + 2 * pad) / h * 100}%` });
  }

  /* The desktop's rule: leave the view alone while what is read is on screen;
   * otherwise bring it a third of the way down. */
  function keepInView(page, [, y0, , y1]) {
    const top = geometry.offsets[page] + y0 * zoom, bottom = geometry.offsets[page] + y1 * zoom;
    if (top >= view.scrollTop && bottom <= view.scrollTop + view.clientHeight) return;
    view.scrollTop = Math.max(0, (top + bottom) / 2 - view.clientHeight / 3);
    update();
  }

  /* Reading a selection swaps the voice's sentences for the selection's; this
   * puts the document's back. */
  function useDocument() {
    if (voice.source !== "document") voice.open(doc.sentences, "document");
  }

  function readFrom(sentence) {
    if (sentence === null || !doc?.sentences) return;
    voice.prepare();
    useDocument();
    voice.play(sentence);
  }

  /* Carry on where this document was left, if that is where the reader is
   * looking; otherwise start at the top of the page on screen. */
  async function startReading() {
    useDocument();
    const mine = generation, page = currentPage();
    let from = Number(recall(`mimick-position:${doc.key}`));
    if (Number.isInteger(from) && from > 0 && from < doc.sentences) {
      const { sentences: [there] } = await reading.ask({ type: "sentences", start: from, count: 1 });
      if (!there || Math.abs(there.page - page) > 1) from = null;
    } else {
      from = null;
    }
    from ??= (await reading.ask({ type: "firstSentenceOn", page })).sentence ?? 0;
    if (mine === generation) voice.play(from);
  }

  function togglePlay() {
    if (!doc?.sentences) return;
    voice.prepare();     // inside the click or key press, which is what lets it make sound
    if (voice.state !== "stopped") voice.toggle();
    else if (selection) readSelection();
    else startReading();
  }

  $("play").onclick = () => { togglePlay(); view.focus(); };
  $("back").onclick = () => { voice.skip(-1); view.focus(); };
  $("forward").onclick = () => { voice.skip(1); view.focus(); };

  // --- the voice ------------------------------------------------------------------
  // The seven in js/voices.js. Each model downloads the first time it reads and
  // is kept; the ▶ beside the box plays the clip shipped for it, so a voice can
  // be heard before anything is downloaded.

  for (const v of Voices.LIST) {
    const option = new Option(`${v.name} (${v.accent}) — ${v.note}`, v.key);
    $("voice").append(option);
  }
  $("voice").value = voice.voice;
  const describeVoice = () => { const v = Voices.byKey[$("voice").value]; $("voice").title = `${v.name}: ${v.note}`; };
  describeVoice();

  /* Whether a voice's model is already kept in this browser. */
  async function voiceKept(key) {
    try { return !!(await (await caches.open("mimick-voices-v1")).match(Voices.modelUrl(key, ".onnx"))); }
    catch { return false; }
  }

  $("voice").onchange = async () => {
    const key = $("voice").value;
    describeVoice();
    stopSample();
    voice.setVoice(key);
    remember("mimick-voice", key);
    view.focus();
    if (isReading()) return;
    const v = Voices.byKey[key];
    status(`${voiceLabel(key)} — ${v.note}. `
      + ((await voiceKept(key)) ? "Ready to read." : `Downloads ${v.mb} MB the first time it reads; ▶ plays a sample now.`));
  };

  let sample = null;
  function stopSample() {
    if (!sample) return;
    sample.pause();
    sample = null;
    $("voice-sample").textContent = "▶";
    $("voice-sample").title = "Hear this voice";
  }
  $("voice-sample").onclick = () => {
    if (sample) { stopSample(); view.focus(); return; }
    // Not over the reading: pause it first.
    if (isReading()) voice.pause();
    const playing = sample = new Audio(Voices.sampleUrl($("voice").value));
    $("voice-sample").textContent = "■";
    $("voice-sample").title = "Stop the sample";
    playing.onended = playing.onerror = () => { if (sample === playing) stopSample(); };
    playing.play().catch((err) => { if (sample === playing) { stopSample(); status("The sample could not play: " + err.message); } });
    view.focus();
  };

  for (const speed of SPEEDS) $("speed").append(new Option(`${speed}×`, speed));
  const savedRate = Number(recall("mimick-rate"));
  $("speed").value = SPEEDS.includes(savedRate) ? savedRate : 1;
  voice.setRate(Number($("speed").value));
  $("speed").onchange = () => {
    const rate = Number($("speed").value);
    voice.setRate(rate);
    remember("mimick-rate", rate);
    showReadingTime();
    view.focus();
  };

  // --- selecting, and the text cursor -------------------------------------------
  // The desktop's PageView and MainWindow rules. Where words are, and how the
  // cursor steps between them, is answered by the desktop's document.py in the
  // document worker (reader.py); this keeps the state and draws it.

  const call = (name, ...args) => reading.ask({ type: "call", name, args }).then((d) => d.result);
  const isReading = (state = voice.state) => state === "playing" || state === "buffering";

  let selection = null;          // [first, last] word index
  let selectionBoxes = [];       // [[page, rect]], one a line
  let selectionText = null;      // for Ctrl+C, once fetched: { for: selection, text }
  let anchor = null;             // the fixed end of a selection made with the keys
  let caret = { index: -1, trailing: false, place: null };   // place: [page, x, top, bottom]

  function resetMarks() {
    selection = null; selectionBoxes = []; selectionText = null; anchor = null;
    caret = { index: -1, trailing: false, place: null };
    lit = { sentence: null, made: null, position: null };
  }

  function setSelection(first, last) {
    const next = first === null || last < first ? null : [first, last];
    if (next && selection && next[0] === selection[0] && next[1] === selection[1]) return;
    selection = next;
    selectionText = null;
    if (!selection) { selectionBoxes = []; redrawMarks(); return; }
    fetchSelection();
  }

  // A drag changes the selection far faster than the worker answers; only the
  // latest one is asked about.
  let fetching = false;
  async function fetchSelection() {
    if (fetching) return;
    fetching = true;
    try {
      for (let asked = null; selection && asked !== selection;) {
        asked = selection;
        const mine = generation;
        const [boxes, text] = await Promise.all([call("selection_boxes", ...asked), call("selection_text", ...asked)]);
        if (mine !== generation) return;
        if (asked === selection) {
          selectionBoxes = boxes;
          selectionText = { for: asked, text };
          redrawMarks();
        }
      }
    } finally {
      fetching = false;
    }
  }

  function announceSelection() {
    if (!selection) return;
    const n = selection[1] - selection[0] + 1;
    status(`${n} word${n === 1 ? "" : "s"} selected — press Enter to read ${n === 1 ? "it" : "them"}`);
  }

  /* Put the cursor in front of word `index`. `place` is where it is drawn, when
   * the caller already knows; otherwise the worker is asked. */
  function placeCaret(index, trailing = false, place = null) {
    caret = { index, trailing, place: place ?? caret.place };
    if (place) return Promise.resolve();
    const mine = generation, wanted = caret;
    return call("caret_place", index, trailing).then((found) => {
      if (mine !== generation || caret !== wanted) return;
      caret.place = found;
      redrawMarks();
    });
  }

  /* Keep the cursor on screen, scrolling as little as will do it. */
  function caretIntoView() {
    if (!caret.place) return;
    const [page, , y0, y1] = caret.place;
    const top = geometry.offsets[page] + y0 * zoom, bottom = geometry.offsets[page] + y1 * zoom;
    const margin = (bottom - top) * 2;
    if (top - margin < view.scrollTop) view.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > view.scrollTop + view.clientHeight) view.scrollTop = bottom + margin - view.clientHeight;
    update();
  }

  // Held-down keys arrive faster than the worker answers; take them in order.
  let caretQueue = Promise.resolve();
  const moveCaret = (step, direction, extend) => {
    caretQueue = caretQueue.then(() => moveCaretNow(step, direction, extend))
      .catch((err) => status("The cursor could not move: " + err.message));
  };

  /* An arrow key while the voice is not reading. The cursor sits in front of a
   * word, so an anchor at a and a cursor at c select words min(a, c) to
   * max(a, c) - 1. */
  async function moveCaretNow(step, direction, extend) {
    if (!doc?.words) return;
    const mine = generation;
    let at = caret.index, trailing = caret.trailing;
    if (at < 0) {
      // Nothing has put the cursor anywhere yet: start at the top of the page being looked at.
      const span = await call("page_span", currentPage());
      at = span ? span[0] : 0;
      trailing = false;
    }
    // A selection made with the mouse, or cleared, leaves the anchor stale;
    // settle it against what is actually selected.
    if (!selection) anchor = null;
    else if (anchor === null) anchor = at > selection[1] ? selection[0] : selection[1] + 1;

    const [moved, trails] = step === "word"
      ? [Math.max(0, Math.min(at + direction, doc.words)), false]
      : await call("caret_step", at, trailing, step, direction);
    if (mine !== generation) return;
    if (extend) {
      anchor ??= at;
      if (anchor === moved) setSelection(null);
      else setSelection(Math.min(anchor, moved), Math.max(anchor, moved) - 1);
      announceSelection();
    } else {
      anchor = null;
      setSelection(null);
    }
    await placeCaret(moved, trails);
    if (mine === generation) caretIntoView();
  }

  const readSelection = () => selection && readRange(...selection);

  /* Read words `first` to `last`, then go quiet: a selection, or a highlight. */
  async function readRange(first, last) {
    if (!doc?.sentences) return;
    voice.prepare();
    const mine = generation;
    const count = await call("select_range", first, last);
    if (mine !== generation) return;
    if (!count) { status("That has no readable text"); return; }
    voice.open(count, "selection");
    voice.play(0);
  }

  async function copyText(text, said) {
    try {
      await navigator.clipboard.writeText(text);
      status(said);
    } catch (err) {
      status("Could not copy: " + err.message);
    }
  }

  /* Ctrl+C: the selection, or else the highlight picked out. */
  async function copySelection() {
    if (!selection) {
      if (notes.active) notes.copy(notes.active);
      else status("Select some text first — drag across it, or press Ctrl+A");
      return;
    }
    const chosen = selection;
    const text = selectionText?.for === chosen ? selectionText.text : await call("selection_text", ...chosen);
    const n = chosen[1] - chosen[0] + 1;
    copyText(text, `Copied ${n} word${n === 1 ? "" : "s"}`);
  }

  async function selectPage() {
    if (!doc?.words) return;
    const span = await call("page_span", currentPage());
    if (span) { anchor = null; setSelection(...span); announceSelection(); }
  }

  /* A point on the screen as a page and PDF points on it, or null off the pages. */
  function pointOnPage(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)?.closest?.(".page");
    if (!el || !doc) return null;
    const page = Number(el.dataset.page), [w, h] = doc.pages[page], box = el.getBoundingClientRect();
    return { page, x: (clientX - box.left) / box.width * w, y: (clientY - box.top) / box.height * h };
  }

  // Press on a word and drag to select; a click with no drag reads from the
  // sentence clicked. Starting off the text clears the selection.
  let press = null;
  let doubleClicks = 0;
  view.addEventListener("pointerdown", (e) => {
    if (!e.target.closest?.("#menu")) closeMenu();
    press = null;
    if (e.button !== 0 || !doc?.words || !e.target.closest?.(".page") || e.target.closest(".remove")) return;
    const at = pointOnPage(e.clientX, e.clientY);
    // With the reading order showing, a click reads or skips a region and does nothing else.
    if (order.shown) { order.click(at.page, at.x, at.y); view.focus(); return; }
    // A press on a highlight picks it out instead of starting a selection.
    const hit = notes.at(at.page, at.x, at.y);
    if (hit) {
      anchor = null;
      setSelection(null);
      notes.pick(hit);
      view.focus();
      return;
    }
    notes.pick(null);
    const mine = { x: e.clientX, y: e.clientY, at, dragging: false, anchor: null, word: null };
    press = mine;
    view.setPointerCapture(e.pointerId);
    mine.word = call("word_at", at.page, at.x, at.y, false).then((word) => {
      if (press !== mine) return word;
      if (word === null) { if (!mine.dragging) setSelection(null); return word; }
      mine.anchor = word;
      if (!mine.dragging) placeCaret(word);
      return word;
    });
  });

  let dragAsk = null;
  view.addEventListener("pointermove", (e) => {
    const mine = press;
    if (!mine || !(e.buttons & 1)) return;
    if (!mine.dragging && Math.hypot(e.clientX - mine.x, e.clientY - mine.y) < 4) return;
    mine.dragging = true;
    const at = pointOnPage(e.clientX, e.clientY);
    if (!at) return;
    const wanted = dragAsk = { at };
    mine.word.then(() => (mine.anchor === null || wanted !== dragAsk ? null
                         : call("word_at", at.page, at.x, at.y, true))).then((word) => {
      if (word === null || wanted !== dragAsk || press !== mine) return;
      anchor = null;
      setSelection(Math.min(mine.anchor, word), Math.max(mine.anchor, word));
      // The cursor rides the moving end, so Shift+arrow carries on from where the pointer stopped.
      placeCaret(word >= mine.anchor ? word + 1 : word, word >= mine.anchor);
    });
  });

  view.addEventListener("pointerup", (e) => {
    const was = press;
    press = null;
    if (!was || e.button !== 0) return;
    if (was.dragging) { was.word.then(() => setTimeout(announceSelection, 50)); return; }
    // A plain click: drop the selection and read from the sentence clicked.
    voice.prepare();
    const clicks = doubleClicks, mine = generation;
    was.word.then((word) => {
      if (word === null || mine !== generation) return;
      anchor = null;
      setSelection(null);
      if (!doc.sentences) return;
      return reading.ask({ type: "sentenceAt", page: was.at.page, x: was.at.x, y: was.at.y }).then(({ sentence }) => {
        if (clicks === doubleClicks && mine === generation && switchOn("click_read")) readFrom(sentence);
      });
    });
  });

  // Double-click selects the sentence, as on the desktop -- and takes back the
  // reading its first click started.
  view.addEventListener("dblclick", (e) => {
    if (!doc?.words || order.shown) return;
    doubleClicks++;
    const at = pointOnPage(e.clientX, e.clientY);
    if (!at) return;
    const hit = notes.at(at.page, at.x, at.y);
    if (hit) { notes.edit(hit); return; }
    const mine = generation, startedBy = voice.state;
    call("word_at", at.page, at.x, at.y, false)
      .then((word) => (word === null ? null : call("sentence_span", word)))
      .then((span) => {
        if (!span || mine !== generation) return;
        if (startedBy !== "stopped" && voice.source === "document") voice.stop();
        anchor = null;
        setSelection(...span);
        announceSelection();
      });
  });

  // --- the right-click menu -----------------------------------------------------

  const menu = $("menu");
  function closeMenu() { menu.hidden = true; menu.replaceChildren(); delete menu.dataset.from; }

  function showMenu(x, y, items) {
    menu.replaceChildren();
    for (const item of items) {
      if (item === "-") { menu.append(Object.assign(document.createElement("hr"), {})); continue; }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      const label = Object.assign(document.createElement("span"), { className: "label", textContent: item.label });
      if (item.swatch) label.prepend(Object.assign(document.createElement("span"), { className: "dot", style: `background: ${item.swatch}` }));
      if ("checked" in (item)) {
        button.setAttribute("role", "menuitemcheckbox");
        button.setAttribute("aria-checked", item.checked);
        label.prepend(Object.assign(document.createElement("span"), { className: "check", textContent: item.checked ? "✓" : "" }));
      }
      if (item.indent) label.classList.add("indent");
      button.append(label);
      if (item.keys) button.append(Object.assign(document.createElement("span"), { className: "keys", textContent: item.keys }));
      button.disabled = item.enabled === false;
      button.onclick = () => { closeMenu(); view.focus(); item.run(); };
      menu.append(button);
    }
    menu.hidden = false;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, innerWidth - width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - height - 4)) + "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  }

  view.addEventListener("contextmenu", async (e) => {
    if (!doc) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY, mine = generation;
    const at = pointOnPage(x, y);
    const sentence = at && doc.sentences
      ? (await reading.ask({ type: "sentenceAt", page: at.page, x: at.x, y: at.y })).sentence : null;
    if (mine !== generation) return;
    const hit = at && notes.ready ? notes.at(at.page, at.x, at.y) : null;
    if (hit && !selection) notes.pick(hit);
    showMenu(x, y, [
      { label: "Start reading from here", enabled: sentence !== null, run: () => readFrom(sentence) },
      ...(selection ? [{ label: "Read the selection", keys: "Enter", run: readSelection }] : []),
      "-",
      ...(selection ? [
        { label: "Copy", keys: "Ctrl+C", run: copySelection },
        ...(notes.ready ? [{ label: "Highlight", keys: "Ctrl+H", run: () => notes.highlight(false) },
                           { label: "Highlight and write a note…", keys: "Ctrl+M", run: () => notes.highlight(true) }] : []),
      ] : hit ? notes.menuItems(hit)
        : [{ label: "Select some text to copy or highlight it", enabled: false }]),
    ]);
  });
  window.addEventListener("blur", closeMenu);
  view.addEventListener("scroll", closeMenu, { passive: true });
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  menu.addEventListener("keydown", (e) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      buttons[(at + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  });

  // --- keys ---------------------------------------------------------------------
  // The desktop's keys, where a browser lets a page have them. See "Shortcuts"
  // in the desktop repo's docs/FUTURE-FEATURES.md.

  // --- what gets read: the Display menu's switches ------------------------------
  // Each is remembered, and the document worker is told at open. Changing one
  // rebuilds the sentences; the reader's place is held by the word being read,
  // whose index a rebuild never changes (desktop trap 9).

  const SWITCHES = ["skip_citations", "read_footnotes", "clean_text"];
  const switchOn = (name) => recall("mimick-" + name) !== "0";

  async function setSwitch(name, on) {
    remember("mimick-" + name, on ? "1" : "0");
    const said = {
      click_read: on ? "Click any sentence to read from there" : "Clicking never starts reading — select text and press Enter",
      skip_citations: on ? "Citations will be skipped" : "Citations will be read aloud",
      read_footnotes: on ? "Footnotes will be read" : "Footnotes will be passed over",
    }[name];
    if (name === "click_read" || !doc?.sentences) { if (said) status(said); return; }
    await rebuild((anchor) => call("set_reading", name, on, anchor),
                  ({ sentences }) => said ?? `${sentences} sentences · ${on ? "tidied for reading" : "reading the PDF verbatim"}`);
  }

  /* Change what is read, holding the reader's place by the word being read.
   * `ask` gets that word's index and answers { sentences, resume }, or null
   * for nothing changed; `say` words the status line from the answer. */
  async function rebuild(ask, say) {
    const mine = generation, wasReading = isReading();
    const anchor = voice.source === "document" && lit.made ? lit.made.words[0][0] : -1;
    if (wasReading) voice.prepare();
    voice.stop();
    const result = await ask(anchor);
    if (mine !== generation || !result) return null;
    doc.sentences = result.sentences;
    voice.open(result.sentences, "document");
    order.forget();
    measureReading();
    openedStatus = `${doc.pages.length} pages · ${result.sentences} sentences to read`;
    status(say(result));
    if (wasReading) voice.play(result.resume);
    redrawMarks();
    return result;
  }

  // --- the reading order --------------------------------------------------------
  // Ctrl+R: every region of the page outlined, numbered in the order it is read,
  // with what is left out washed over and labelled. A click reads or skips a
  // region. The desktop's PageView._draw_plan and MainWindow._on_region_clicked;
  // choices are kept per document, by region key, and put back at open.

  const order = (() => {
    let shown = recall("mimick-show-order") === "1";
    let busy = false;
    const pages = new Map();     // page -> regions, or a promise of them
    const storeKey = () => `mimick-order:${doc.key}`;
    const saved = () => { try { return JSON.parse(recall(storeKey()) || "{}") || {}; } catch { return {}; } };

    function draw(page, pageEl) {
      if (!shown || !doc?.sentences) return;
      const found = pages.get(page);
      if (!found) {
        // A rebuild while this is on its way forgets it; only the latest ask may land.
        const asked = call("regions", page).then((regions) => {
          if (pages.get(page) !== asked) return;
          pages.set(page, regions);
          drawHighlight(page);
        }).catch(() => { if (pages.get(page) === asked) pages.delete(page); });
        pages.set(page, asked);
        return;
      }
      if (!Array.isArray(found)) return;
      for (const region of found) {
        const box = document.createElement("div");
        box.className = `plan ${region.reads ? "reads" : "skipped"}`;
        box.title = region.reads ? `Read ${ordinal(region.number)} on this page — click to skip it`
          : `Skipped: ${region.label}${region.reason ? ` (${region.reason})` : ""} — click to read it`;
        placeBox(box, page, region.rect);
        box.append(Object.assign(document.createElement("span"), { className: "tag",
          textContent: region.reads ? region.number : region.label }));
        pageEl.append(box);
      }
    }

    const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"));

    /* The region under a point, from what is drawn; padded as Document.region_at does. */
    function at(page, x, y) {
      const found = pages.get(page);
      if (!Array.isArray(found)) return null;
      return found.find(({ rect: [x0, y0, x1, y1] }) => x0 - 2 <= x && x <= x1 + 2 && y0 - 2 <= y && y <= y1 + 2) ?? null;
    }

    async function counts() {
      const [reads, skipped] = await call("region_counts");
      return `Reading ${reads} regions, skipping ${skipped} — click one to change it`;
    }

    async function toggle() {
      shown = !shown;
      remember("mimick-show-order", shown ? "1" : "0");
      pagesEl.classList.toggle("planning", shown);
      if (!shown) status("Reading order hidden");
      else if (!doc?.sentences) status(doc ? "The reading order shows once the document is ready" : "Open a PDF to see its reading order");
      else { const mine = generation, said = await counts(); if (mine === generation && shown) status(said); }
      redrawMarks();
    }

    async function click(page, x, y) {
      const region = at(page, x, y);
      if (!region) { status("Nothing is read or skipped there — click inside an outline"); return; }
      if (busy) { status("Still working out the last change…"); return; }
      busy = true;
      const key = doc.key;
      try {
        await rebuild((anchor) => call("toggle_region", page, region.key, anchor), (result) => {
          const choices = saved();
          choices[region.key] = result.reads;
          remember(`mimick-order:${key}`, JSON.stringify(choices));
          return `${result.reads ? "Now reading" : "Now skipping"} that region — ${result.sentences} sentences in total`;
        });
      } catch (err) {
        status("That region could not be changed: " + err.message);
      } finally {
        busy = false;
      }
    }

    async function reset() {
      if (!doc?.sentences || busy) return;
      busy = true;
      try {
        forgetStored(doc.key);
        await rebuild((anchor) => call("reset_regions", anchor),
                      () => "Reading order reset to what Mimick works out by itself");
      } finally {
        busy = false;
      }
    }
    const forgetStored = (key) => { try { localStorage.removeItem(`mimick-order:${key}`); } catch { /* not kept */ } };

    /* Just opened: put back the corrections made last time. Answers what the
     * status line should add, or "". */
    async function restore() {
      const choices = saved();
      if (!Object.keys(choices).length) return null;
      return call("set_region_choices", choices);
    }

    pagesEl.classList.toggle("planning", shown);
    return {
      draw, at, toggle, click, reset, restore,
      forget: () => pages.clear(),
      get on() { return shown; },
      get shown() { return shown && !!doc?.sentences; },
      get changed() { return !!doc && Object.keys(saved()).length > 0; },
    };
  })();

  function displayMenu() {
    return [
      { label: "Show reading order", keys: "Ctrl+R", checked: order.on, run: order.toggle },
      { label: "Click to read", checked: switchOn("click_read"), run: () => setSwitch("click_read", !switchOn("click_read")) },
      { label: "Skip citations while reading", checked: switchOn("skip_citations"),
        run: () => setSwitch("skip_citations", !switchOn("skip_citations")) },
      // Greyed out where there are none: a live switch that changes nothing reads as broken.
      { label: "Read footnotes", checked: switchOn("read_footnotes"), enabled: !doc || !!doc.hasFootnotes,
        run: () => setSwitch("read_footnotes", !switchOn("read_footnotes")) },
      { label: "Clean up text for reading", checked: switchOn("clean_text"),
        run: () => setSwitch("clean_text", !switchOn("clean_text")) },
      { label: "Reset reading order", enabled: !!doc?.sentences && order.changed, run: order.reset },
      "-",
      ...notes.displayMenu(),
      "-",
      { label: "Zoom in", keys: "Ctrl++", run: () => setZoom(zoom * L.ZOOM_STEP) },
      { label: "Zoom out", keys: "Ctrl+−", run: () => setZoom(zoom / L.ZOOM_STEP) },
      { label: "Reset zoom", keys: "Ctrl+0", run: () => setZoom(L.ZOOM_DEFAULT) },
    ];
  }

  const dropDown = (id, items) => {
    $(id).onclick = (e) => {
      const b = e.currentTarget.getBoundingClientRect();
      if (!menu.hidden && menu.dataset.from === id) { closeMenu(); return; }
      showMenu(b.left, b.bottom + 4, items());
      menu.dataset.from = id;
    };
  };
  dropDown("display-menu", displayMenu);

  const convert = MimickConvert.create({
    call, status, voiceKept, speeds: SPEEDS,
    ready: () => !!doc?.sentences,
    title: () => doc.title,
    pageCount: () => doc.pages.length,
    selection: () => selection,
    generation: () => generation,
    voice: () => voice.voice,
    rate: () => voice.rate,
    cleanText: () => switchOn("clean_text"),
  });
  dropDown("file-menu", () => [
    { label: "Open…", keys: "Ctrl+O", run: chooseFile },
    { label: "Find in document…", keys: "Ctrl+F", enabled: !!doc, run: () => find.open() },
    "-",
    { label: convert.running ? "Converting to MP3…" : "Convert to MP3…", enabled: !!doc?.sentences && !convert.running,
      run: convert.open },
  ]);
  // --- working offline, and updates ------------------------------------------------
  // js/offline.js and sw.js. The status line says once when everything is kept;
  // About says where it stands. A new version waiting is taken straight away if
  // nothing is open yet, and otherwise offered under Help.

  let wasReady = null, offeredUpdate = false;
  MimickOffline.onChange((state) => {
    const about = $("about-offline");
    if (!state.supported) about.textContent = "This browser cannot keep Mimick for offline use.";
    else if (state.ready) about.textContent = "Ready: everything Mimick needs is kept in this browser, so it opens and reads with no internet connection. Each voice downloads once, the first time it reads.";
    else if (state.error) about.textContent = `Not yet: ${state.error}. It tries again next time the page opens.`;
    else if (state.total) about.textContent = `Getting ready to work offline: ${state.done} of ${state.total} files kept.`;
    if (wasReady === false && state.ready && voice.state === "stopped") status("Ready to work offline — everything Mimick needs is kept in this browser");
    if (state.ready || state.total || state.error) wasReady = state.ready;
    if (state.updateReady && !offeredUpdate) {
      offeredUpdate = true;
      if (!doc && performance.now() < 15000) { status("Updating Mimick…"); MimickOffline.update(); }
      else if (voice.state === "stopped") status("A new version of Mimick is ready — Help ▾ → Update Mimick");
    }
  });

  // Opened from the computer's own file manager, once installed as an app.
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async ({ files }) => {
      if (files?.length) openFile(await files[0].getFile());
    });
  }

  dropDown("help-menu", () => [
    { label: "Keyboard shortcuts", keys: "?", run: () => $("keys-dialog").showModal() },
    { label: "About Mimick", run: () => $("about-dialog").showModal() },
    ...(MimickOffline.state.updateReady ? [{ label: "Update Mimick (reloads the page)", run: () => MimickOffline.update() }] : []),
    // The AGPL asks that a program served over a network offer its source.
    { label: "Source code", run: () => window.open("https://github.com/kathollander/mimick-web", "_blank", "noopener") },
  ]);
  for (const id of ["keys-dialog", "about-dialog"]) $(id).addEventListener("close", () => view.focus());

  // --- highlights and notes -----------------------------------------------------
  // js/notes.js; this is what it needs of the reader.

  const notes = MimickNotes.create({
    call, status, view, remember, recall, showMenu, copyText, placeBox,
    generation: () => generation,
    zoom: () => zoom,
    currentPage: () => (doc ? currentPage() : 0),
    redraw: () => doc && redrawMarks(),
    relayout: () => update(),
    focusPage: () => view.focus(),
    selection: () => selection,
    clearSelection: () => { anchor = null; setSelection(null); },
    readRange,
    canRead: () => !!doc?.sentences,
    copy: () => copySelection(),
    scrollToPoint(page, y) {
      view.scrollTop = Math.max(0, geometry.offsets[page] + y * zoom - view.clientHeight / 3);
      update();
    },
    /* A rectangle of a page, in the window's coordinates. */
    pageRectToClient(page, [x0, y0, x1, y1]) {
      if (!doc || page >= geometry.offsets.length) return null;
      const box = view.getBoundingClientRect();
      const left = box.left + geometry.lefts[page] - view.scrollLeft, top = box.top + geometry.offsets[page] - view.scrollTop;
      return { left: left + x0 * zoom, right: left + x1 * zoom, top: top + y0 * zoom, bottom: top + y1 * zoom };
    },
  });

  // --- finding text -------------------------------------------------------------
  // js/find.js; this is what it needs of the reader.

  const find = MimickFind.create({
    call, status, placeBox,
    ready: () => !!doc?.words,
    hasDocument: () => !!doc,
    generation: () => generation,
    currentPage: () => (doc ? currentPage() : 0),
    redraw: () => doc && redrawMarks(),
    redrawPage: (page) => drawHighlight(page),
    focusPage: () => view.focus(),
    selectionText: () => (selection && selectionText?.for === selection ? selectionText.text : null),
    select(first, last) {
      anchor = null;
      setSelection(first, last);
      placeCaret(last + 1, true);
    },
    /* Bring a rectangle of a page into the middle of the view, or the page's top. */
    scrollToRect(page, rect) {
      if (!doc || page >= geometry.offsets.length) return;
      if (!rect) { goToPage(page); return; }
      const [x0, y0, x1, y1] = rect;
      const top = geometry.offsets[page] + y0 * zoom, bottom = geometry.offsets[page] + y1 * zoom;
      if (top < view.scrollTop + 40 || bottom > view.scrollTop + view.clientHeight - 40) {
        view.scrollTop = Math.max(0, (top + bottom) / 2 - view.clientHeight / 3);
      }
      const left = geometry.lefts[page] + x0 * zoom, right = geometry.lefts[page] + x1 * zoom;
      if (left < view.scrollLeft || right > view.scrollLeft + view.clientWidth) {
        view.scrollLeft = Math.max(0, (left + right) / 2 - view.clientWidth / 2);
      }
      update();
    },
  });

  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
                || e.target instanceof HTMLTextAreaElement;
    if (notes.opening) { e.preventDefault(); return; }
    if (notes.editing || document.querySelector("dialog[open]")) return;
    if (!menu.hidden) {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); view.focus(); }
      return;
    }
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") { e.preventDefault(); chooseFile(); return; }
    if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom(zoom * L.ZOOM_STEP); return; }
    if (ctrl && e.key === "-") { e.preventDefault(); setZoom(zoom / L.ZOOM_STEP); return; }
    if (ctrl && e.key === "0") { e.preventDefault(); setZoom(L.ZOOM_DEFAULT); return; }
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") { e.preventDefault(); find.open(); return; }
    if (e.key === "F3" || (ctrl && !e.altKey && e.key.toLowerCase() === "g")) { e.preventDefault(); find.step(e.shiftKey ? -1 : 1); return; }
    if (typing || !doc) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // A focused button acts on Space and Enter itself.
    const onButton = e.target instanceof HTMLButtonElement;
    if (key === " " && !ctrl && !onButton) {
      e.preventDefault();
      if (!$("play").disabled) togglePlay();
      return;
    }
    if (key === "Enter" && !ctrl && !onButton) {
      e.preventDefault();
      if (selection) readSelection();
      else if (!$("play").disabled) togglePlay();
      return;
    }
    if (key === "Escape" && find.isOpen) { find.close(false); return; }
    if (key === "Escape") { anchor = null; setSelection(null); return; }
    if (key === "?" && !ctrl) { e.preventDefault(); $("keys-dialog").showModal(); return; }
    if (ctrl && !e.shiftKey && key === "a") { e.preventDefault(); selectPage(); return; }
    if (ctrl && !e.shiftKey && !e.altKey && key === "r") { e.preventDefault(); order.toggle(); return; }
    if (ctrl && !e.shiftKey && key === "c") { e.preventDefault(); copySelection(); return; }
    const notesKey = {
      h: e.shiftKey ? notes.toggleBar : () => notes.highlight(false),
      m: e.shiftKey ? null : () => notes.highlight(true),
      j: e.shiftKey ? null : () => notes.step(1),
      k: e.shiftKey ? null : () => notes.step(-1),
      z: e.shiftKey ? notes.redo : notes.undo,
      b: e.shiftKey ? null : notes.togglePanel,
      s: notes.download,
    }[key];
    if (ctrl && !e.altKey && notesKey) { e.preventDefault(); notesKey(); return; }

    // The arrows move the cursor unless the voice is reading, when they keep
    // their old jobs: left and right skip a sentence, the rest scroll.
    const across = { ArrowLeft: -1, ArrowRight: 1 }[key];
    if (across && doc.words) {
      e.preventDefault();
      if (isReading()) voice.skip(across);
      else moveCaret(ctrl ? "sentence" : "word", across, e.shiftKey);
      return;
    }
    const lines = { ArrowUp: ["line", -1], ArrowDown: ["line", 1], Home: ["line end", -1], End: ["line end", 1] }[key];
    if (lines && !ctrl && doc.words && !isReading()) {
      e.preventDefault();
      moveCaret(...lines, e.shiftKey);
      return;
    }
    const go = {
      PageDown: () => goToPage(currentPage() + 1),
      PageUp: () => goToPage(currentPage() - 1),
      ...(ctrl ? { ArrowDown: () => goToPage(currentPage() + 1), ArrowUp: () => goToPage(currentPage() - 1),
                   Home: () => goToPage(0), End: () => goToPage(doc.pages.length - 1) } : {}),
    }[key];
    if (go) { e.preventDefault(); go(); }
  });

  showZoom();
})();
