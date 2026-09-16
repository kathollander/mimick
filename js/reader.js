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

  let pythonReady = false, pageWorkersReady = 0;
  const readyNow = () => {
    if (pythonReady && pageWorkersReady && !doc) status("Ready. Open a PDF to begin.");
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
    resetMarks();
    clearPages();
    doc = null;
    setReadable(false);
    const t0 = performance.now();
    const key = await Store.hash(buffer);
    if (mine !== generation) return;
    // Every worker needs its own copy; the document worker takes the original.
    const copies = pool.map(() => buffer.slice(0));
    const sentences = reading.ask({ type: "open", bytes: buffer, name }, [buffer]);
    const opened = pool.map((worker, i) =>
      worker.ask({ type: "open", bytes: copies[i], name }, [copies[i]]).then((info) => {
        if (mine === generation) { worker.openedFor = mine; update(); }
        return info;
      }));
    try {
      const [info, stored] = await Promise.all([Promise.any(opened), Store.open(key)]);
      if (mine !== generation) return;
      doc = { title: info.title, pages: info.pages, key };
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
      Object.assign(doc, { sentences: done.sentences, words: done.words });
      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      openedStatus = `${doc.pages.length} pages · ${done.sentences} sentences to read · opened in ${seconds}s`;
      voice.open(done.sentences);
      setReadable(done.sentences > 0);
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
  $("open").onclick = chooseFile;
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

  const voice = MimickReadAloud.create({
    askDocument: (message) => reading.ask(message),
    onSentence(index, made) {
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
    for (const old of slot.el.querySelectorAll(".hl, .caret")) old.remove();
    const [w, h] = doc.pages[page];
    const add = (kind, [x0, y0, x1, y1], pad = 0) => {
      const box = document.createElement("div");
      box.className = `hl ${kind}`;
      Object.assign(box.style, { left: `${(x0 - pad) / w * 100}%`, top: `${(y0 - pad) / h * 100}%`,
                                 width: `${(x1 - x0 + 2 * pad) / w * 100}%`, height: `${(y1 - y0 + 2 * pad) / h * 100}%` });
      slot.el.append(box);
    };
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

  for (const speed of SPEEDS) $("speed").append(new Option(`${speed}×`, speed));
  const savedRate = Number(recall("mimick-rate"));
  $("speed").value = SPEEDS.includes(savedRate) ? savedRate : 1;
  voice.setRate(Number($("speed").value));
  $("speed").onchange = () => {
    const rate = Number($("speed").value);
    voice.setRate(rate);
    remember("mimick-rate", rate);
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

  async function readSelection() {
    if (!selection || !doc?.sentences) return;
    voice.prepare();
    const [first, last] = selection, mine = generation;
    const count = await call("select_range", first, last);
    if (mine !== generation) return;
    if (!count) { status("That selection has no readable text"); return; }
    voice.open(count, "selection");
    voice.play(0);
  }

  async function copySelection() {
    if (!selection) { status("Select some text first — drag across it, or press Ctrl+A"); return; }
    const chosen = selection;
    const text = selectionText?.for === chosen ? selectionText.text : await call("selection_text", ...chosen);
    try {
      await navigator.clipboard.writeText(text);
      const n = chosen[1] - chosen[0] + 1;
      status(`Copied ${n} word${n === 1 ? "" : "s"}`);
    } catch (err) {
      status("Could not copy: " + err.message);
    }
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
    if (e.button !== 0 || !doc?.words || !e.target.closest?.(".page")) { press = null; return; }
    const at = pointOnPage(e.clientX, e.clientY);
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
        if (clicks === doubleClicks && mine === generation) readFrom(sentence);
      });
    });
  });

  // Double-click selects the sentence, as on the desktop -- and takes back the
  // reading its first click started.
  view.addEventListener("dblclick", (e) => {
    if (!doc?.words) return;
    doubleClicks++;
    const at = pointOnPage(e.clientX, e.clientY);
    if (!at) return;
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
  function closeMenu() { menu.hidden = true; menu.replaceChildren(); }

  function showMenu(x, y, items) {
    menu.replaceChildren();
    for (const item of items) {
      if (item === "-") { menu.append(Object.assign(document.createElement("hr"), {})); continue; }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = item.label;
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
    showMenu(x, y, [
      { label: "Start reading from here", enabled: sentence !== null, run: () => readFrom(sentence) },
      ...(selection ? [{ label: "Read the selection", keys: "Enter", run: readSelection }] : []),
      "-",
      selection ? { label: "Copy", keys: "Ctrl+C", run: copySelection }
                : { label: "Select some text to copy it", enabled: false },
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

  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (!menu.hidden) {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); view.focus(); }
      return;
    }
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") { e.preventDefault(); chooseFile(); return; }
    if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom(zoom * L.ZOOM_STEP); return; }
    if (ctrl && e.key === "-") { e.preventDefault(); setZoom(zoom / L.ZOOM_STEP); return; }
    if (ctrl && e.key === "0") { e.preventDefault(); setZoom(L.ZOOM_DEFAULT); return; }
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
    if (key === "Escape") { anchor = null; setSelection(null); return; }
    if (ctrl && !e.shiftKey && key === "a") { e.preventDefault(); selectPage(); return; }
    if (ctrl && !e.shiftKey && key === "c") { e.preventDefault(); copySelection(); return; }

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
