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
      step: null,          // how far Python has got: "python", "pdf", "ready", or "failed"
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
      if (data.type === "loading") { self.step = data.step; showLoading(); return; }
      if (data.type === "ready") { self.step = "ready"; onReady(data); showLoading(); return; }
      const waiting = pending.get(data.id);
      if (data.type === "error" && !waiting) {
        if (/^Python did not start/.test(data.message)) { self.step = "failed"; showLoading(); }
        status("Something went wrong: " + data.message);
        return;
      }
      if (!waiting) return;
      pending.delete(data.id);
      if (data.type === "error") waiting.reject(new Error(data.message));
      else waiting.resolve(data);
    };
    // A worker that dies takes its answers with it; say so, rather than leave
    // the page waiting on them for ever.
    worker.onerror = (e) => {
      self.dead = true;
      showLoading();
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
    if (!doc) status("Ready. Open a PDF or a document to begin.");
    // Python is loaded, and kept as it came: now keep the rest for offline use.
    MimickOffline.complete();
    // And the default voice, which ships with the app: always one voice, offline too.
    MimickVoicePicker.keepDefault().then((kept) => { if (kept) fillVoices(); });
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
  const failed = new Map();    // page -> scale it could not be drawn at; tried again twice, a little later
  const retries = new Map();   // page -> times in a row it could not be drawn
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

  // --- the progress bar -----------------------------------------------------------
  // In reader.html from the first paint, so a first visit is never a blank wait:
  // up while Python starts, and again while a document opens, until its
  // sentences are built and the pages first on screen are drawn. Python's start
  // gives no byte counts, so the bar moves by the steps each worker reports,
  // weighted by what they download (the runtime ~11 MB, the PDF library ~18 MB),
  // and creeps towards the next step between them so it never looks stuck.

  const STEP_SHARE = { python: 0.4, pdf: 0.9, ready: 1 };
  let loading = null;          // { name, preparing, drawing } while a document opens
  let barPhase = "", barShown = 0, barTarget = 0, barSince = performance.now(), barTimer = 0;

  function showLoading() {
    const share = (w) => (w.dead ? 0 : STEP_SHARE[w.step] ?? 0);
    const stuck = reading.dead || reading.step === "failed" || pool.every((w) => w.dead || w.step === "failed");
    const starting = !saidReady && !stuck;
    if (loading?.drawing && doc) {
      const shown = geometry.onScreen(view.scrollTop, view.clientHeight);
      if (shown.every((p) => slots.get(p)?.drawnScale > 0 || (retries.get(p) ?? 0) >= 3)) loading.drawing = false;
    }
    if (loading && !loading.preparing && !loading.drawing) loading = null;

    let phase = "", label = "", target = 0, detail = "";
    if (starting) {
      phase = "start";
      label = loading ? `Getting ready, then opening ${loading.name}…` : "Getting Mimick ready…";
      target = (share(reading) + Math.max(...pool.map(share))) / 2;
      if (performance.now() - barSince > 8000) {
        detail = "The first visit downloads about 30 MB, once. After that, Mimick starts faster.";
      }
    } else if (loading) {
      phase = "open:" + generation;
      label = `Opening ${loading.name}…`;
      const shown = doc ? geometry.onScreen(view.scrollTop, view.clientHeight) : [];
      const drawn = shown.filter((p) => slots.get(p)?.drawnScale > 0).length;
      target = (doc ? 0.3 : 0.05) + (loading.drawing ? 0.35 * (shown.length ? drawn / shown.length : 0) : 0.35)
             + (loading.preparing ? 0 : 0.3);
      if (!loading.preparing) label = "Drawing the pages…";
      else if (doc && !loading.drawing) label = "Getting it ready to read aloud…";
      if (performance.now() - barSince > 8000) detail = "A long document takes a little while to prepare, the first time.";
    }
    if (phase !== barPhase) { barPhase = phase; barShown = 0; barSince = performance.now(); }
    const bar = $("loading");
    bar.hidden = !phase;
    if (!phase) { clearInterval(barTimer); barTimer = 0; return; }
    barTarget = target;
    barShown = Math.max(barShown, target);
    $("loading-label").textContent = label;
    $("loading-detail").textContent = detail;
    $("loading-fill").style.width = `${Math.round(Math.max(0.03, barShown) * 100)}%`;
    if (!barTimer) {
      barTimer = setInterval(() => {
        // Creep a little beyond the last step, slower the further it gets.
        const cap = Math.min(0.95, barTarget + 0.2);
        if (barShown < cap) barShown += (cap - barShown) * 0.06;
        showLoading();
      }, 500);
    }
  }

  // --- opening ------------------------------------------------------------------

  /* Open a PDF's bytes. `key` names the document for what is kept about it
   * (notes, place, drawn pages); by default, a hash of the bytes. */
  async function openBytes(buffer, name, key = null) {
    const mine = ++generation;
    ocr.stop();
    status(pythonReady ? `Opening ${name}…` : `Getting ready, then opening ${name}…`);
    loading = { name, preparing: true, drawing: true };
    $("empty").hidden = true;
    voice.open(0);
    closeMenu();
    notes.close();
    find.forget();
    contents.forget();
    order.forget();
    clearTimeout(sleep?.timer);
    sleep = null;
    sentenceStatus = null;
    before = null;
    showReadingTime();
    resetMarks();
    clearPages();
    doc = null;
    setReadable(false);
    const t0 = performance.now();
    key ??= await Store.hash(buffer);
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
      doc = { title: info.title, pages: info.pages, key, name, fileName: openingName ?? name };
      kept = stored;
      slow = kept.size > 0;
      document.title = `${doc.title} — Mimick`;
      $("title").textContent = doc.title;
      $("title").title = doc.title;
      $("total").textContent = `of ${doc.pages.length}`;
      $("page").max = doc.pages.length;
      for (const id of ["prev", "next", "page"]) $(id).disabled = false;
      contents.open(info.outline);
      // Where this document was left, and at what zoom; otherwise its top, at the zoom in use.
      const left = savedView(key);
      if (left) zoom = L.clampZoom(left.zoom);
      relayout(left ? { page: Math.min(left.page, doc.pages.length - 1), fraction: left.fraction } : { page: 0, fraction: 0 });
      openedStatus = `${pagesCount()} · getting the reading ready…`;
      showProgress();
      view.focus();
    } catch (err) {
      if (mine !== generation) return;
      const why = err instanceof AggregateError ? err.errors[0].message : err.message;
      status(`Could not open ${name}: ${why}`);
      loading = null;
      showLoading();
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
      Object.assign(doc, { sentences: done.sentences, words: done.words, hasFootnotes: done.has_footnotes,
                           textless: done.textless ?? [] });
      // A scan whose text was recognised before: put it back, rather than asking again.
      if (doc.textless.length) {
        const found = await MimickOcr.stored(key);
        if (mine !== generation) return;
        const missing = new Set(doc.textless);
        if (found?.some(([page, words]) => missing.has(page) && words.length)) {
          applyRecognised(found.filter(([page]) => missing.has(page)), "Putting back the text recognised in this scan last time…");
          return;
        }
        // Pages already tried and found blank are not offered again.
        const tried = new Set((found ?? []).map(([page]) => page));
        doc.textless = doc.textless.filter((page) => !tried.has(page));
      }
      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      const n = restored?.restored ?? 0;
      openedStatus = `${pagesCount()} · ${done.sentences} sentences to read · opened in ${seconds}s`
        + (n ? ` · ${n} reading-order change${n === 1 ? "" : "s"} of yours put back` : "");
      // Nothing to read says why, rather than leaving Read aloud greyed out in silence.
      const why = done.words === 0
        ? `This PDF has no text to read — it may be a scan.${doc.textless.length ? " Reading ▾ → Recognise text reads the words off its pages" : ""}`
        : done.sentences === 0 ? NOTHING_SET : null;
      if (why) openedStatus = `${pagesCount()} · ${why}`;
      else if (doc.textless.length) {
        const n = doc.textless.length;
        openedStatus += ` · ${n} page${n === 1 ? " is a picture" : "s are pictures"} with no text — Reading ▾ → Recognise text`;
      }
      voice.open(done.sentences);
      setReadable(done.sentences > 0, why);
      notes.open(doc);
      redrawMarks();
      measureReading();
      find.opened();
    } catch (err) {
      if (mine !== generation) return;
      openedStatus = `${pagesCount()} · this one cannot be read aloud: ${err.message}`;
    }
    if (loading) loading.preparing = false;
    showLoading();
    showProgress();
  }

  // --- recognising text in a scan ---------------------------------------------------
  // js/ocr.js reads the words off each page; reader.add_text_layer writes them in,
  // and the result is opened as the same document (same key: its place, pages
  // drawn and notes carry over). What was found is kept for next time.

  const ocr = MimickOcr.create({
    renderPage: (page, scale) => pool[0].ask({ type: "render", page, scale }).then((r) => r.bitmap),
    progress(done, total, msLeft) {
      const left = done < 2 ? "" : ` · ${msLeft < 60000 ? "under a minute" : `about ${Math.round(msLeft / 60000)} minutes`} left`;
      status(`Recognising text: page ${done} of ${total}${left}`);
    },
  });
  async function recogniseText() {
    if (!doc || ocr.running) return;
    const mine = generation, { key, pages, textless } = doc;
    status(`Recognising text: getting ready…`);
    let found;
    try {
      found = await ocr.recognise(pages, textless);
    } catch (err) {
      if (mine === generation) status(err.message === "cancelled" ? "Stopped recognising text" : `Could not recognise the text: ${err.message}`);
      return;
    } finally {
      ocr.close();
    }
    if (mine !== generation) return;
    const count = found.reduce((n, [, words]) => n + words.length, 0);
    if (!count) { status("No words could be recognised in this scan"); return; }
    const before = (await MimickOcr.stored(key)) ?? [];
    await MimickOcr.keep(key, [...before.filter(([page]) => !textless.includes(page)), ...found]);
    applyRecognised(found, `Found ${count.toLocaleString()} words — putting them into the pages…`);
  }
  async function applyRecognised(found, said) {
    const mine = generation, { key, name } = doc;
    status(said);
    let bytes;
    try {
      bytes = await call("add_text_layer", found);
    } catch (err) {
      if (mine === generation) status(`Could not put the recognised text in: ${err.message.trim().split("\n").pop()}`);
      return;
    }
    if (mine !== generation) return;
    openBytes(bytes.slice().buffer, name, key);
  }

  const isText = (file) => /\.txt$/i.test(file.name) || file.type === "text/plain";
  // Laid out as PDFs by reader.document_to_pdf: Word, OpenDocument, EPUB.
  const LAID_OUT = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     odt: "application/vnd.oasis.opendocument.text", epub: "application/epub+zip" };
  const laidOutKind = (file) => Object.keys(LAID_OUT).find((kind) =>
    file.name.toLowerCase().endsWith("." + kind) || file.type === LAID_OUT[kind]) ?? null;

  let openingName = null;     // the file's own name, for Forget to take it out of Open Recent
  async function openFile(file) {
    if (!file) return;
    openingName = file.name;
    if (isText(file)) { openText(file); return; }
    const kind = laidOutKind(file);
    if (kind) { openDocument(file, kind); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      status(`${file.name} is not a file Mimick can open — a PDF, Word (.docx), OpenDocument (.odt), EPUB or .txt file.`);
      return;
    }
    openBytes(await file.arrayBuffer(), file.name);
  }

  /* A Word, OpenDocument or EPUB file, laid out as a PDF by the document worker,
   * then opened as one, known by a hash of the file so its notes come back. */
  async function openDocument(file, kind) {
    const bytes = await file.arrayBuffer();
    const mine = ++generation;
    status(pythonReady ? `Laying out ${file.name}…` : `Getting ready, then opening ${file.name}…`);
    const stem = file.name.replace(/\.[^.]+$/, "");
    let pdf;
    try {
      pdf = await call("document_to_pdf", new Uint8Array(bytes), kind, stem);
    } catch (err) {
      if (mine === generation) status(`Could not open ${file.name}: ${err.message.trim().split("\n").pop()}`);
      return;
    }
    if (mine !== generation) return;
    openBytes(pdf.slice().buffer, stem + ".pdf", `${kind}:` + await Store.hash(bytes));
  }

  /* A text file, laid out as a PDF by the document worker (reader.text_to_pdf),
   * then opened as one. Known by a hash of the text, so its notes come back. */
  async function openText(file) {
    const bytes = await file.arrayBuffer();
    const mine = ++generation;
    status(pythonReady ? `Laying out ${file.name}…` : `Getting ready, then opening ${file.name}…`);
    const text = decodeText(bytes);
    const stem = file.name.replace(/\.txt$/i, "");
    let pdf;
    try {
      pdf = await call("text_to_pdf", text, stem);
    } catch (err) {
      if (mine === generation) status(`Could not open ${file.name}: ${err.message.trim().split("\n").pop()}`);
      return;
    }
    if (mine !== generation) return;
    const copy = pdf.slice().buffer;
    openBytes(copy, stem + ".pdf", "text:" + await Store.hash(bytes));
  }

  /* UTF-8 (with or without its mark), UTF-16 with its mark, or else Windows-1252. */
  function decodeText(bytes) {
    const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("windows-1252").decode(bytes); }
  }

  // Where the browser has its own open window, it gives a handle that Open Recent
  // can keep; elsewhere, the file input.
  const OPEN_TYPES = [{ description: "PDFs and documents", accept: {
    "application/pdf": [".pdf"], "text/plain": [".txt"], "application/epub+zip": [".epub"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "application/vnd.oasis.opendocument.text": [".odt"] } }];
  async function chooseFile() {
    if (!window.showOpenFilePicker || !MimickRecent.supported) { $("file").click(); return; }
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: OPEN_TYPES });
    } catch (err) {
      if (err.name !== "AbortError") $("file").click();
      return;
    }
    await MimickRecent.add(handle);
    openFile(await handle.getFile());
  }
  async function openRecent(id, name) {
    try {
      openFile(await MimickRecent.file(id));
    } catch (err) {
      status(`Could not open ${name}: ${err.message}`);
      if (!/not allowed/.test(err.message)) MimickRecent.remove(id);
    }
  }
  /* The sample the tour runs on: Poe's "The Raven", four pages, which comes
   * with Mimick. A key of its own, so the practice highlights made on it are
   * kept apart from anything of the reader's -- and Forget this document
   * clears them like any other. */
  async function openSample() {
    const response = await fetch("sample/sample.pdf");
    if (!response.ok) throw new Error(`the sample could not be fetched (${response.status})`);
    openingName = null;
    await openBytes(await response.arrayBuffer(), "The Raven (sample)", "sample:raven");
  }

  MimickRecent.load();
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
    // The handle has to be asked for now, while the drop is still being handled.
    const handle = e.dataTransfer.items?.[0]?.getAsFileSystemHandle?.();
    handle?.then((h) => h && h.kind === "file" && MimickRecent.add(h)).catch(() => {});
    openFile(e.dataTransfer.files[0]);
  });

  // --- layout and drawing -------------------------------------------------------

  function clearPages() {
    for (const { bitmap } of bitmaps.values()) bitmap.close();
    bitmaps.clear();
    slots.clear();
    inFlight.clear();
    failed.clear();
    retries.clear();
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
    if (loading?.drawing) showLoading();
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
      if ((retries.get(page) ?? 0) >= 3) el.dataset.failed = "";
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
    keepView();
    const line = top + height / 3, linePage = geometry.pageAt(line);
    contents.pageShown(linePage, (line - geometry.offsets[linePage]) / zoom, top);
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
    retries.delete(page);
    delete slots.get(page).el.dataset.failed;
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
        const tries = same(failed.get(page) ?? -1, scale) || !failed.has(page) ? (retries.get(page) ?? 0) + 1 : 1;
        failed.set(page, scale);
        retries.set(page, tries);
        if (tries < 3) {
          // Often it passes -- memory, while the other workers start up -- so twice more, a little later.
          setTimeout(() => {
            if (mine === generation && same(failed.get(page) ?? -1, scale)) { failed.delete(page); update(); }
          }, 1500 * tries);
          return;
        }
        status(`Page ${page + 1} could not be drawn: ${err.message}`);
        if (slots.has(page)) slots.get(page).el.dataset.failed = "";
        showLoading();
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

  // --- keeping the view, and forgetting a document -------------------------------
  // Each document's scroll and zoom are kept in localStorage, as the page it was on
  // and how far down it, so a reload or a different window size puts it back.
  // Forget this document takes away everything the browser keeps about it.

  let viewTimer = 0;
  function keepView() {
    clearTimeout(viewTimer);
    const key = doc?.key;
    if (!key) return;
    viewTimer = setTimeout(() => {
      if (doc?.key !== key) return;
      const { page, fraction } = geometry.anchor(view.scrollTop);
      remember(`mimick-view:${key}`, JSON.stringify({ page, fraction: Math.round(fraction * 1e4) / 1e4, zoom }));
    }, 400);
  }
  function savedView(key) {
    try {
      const v = JSON.parse(recall(`mimick-view:${key}`));
      return Number.isInteger(v?.page) && v.page >= 0 && Number.isFinite(v.fraction) && Number.isFinite(v.zoom) ? v : null;
    } catch {
      return null;
    }
  }

  /* Back to no document open. */
  function closeDocument() {
    ++generation;
    ocr.stop();
    clearTimeout(viewTimer);
    voice.open(0);
    closeMenu();
    notes.close();
    find.forget();
    contents.forget();
    order.forget();
    clearTimeout(sleep?.timer);
    sleep = null;
    sentenceStatus = null;
    before = null;
    resetMarks();
    clearPages();
    doc = null;
    setReadable(false);
    showReadingTime();
    pagesEl.style.height = pagesEl.style.width = "0px";
    document.title = "Mimick";
    $("title").textContent = $("title").title = "";
    $("total").textContent = "of —";
    for (const id of ["prev", "next", "page"]) $(id).disabled = true;
    $("empty").hidden = false;
  }

  function askForget() {
    if (!doc) return;
    $("forget-title").textContent = doc.title;
    const n = notes.count;
    $("forget-what").textContent = `${n ? `its ${n} highlight${n === 1 ? "" : "s"} and notes, ` : ""}`
      + "where you were reading, its zoom, your reading-order choices and its drawn pages";
    $("forget-save").hidden = n === 0;
    $("forget-dialog").returnValue = "";
    $("forget-dialog").showModal();
    $("forget-cancel").focus();
  }
  $("forget-dialog").addEventListener("close", async () => {
    if ($("forget-dialog").returnValue !== "forget" || !doc) { view.focus(); return; }
    const { key, title, fileName } = doc;
    closeDocument();
    for (const recent of MimickRecent.list()) if (recent.name === fileName) MimickRecent.remove(recent.id);
    for (const kind of ["position", "order", "view"]) {
      try { localStorage.removeItem(`mimick-${kind}:${key}`); } catch { /* not kept */ }
    }
    await Promise.all([MimickNotesStore.remove(key), Store.forget(key), MimickOcr.forget(key)]);
    status(`Forgot ${title} — nothing about it is kept in this browser now. The file itself is untouched.`);
  });

  // --- pages --------------------------------------------------------------------

  // Counted, like readFrom: turning the page on purpose is not the same as the
  // reading scrolling on to the next one, and the tour has to tell them apart.
  let pageTurns = 0;
  function goToPage(page) {
    if (!doc) return;
    page = Math.min(doc.pages.length - 1, Math.max(0, page));
    view.scrollTop = geometry.topFor({ page, fraction: 0 }) - L.PAGE_MARGIN;
    $("page").value = page + 1;
    pageTurns++;
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

  let sentenceStatus = null;      // what the status line says of the sentence being read
  const voice = MimickReadAloud.create({
    askDocument: (message) => reading.ask(message),
    voice: Voices.byKey[savedVoice] ? savedVoice : Voices.DEFAULT,
    pronunciations: () => MimickPronounce.list(),
    voiceName: voiceLabel,
    onSentence(index, made) {
      showReadingTime();
      lit = { sentence: index, made, position: null };
      if (made) {
        const [page, box] = made.lines[0];
        sentenceStatus = voice.source === "document" ? `Sentence ${index + 1} of ${doc.sentences} · page ${page + 1}`
          : `Reading your selection · sentence ${index + 1} of ${voice.count}`;
        if (voice.source === "document") remember(`mimick-position:${doc.key}`, index);
        if (!(voice.source === "document" && sleepDue(page, box[1]))) status(sentenceStatus);
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
      if (state === "paused" && !sleepStopped) status("Paused — the arrow keys move the cursor, Shift selects");
      if (state === "playing" && sentenceStatus) status(sentenceStatus);
      sleepStopped = false;
      if (state === "loading") status("Getting the voice ready…");
      if (state === "stopped") showProgress();
      showReadingTime();
      mediaState(state);
    },
    onStatus: status,
  });

  /* The sentences are built -- perhaps none of them, which is not the same as
   * not yet: the reading order and the switches can still change that. */
  const built = () => doc?.sentences != null;
  const pagesCount = () => `${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}`;
  const NOTHING_SET = "Nothing here is set to be read — Reading ▾ → Show reading order to choose what is";

  function setReadable(on, why = null) {
    $("play").disabled = !on;
    $("play").title = on ? "Start or pause reading  (Space)" : why ?? "Reading aloud is ready once the sentences are";
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

  // Counted, not just done: the tour's "click a sentence" step can only tell a
  // click from the reading simply moving on if it is told (js/tour.js).
  let readFromCount = 0;
  function readFrom(sentence) {
    if (sentence === null || !doc?.sentences) return;
    voice.prepare();
    useDocument();
    voice.play(sentence);
    readFromCount++;
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

  const BACK_SECONDS = 10;

  /* Reading ▾ → Read from the top of this page: the page most of the view shows. */
  function readThisPage() {
    if (!doc?.sentences) return;
    voice.prepare();     // inside the click, which is what lets it make sound
    const mine = generation, page = currentPage();
    reading.ask({ type: "firstSentenceOn", page }).then(({ sentence }) => {
      if (mine !== generation) return;
      if (sentence == null) { status(`Nothing to read from page ${page + 1} on`); return; }
      readFrom(sentence);
    });
  }

  /* Reading ▾ → Go to where the voice is: the word being said, a third of the way down. */
  function goToVoice() {
    if (!lit.made) return;
    const [, page, rect] = lit.made.words[lit.position ?? 0];
    const top = geometry.offsets[page] + rect[1] * zoom, bottom = geometry.offsets[page] + rect[3] * zoom;
    view.scrollTop = Math.max(0, (top + bottom) / 2 - view.clientHeight / 3);
    update();
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
  // The box lists the voices kept in this browser, the default (it ships with
  // the app, and is kept once Python is up), and the one chosen, then
  // "Select a new voice…", which opens the picker (js/voice-picker.js): the only
  // place a voice is heard and downloaded, so voices are chosen, not tried.

  const PICK = "select-a-new-voice";
  async function fillVoices() {
    const kept = new Set(await Voices.keptKeys());
    const box = $("voice");
    box.replaceChildren();
    for (const v of Voices.LIST) {
      if (!kept.has(v.key) && !v.bundled && v.key !== voice.voice) continue;
      box.append(new Option(`${v.name} (${v.accent}) — ${v.note}`, v.key));
    }
    box.append(new Option("Select a new voice…", PICK));
    box.value = voice.voice;
    describeVoice();
  }
  const describeVoice = () => { const v = Voices.byKey[voice.voice]; $("voice").title = `${v.name}: ${v.note}`; };

  const voicePicker = MimickVoicePicker.create({
    current: () => voice.voice,
    pauseReading: () => { if (isReading()) voice.pause(); },
    status,
    async changed({ added }) {
      if (added.length) chooseVoice(added[0]);
      await fillVoices();
    },
  });

  function chooseVoice(key) {
    voice.setVoice(key);
    remember("mimick-voice", key);
    $("voice").value = key;
    describeVoice();
    if (!isReading()) status(`${voiceLabel(key)} — ${Voices.byKey[key].note}. Ready to read.`);
  }

  $("voice").onchange = () => {
    const key = $("voice").value;
    if (key === PICK) {
      $("voice").value = voice.voice;
      voicePicker.open();
      return;
    }
    chooseVoice(key);
    view.focus();
  };
  fillVoices();

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
        ...(selectionText?.for === selection && !/\s/.test(selectionText.text.trim()) && selectionText.text.trim()
          ? [{ label: `How to say “${selectionText.text.trim()}”…`, run: () => openSay(selectionText.text.trim()) }] : []),
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

  // --- what gets read: Reading ▾'s switches ------------------------------
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
    if (name === "click_read" || !built()) { if (said) status(said); return; }
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
    openedStatus = `${pagesCount()} · ${result.sentences ? `${result.sentences} sentences to read` : NOTHING_SET}`;
    setReadable(result.sentences > 0, result.sentences ? null : NOTHING_SET);
    status(say(result));
    if (wasReading && result.sentences) voice.play(result.resume);
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
      if (!shown || !built()) return;
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
      else if (!built()) status(doc ? "The reading order shows once the document is ready" : "Open a PDF to see its reading order");
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
      if (!built() || busy) return;
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
      get shown() { return shown && built(); },
      get changed() { return !!doc && Object.keys(saved()).length > 0; },
    };
  })();

  // Night (dark) unless Day or the system's choice is picked here. reader.html
  // puts a kept choice on <html> before the page draws.
  const currentTheme = () => { const t = recall("mimick-theme"); return t === "light" || t === "system" ? t : "dark"; };
  /* Whether the page is dark right now, whichever way it was chosen. */
  const isNight = () => currentTheme() === "dark" || (currentTheme() === "system" && !matchMedia("(prefers-color-scheme: light)").matches);
  function setTheme(theme) {
    remember("mimick-theme", theme);
    if (theme === "dark") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    showTheme();
    showSwitches();
    status({ system: "Following the system's light or dark setting", dark: "Night", light: "Day" }[theme]);
  }
  function showTheme() {
    const panel = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", panel || "#191d24");
  }
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { showTheme(); showSwitches(); });
  showTheme();

  // --- the sleep timer ------------------------------------------------------------
  // Reading ▾ → Stop reading: after some minutes, or at the end of this page or
  // section. It stops between sentences, never in the middle of one, by pausing
  // as the next begins -- so Space carries on from there.

  let sleep = null;              // { kind, label, due?, page?, section?, timer? }
  let sleepStopped = false;      // the pause just made is the timer's, and says so itself
  function setSleep(kind, minutes = 0) {
    clearTimeout(sleep?.timer);
    sleep = null;
    if (kind === "off") { status("Sleep timer off"); return; }
    const here = lit.made ? { page: lit.made.lines[0][0], y: lit.made.lines[0][1][1] }
      : { page: currentPage(), y: 0 };
    if (kind === "minutes") {
      sleep = { kind, label: `In ${minutes} minutes`, due: false };
      sleep.timer = setTimeout(() => { if (sleep?.kind === "minutes") sleep.due = true; }, minutes * 60000);
      status(`Reading stops in ${minutes} minutes, at the end of a sentence`);
    } else if (kind === "page") {
      sleep = { kind, label: "At the end of this page", page: here.page };
      status(`Reading stops at the end of page ${here.page + 1}`);
    } else if (kind === "section") {
      const section = contents.sectionAt(here.page, here.y);
      sleep = { kind, label: "At the end of this section", section };
      status(`Reading stops at the end of ${section ? `“${section}”` : "this section"}`);
    }
  }
  /* A sentence is starting at this place: whether the timer stops reading here. */
  function sleepDue(page, y) {
    if (!sleep) return false;
    const due = sleep.kind === "minutes" ? sleep.due
      : sleep.kind === "page" ? page > sleep.page
      : contents.sectionAt(page, y) !== sleep.section;
    if (!due) return false;
    const said = { minutes: "the time you set", page: "the end of the page", section: "the end of the section" }[sleep.kind];
    sleep = null;
    sleepStopped = true;
    showSwitches();
    voice.pause();
    status(`Sleep timer: stopped at ${said} — Space carries on`);
    return true;
  }
  const sleepMenu = () => {
    const on = sleep?.label ?? "Off";
    return [
      { label: "Stop reading", enabled: false },
      ...[["Off", () => setSleep("off")], ["In 15 minutes", () => setSleep("minutes", 15)], ["In 30 minutes", () => setSleep("minutes", 30)],
          ["In 60 minutes", () => setSleep("minutes", 60)], ["At the end of this page", () => setSleep("page")]]
        .map(([label, run]) => ({ label, run, indent: true, checked: on === label, enabled: label === "Off" || !!doc })),
      { label: "At the end of this section", indent: true, checked: on === "At the end of this section",
        enabled: !!doc && contents.entries.length > 0, run: () => setSleep("section") },
    ];
  };

  // --- pronunciations -------------------------------------------------------------
  // js/pronounce.js. A word as printed and how to say it, for every document and
  // voice; right-click a selected word to start with it.

  const sayDialog = $("say-dialog");
  function showSayList() {
    const rows = MimickPronounce.list().map(([word, as]) => {
      const row = document.createElement("div");
      row.className = "say-row";
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "square", textContent: "✕",
        title: `Say ${word} as the voice would`, ariaLabel: `Remove ${word}` });
      remove.onclick = () => {
        MimickPronounce.save(MimickPronounce.list().filter(([w]) => w !== word));
        voice.remake();
        showSayList();
        $("say-note").textContent = `${word} is said as the voice would again.`;
      };
      row.append(Object.assign(document.createElement("span"), { className: "word", textContent: word }),
                 Object.assign(document.createElement("span"), { className: "dim", textContent: "→" }),
                 Object.assign(document.createElement("span"), { className: "as", textContent: as }), remove);
      return row;
    });
    $("say-list").replaceChildren(...rows);
  }
  function openSay(word = "") {
    showSayList();
    $("say-word").value = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    $("say-as").value = "";
    $("say-note").textContent = "";
    sayDialog.showModal();
    (word ? $("say-as") : $("say-word")).focus();
  }
  function addSay() {
    const word = $("say-word").value.trim(), as = $("say-as").value.trim();
    if (!word || !as) { $("say-note").textContent = "Write the word, and how it sounds."; return; }
    if (/\s/.test(word)) { $("say-note").textContent = "One word at a time — a name of two words is two entries."; return; }
    const list = MimickPronounce.list().filter(([w]) => w.toLowerCase() !== word.toLowerCase());
    MimickPronounce.save([...list, [word, as]]);
    voice.remake();
    showSayList();
    $("say-word").value = $("say-as").value = "";
    $("say-note").textContent = `${word} will be said as “${as}”, from the next sentence the voice makes.`;
    $("say-word").focus();
  }
  $("say-add").onclick = addSay;
  for (const id of ["say-word", "say-as"]) {
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSay(); } });
  }
  sayDialog.addEventListener("close", () => view.focus());

  // Reading ▾: what is read and how, and when it stops. Display ▾: how the page looks.
  // The on/off ones are also in the quick switches strip, below.
  const footnotesHere = () => !doc || !!doc.hasFootnotes;
  const dropDown = (id, items) => {
    $(id).onclick = (e) => {
      const b = e.currentTarget.getBoundingClientRect();
      if (!menu.hidden && menu.dataset.from === id) { closeMenu(); return; }
      showMenu(b.left, b.bottom + 4, items());
      menu.dataset.from = id;
    };
  };
  function readingMenu() {
    const going = voice.state !== "stopped" && voice.source === "document";
    return [
      { label: "Read from the top of this page", enabled: built() && doc.sentences > 0, run: readThisPage },
      { label: "Back 10 seconds", keys: "Shift+←", enabled: voice.state !== "stopped", run: () => voice.back(BACK_SECONDS) },
      { label: "Go to where the voice is", enabled: going && !!lit.made, run: goToVoice },
      "-",
      ocr.running ? { label: "Stop recognising text", run: () => ocr.stop() }
        : { label: "Recognise text in this scan…", enabled: !!doc?.textless?.length, run: recogniseText },
      "-",
      ...sleepMenu(),
      "-",
      { label: "How to say words…", run: () => openSay() },
      "-",
      { label: "Clean up text for reading", checked: switchOn("clean_text"),
        run: () => setSwitch("clean_text", !switchOn("clean_text")) },
      { label: "Skip citations while reading", checked: switchOn("skip_citations"),
        run: () => setSwitch("skip_citations", !switchOn("skip_citations")) },
      // Greyed out where there are none: a live switch that changes nothing reads as broken.
      { label: "Read footnotes", checked: switchOn("read_footnotes"), enabled: footnotesHere(),
        run: () => setSwitch("read_footnotes", !switchOn("read_footnotes")) },
      { label: "Click to read", checked: switchOn("click_read"), run: () => setSwitch("click_read", !switchOn("click_read")) },
      "-",
      { label: "Show reading order", keys: "Ctrl+R", checked: order.on, run: order.toggle },
      { label: "Reset reading order", enabled: built() && order.changed, run: order.reset },
    ];
  }
  dropDown("reading-menu", readingMenu);

  function displayMenu() {
    return [
      { label: "Theme", enabled: false },
      ...[["dark", "Night"], ["light", "Day"], ["system", "Match the system"]].map(([theme, label]) =>
        ({ label, indent: true, checked: currentTheme() === theme, run: () => setTheme(theme) })),
      "-",
      ...contents.displayMenu(),
      ...notes.displayMenu(),
      "-",
      { label: "Zoom in", keys: "Ctrl++", run: () => setZoom(zoom * L.ZOOM_STEP) },
      { label: "Zoom out", keys: "Ctrl+−", run: () => setZoom(zoom / L.ZOOM_STEP) },
      { label: "Reset zoom", keys: "Ctrl+0", run: () => setZoom(L.ZOOM_DEFAULT) },
    ];
  }

  dropDown("display-menu", displayMenu);

  // --- the quick switches ---------------------------------------------------------
  // A strip of small toggles under the top bar, opened and closed by ⌄ at the
  // bar's right end (kept; closed at first). Each mirrors an entry in Reading ▾
  // or Display ▾, so it is redrawn after anything that might change one.

  const switchesEl = $("switches"), switchesToggle = $("switches-toggle");
  const QUICK = ["clean_text", "skip_citations", "read_footnotes", "click_read"];
  function showSwitches() {
    if (!switchesEl || switchesEl.hidden) return;
    const night = isNight(), theme = $("sw-theme");
    theme.querySelector("span").textContent = night ? "Night" : "Day";
    theme.ariaLabel = night ? "Night: switch to day" : "Day: switch to night";
    theme.title = currentTheme() === "system" ? "Following the system; click for " + (night ? "day" : "night")
      : (night ? "Night — click for day" : "Day — click for night");
    theme.querySelector("svg").innerHTML = night
      ? '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>'
      : '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>';
    for (const name of QUICK) $("sw-" + name).setAttribute("aria-pressed", switchOn(name));
    $("sw-read_footnotes").disabled = !footnotesHere();
    $("sw-sleep").setAttribute("aria-pressed", !!sleep);
    $("sw-sleep").querySelector("span").textContent = sleep
      ? { minutes: sleep.label.replace("In ", "").replace(" minutes", " min"), page: "End of page", section: "End of section" }[sleep.kind]
      : "Timer off";
    const cItem = contents.displayMenu()[0], nItem = notes.displayMenu();
    $("sw-contents").setAttribute("aria-pressed", cItem.checked);
    $("sw-contents").disabled = cItem.enabled === false;
    $("sw-notes").setAttribute("aria-pressed", nItem.find((i) => i.label === "Notes panel").checked);
    $("sw-markup").setAttribute("aria-pressed", nItem.find((i) => i.label === "Highlight and note buttons").checked);
  }
  function openSwitches(on) {
    remember("mimick-switches", on ? "1" : "0");
    switchesEl.hidden = !on;
    switchesToggle.setAttribute("aria-expanded", on);
    switchesToggle.title = on ? "Hide the quick switches"
      : "Show the quick switches: night or day, what is read, the timer, the panels";
    showSwitches();
  }
  switchesToggle.onclick = () => openSwitches(switchesEl.hidden);
  $("sw-theme").onclick = () => setTheme(isNight() ? "light" : "dark");
  for (const name of QUICK) $("sw-" + name).onclick = () => setSwitch(name, !switchOn(name));
  $("sw-sleep").onclick = (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    if (!menu.hidden && menu.dataset.from === "sw-sleep") { closeMenu(); return; }
    showMenu(b.left, b.bottom + 4, sleepMenu());
    menu.dataset.from = "sw-sleep";
  };
  $("sw-contents").onclick = () => contents.displayMenu()[0].run();
  $("sw-notes").onclick = () => notes.togglePanel();
  $("sw-markup").onclick = () => notes.toggleBar();
  // Anything clicked or pressed may have changed a switch: redraw once it has run.
  for (const type of ["click", "keydown"]) document.addEventListener(type, () => setTimeout(showSwitches), true);

  const convert = MimickConvert.create({
    call, status, voiceKept: Voices.kept, speeds: SPEEDS,
    ready: () => !!doc?.sentences,
    title: () => doc.title,
    pageCount: () => doc.pages.length,
    selection: () => selection,
    generation: () => generation,
    voice: () => voice.voice,
    rate: () => voice.rate,
    cleanText: () => switchOn("clean_text"),
    pronunciations: () => MimickPronounce.list(),
  });
  const recentItems = () => {
    const files = MimickRecent.list().slice(0, 5);
    if (!files.length) return [];
    return [
      { label: "Open recent", enabled: false },
      ...files.map(({ id, name }) => ({ label: name, indent: true, run: () => openRecent(id, name) })),
      { label: "Clear recent files", indent: true, run: () => { MimickRecent.clear(); status("Recent files cleared"); } },
      "-",
    ];
  };
  dropDown("file-menu", () => [
    { label: "Open…", keys: "Ctrl+O", run: chooseFile },
    ...recentItems(),
    { label: "Find in document…", keys: "Ctrl+F", enabled: !!doc, run: () => find.open() },
    "-",
    // PDF only: highlights and notes are annotations on rectangles of a page, which no
    // flowing format can hold. The notes on their own go out as text. See PARITY.md.
    { label: "Save a copy (PDF)…", keys: "Ctrl+S", enabled: notes.ready, run: notes.download },
    { label: "Export notes…", enabled: notes.ready && notes.count > 0, run: notes.exportNotes },
    "-",
    { label: "Forget this document…", enabled: !!doc, run: askForget },
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
    else if (state.ready) about.textContent = "Ready: everything Mimick needs is kept in this browser, so it opens and reads with no internet connection. Norman comes with Mimick; any other voice downloads once, when you choose it.";
    else if (state.error) about.textContent = `Not yet: ${state.error}. It tries again next time the page opens.`;
    else if (state.total) about.textContent = `Getting ready to work offline: ${state.done} of ${state.total} files kept.`;
    if (wasReady === false && state.ready && voice.state === "stopped") status("Ready to work offline — everything Mimick needs is kept in this browser");
    if (state.ready || state.total || state.error) wasReady = state.ready;
    if (state.updateReady && !offeredUpdate) {
      offeredUpdate = true;
      // Straight away only on a page nobody has used yet: a reload now loses nothing.
      if (!generation && performance.now() < 15000) { status("Updating Mimick…"); MimickOffline.update(); }
      else if (voice.state === "stopped") status("A new version of Mimick is ready — Help ▾ → Update Mimick");
    }
  });

  // Opened from the computer's own file manager, once installed as an app.
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async ({ files }) => {
      if (!files?.length) return;
      MimickRecent.add(files[0]);
      openFile(await files[0].getFile());
    });
  }

  dropDown("help-menu", () => [
    { label: "Take the tour", enabled: !tour.running, run: () => tour.start() },
    { label: "Keyboard shortcuts", keys: "?", run: () => $("keys-dialog").showModal() },
    { label: "About Mimick", run: () => $("about-dialog").showModal() },
    ...(MimickOffline.state.updateReady ? [{ label: "Update Mimick (reloads the page)", run: () => MimickOffline.update() }] : []),
    // The AGPL asks that a program served over a network offer its source.
    { label: "Source code", run: () => window.open("https://github.com/kathollander/mimick", "_blank", "noopener") },
  ]);
  for (const id of ["keys-dialog", "about-dialog"]) $(id).addEventListener("close", () => view.focus());

  // --- highlights and notes -----------------------------------------------------
  // js/notes.js; this is what it needs of the reader.

  const notes = MimickNotes.create({
    call, status, view, remember, recall, showMenu, copyText, placeBox,
    generation: () => generation,
    zoom: () => zoom,
    pagesShown: () => (doc ? geometry.onScreen(view.scrollTop, view.clientHeight) : []),
    redraw: () => doc && redrawMarks(),
    relayout: () => update(),
    focusPage: () => view.focus(),
    selection: () => selection,
    clearSelection: () => { anchor = null; setSelection(null); },
    readRange,
    canRead: () => !!doc?.sentences,
    copy: () => copySelection(),
    sectionAt: (page, y) => contents.sectionAt(page, y),
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

  // --- the table of contents ------------------------------------------------------
  // js/contents.js; this is what it needs of the reader.

  const contents = MimickContents.create({
    status, remember, recall, showMenu,
    relayout: () => update(),
    focusPage: () => view.focus(),
    canRead: () => !!doc?.sentences,
    /* The top of a place on a page, a little below the top of the view. */
    goTo(page, y) {
      if (!doc || page >= geometry.offsets.length) return;
      if (y == null) { goToPage(page); return; }
      view.scrollTop = Math.max(0, geometry.offsets[page] + y * zoom - L.PAGE_MARGIN);
      update();
    },
    scrollTop: () => view.scrollTop,
    readFrom(page, y) {
      voice.prepare();     // inside the click, which is what lets it make sound
      const mine = generation;
      call("first_sentence_from", page, y).then((sentence) => {
        if (mine !== generation) return;
        if (sentence === null) { status("Nothing to read from there"); return; }
        readFrom(sentence);
      }).catch((err) => status("Could not start reading there: " + err.message));
    },
  });

  // --- the tour -------------------------------------------------------------------
  // js/tour.js: the spotlight, the ghost pointer and the card. It only ever
  // looks at the reader -- every step is done with the page's own keys and
  // clicks -- so this is all getters, and the two ways of opening a document.

  const tour = MimickTour.create({
    status, remember, openSample, chooseFile,
    focusPage: () => view.focus(),
    hasDocument: () => !!doc,
    ready: () => !!doc?.sentences,
    statusText: () => $("status").textContent,
    readingState: () => voice.state,
    sentence: () => lit.sentence,
    readFrom: () => readFromCount,
    pageTurns: () => pageTurns,
    speed: () => voice.rate,
    voiceKey: () => voice.voice,
    caret: () => caret.index,
    selection: () => selection,
    notesCount: () => notes.count,
    notesPanelOpen: () => !$("notes").hidden,
    findOpen: () => find.isOpen,
    page: () => (doc ? currentPage() : 0),
    dialogOpen: () => !!document.querySelector("dialog[open]") || notes.editing,
    menuOpen: () => !menu.hidden,
    /* The first sentence that starts on a page, as `[page, rect]` in page
     * points -- what the tour puts its spotlight on. */
    async sentenceBox(page) {
      const found = await reading.ask({ type: "firstSentenceOn", page });
      if (found.sentence === null) return null;
      const { sentences } = await reading.ask({ type: "sentences", start: found.sentence, count: 1 });
      return sentences?.[0]?.lines?.[0] ?? null;
    },
    /* A rectangle of a page, in the window's coordinates, as the notes panel has it. */
    pageRectToClient(page, [x0, y0, x1, y1]) {
      if (!doc || page >= geometry.offsets.length) return null;
      const box = view.getBoundingClientRect();
      const left = box.left + geometry.lefts[page] - view.scrollLeft, top = box.top + geometry.offsets[page] - view.scrollTop;
      return { left: left + x0 * zoom, right: left + x1 * zoom, top: top + y0 * zoom, bottom: top + y1 * zoom };
    },
  });
  $("tour-start").onclick = () => tour.start();

  // --- media keys -------------------------------------------------------------------
  // A keyboard's play/pause, next and previous keys, and the browser's own media
  // controls, through the Media Session API. Chrome only gives a page those while
  // it plays through a media element, and the voice plays through Web Audio, so a
  // second of silence loops in an <audio> while reading. It is never heard, and if
  // the browser will not start it, the keys on the page still work (keydown below).

  let silence = null;
  function silentWav() {
    const rate = 8000, n = rate / 2, bytes = new Uint8Array(44 + n), v = new DataView(bytes.buffer);
    const text = (at, str) => [...str].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
    text(0, "RIFF"); v.setUint32(4, 36 + n, true); text(8, "WAVEfmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    text(36, "data"); v.setUint32(40, n, true); bytes.fill(128, 44);
    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  }

  function mediaState(state) {
    if (!("mediaSession" in navigator)) return;
    const on = isReading(state) || state === "loading";
    if (on || state === "paused") {
      if (!silence) { silence = new Audio(silentWav()); silence.loop = true; }
      if (on) silence.play().catch(() => { /* no media controls, then; the keys still work */ });
      else silence.pause();
      if (doc) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: doc.title, artist: `Mimick · ${voiceLabel(voice.voice)}`,
          artwork: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }],
        });
      }
    } else {
      silence?.pause();
    }
    navigator.mediaSession.playbackState = on ? "playing" : state === "paused" ? "paused" : "none";
  }

  const mediaKeys = {
    play: () => { if (voice.state !== "playing" && voice.state !== "buffering") togglePlay(); },
    pause: () => voice.pause(),
    playpause: () => togglePlay(),
    previoustrack: () => voice.skip(-1),
    seekbackward: () => voice.back(BACK_SECONDS),
    nexttrack: () => voice.skip(1),
    stop: () => voice.stop(),
  };
  // One press can arrive twice -- as the media session's action and as a keydown
  // on the focused page -- which would pause and resume at once. The second is dropped.
  let lastMedia = { action: null, at: 0 };
  function media(action) {
    const now = performance.now();
    const kind = (a) => (/play|pause/.test(a ?? "") ? "toggle" : a);
    const same = kind(action) === kind(lastMedia.action);
    if (same && now - lastMedia.at < 400) return;
    lastMedia = { action, at: now };
    mediaKeys[action]();
  }
  if ("mediaSession" in navigator) {
    for (const action of ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "stop"]) {
      try { navigator.mediaSession.setActionHandler(action, () => media(action)); } catch { /* not offered here */ }
    }
  }

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
    if (e.key === "F9" && !ctrl && !e.altKey) { e.preventDefault(); contents.toggle(); return; }
    const mediaKey = { MediaPlayPause: "playpause", MediaPlay: "play", MediaPause: "pause", MediaTrackNext: "nexttrack",
                    MediaTrackPrevious: "previoustrack", MediaStop: "stop" }[e.key];
    if (mediaKey && doc) { e.preventDefault(); media(mediaKey); return; }
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
      y: e.shiftKey ? null : notes.redo,
      b: e.shiftKey ? null : notes.togglePanel,
      s: notes.download,
    }[key];
    if (ctrl && !e.altKey && notesKey) { e.preventDefault(); notesKey(); return; }

    // The arrows move the cursor unless the voice is reading, when they keep
    // their old jobs: left and right skip a sentence, the rest scroll.
    const across = { ArrowLeft: -1, ArrowRight: 1 }[key];
    if (across && doc.words) {
      e.preventDefault();
      if (isReading() && e.shiftKey && across < 0) voice.back(BACK_SECONDS);
      else if (isReading()) voice.skip(across);
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
  showLoading();
  openSwitches(recall("mimick-switches") === "1");
})();
