/* The reader page: open a PDF, show its pages, scroll and zoom.
 *
 * Step 4b. Pages are drawn by the document worker and only while they are on
 * screen or next to it (js/page-layout.js); everything else is an empty white
 * rectangle of the right size, so the scrollbar is honest from the start.
 * Reading aloud comes in 4c.
 */
(function () {
  "use strict";

  const L = MimickLayout;
  const $ = (id) => document.getElementById(id);
  const view = $("view"), pagesEl = $("pages");

  // --- the worker -------------------------------------------------------------

  const worker = new Worker("js/document-worker.js");
  const pending = new Map();
  let nextId = 0, pythonReady = false;

  function ask(message, transfer = []) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  worker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      pythonReady = true;
      if (!doc) status(`Ready in ${(data.loadMs / 1000).toFixed(1)}s. Open a PDF to begin.`);
      return;
    }
    const waiting = pending.get(data.id);
    if (data.type === "error" && !waiting) { status("Something went wrong: " + data.message); return; }
    if (!waiting) return;
    pending.delete(data.id);
    if (data.type === "error") waiting.reject(new Error(data.message));
    else waiting.resolve(data);
  };
  worker.onerror = (e) => status("The reader could not start: " + (e.message || "the worker failed"));

  // --- state --------------------------------------------------------------------

  let doc = null;              // { title, pages, sentences, words, generation }
  let zoom = L.ZOOM_DEFAULT;
  let geometry = L.layout([], zoom);
  let generation = 0;          // bumped on every open, so late renders are dropped
  const slots = new Map();     // page -> { el, canvas, drawnScale }
  const bitmaps = new Map();   // page -> { bitmap, scale }
  let rendering = null;        // { page, scale } while the worker draws one

  const status = (text) => { $("status").textContent = text; $("status").title = text; };
  const dpr = () => window.devicePixelRatio || 1;

  // --- opening ------------------------------------------------------------------

  async function openBytes(buffer, name) {
    const mine = ++generation;
    status(pythonReady ? `Opening ${name}…` : `Getting ready, then opening ${name}…`);
    $("empty").hidden = true;
    clearPages();
    doc = null;
    try {
      const t0 = performance.now();
      const opened = await ask({ type: "open", bytes: buffer, name }, [buffer]);
      if (mine !== generation) return;
      doc = opened;
      document.title = `${doc.title} — Mimick`;
      $("title").textContent = doc.title;
      $("title").title = doc.title;
      $("total").textContent = `of ${doc.pages.length}`;
      $("page").max = doc.pages.length;
      for (const id of ["prev", "next", "page"]) $(id).disabled = false;
      relayout({ page: 0, fraction: 0 });
      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      status(`${doc.pages.length} pages · ${doc.sentences} sentences to read · opened in ${seconds}s`);
      view.focus();
    } catch (err) {
      if (mine !== generation) return;
      status(`Could not open ${name}: ${err.message}`);
      $("empty").hidden = false;
      document.title = "Mimick";
      $("title").textContent = "";
    }
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

  /* One page at a time: whatever is on screen first, nearest the middle first,
   * then the pages either side. A page already drawn at another zoom stays up,
   * stretched, until its sharper copy arrives. */
  function drawNext() {
    if (!doc || rendering) return;
    const top = view.scrollTop, height = view.clientHeight, middle = top + height / 2;
    const shown = geometry.onScreen(top, height);
    const band = geometry.band(top, height);
    const byDistance = (a, b) => Math.abs(geometry.offsets[a] + geometry.sizes[a][1] / 2 - middle)
                               - Math.abs(geometry.offsets[b] + geometry.sizes[b][1] / 2 - middle);
    const order = [...shown.sort(byDistance), ...band.filter((p) => !shown.includes(p))];
    const page = order.find((p) => {
      const have = bitmaps.get(p);
      return !have || Math.abs(have.scale - geometry.renderScale(p, dpr())) > 1e-6;
    });
    if (page === undefined) return;
    const scale = geometry.renderScale(page, dpr());
    const mine = generation;
    rendering = { page, scale };
    ask({ type: "render", page, scale })
      .then(({ bitmap }) => {
        if (mine !== generation || !slots.has(page)) { bitmap.close(); return; }
        bitmaps.get(page)?.bitmap.close();
        bitmaps.set(page, { bitmap, scale });
        paint(page);
      })
      .catch((err) => status(`Page ${page + 1} could not be drawn: ${err.message}`))
      .finally(() => { rendering = null; update(); });
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
