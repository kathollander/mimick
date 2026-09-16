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
    if (!doc) return;
    const ahead = slow && !storeFull && kept.size < doc.pages.length
      ? ` · drawing pages ahead, ${kept.size} of ${doc.pages.length}` : "";
    status(openedStatus + ahead);
  }

  // --- opening ------------------------------------------------------------------

  async function openBytes(buffer, name) {
    const mine = ++generation;
    status(pythonReady ? `Opening ${name}…` : `Getting ready, then opening ${name}…`);
    $("empty").hidden = true;
    clearPages();
    doc = null;
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
      const canvas = document.createElement("canvas");
      el.append(canvas);
      pagesEl.append(el);
      const slot = { el, canvas, drawnScale: 0 };
      slots.set(page, slot);
      place(page, slot);
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

  // --- keys ---------------------------------------------------------------------
  // The desktop's keys, where a browser lets a page have them. See "Shortcuts"
  // in the desktop repo's docs/FUTURE-FEATURES.md.

  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const typing = e.target instanceof HTMLInputElement;
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") { e.preventDefault(); chooseFile(); return; }
    if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom(zoom * L.ZOOM_STEP); return; }
    if (ctrl && e.key === "-") { e.preventDefault(); setZoom(zoom / L.ZOOM_STEP); return; }
    if (ctrl && e.key === "0") { e.preventDefault(); setZoom(L.ZOOM_DEFAULT); return; }
    if (typing || !doc) return;
    const go = {
      PageDown: () => goToPage(currentPage() + 1),
      PageUp: () => goToPage(currentPage() - 1),
      ...(ctrl ? { ArrowDown: () => goToPage(currentPage() + 1), ArrowUp: () => goToPage(currentPage() - 1),
                   Home: () => goToPage(0), End: () => goToPage(doc.pages.length - 1) } : {}),
    }[e.key];
    if (go) { e.preventDefault(); go(); }
  });

  showZoom();
})();
