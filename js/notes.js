/* Highlights and notes: on the page, in the panel beside it, and kept.
 *
 * The desktop's page_view (highlights, note cards, the remove badge),
 * main_window (highlighting, undo, copying, stepping between notes), note_dialog
 * and markup_bar, for the browser. The highlights themselves are the desktop's
 * AnnotationStore, in the document worker; every change comes back from it as
 * the whole list, so this never keeps a copy of its own that could drift.
 *
 * Kept in the browser by js/notes-store.js, a moment after each change, and
 * downloaded as a PDF with real annotations in it.
 *
 *   const notes = MimickNotes.create(ctx)     ctx: see reader.js, "notes"
 *   notes.open(doc) / notes.close()
 *   notes.draw(page, el)       highlights and the remove badge, onto a page
 *   notes.at(page, x, y)       the highlight under a point, or null
 *   notes.pick(item)           pick one out, or null
 *   notes.highlight(withNote) / edit(item) / remove(item) / step(±1)
 *   notes.undo() / redo() / copy(item, part) / download() / exportNotes() / exportAs(kind)
 *   notes.menuItems(item)      what a right-click on it offers
 *   notes.pageShown(page)      the page being read changed, or moved
 */
(function (root) {
  "use strict";

  // The desktop's annotations.COLOURS.
  const COLOURS = [
    ["Yellow", [1.00, 0.87, 0.35]],
    ["Green", [0.62, 0.90, 0.60]],
    ["Blue", [0.55, 0.80, 1.00]],
    ["Pink", [1.00, 0.65, 0.80]],
  ];
  const UNDO_DEPTH = 50;
  const SAVE_AFTER_MS = 700;
  // How long highlights and notes can go without being saved to a file before
  // Mimick says so (Kat, 23 September). They are kept in the browser as they
  // are made, but a browser's storage can be cleared; a file cannot.
  const REMIND_MINUTES = 15;
  const SNAP_MARGIN = 56;        // how near an edge a dropped strip counts as aimed at it
  const REMOVE_SIZE = 18;        // the little x, in pixels
  const HOMES = { panel: "In the notes panel", top: "Across the top", bottom: "Across the bottom",
                  float: "Loose over the page" };

  const css = ([r, g, b], alpha = 1) =>
    `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
  const sameColour = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.02);
  const flat = (text) => (text || "").split(/\s+/).filter(Boolean).join(" ");
  const preview = (item) => { const t = flat(item.text); return t.length <= 90 ? t : t.slice(0, 87) + "…"; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  /* Save what `make` answers (bytes) as a file called `name`. With
   * showSaveFilePicker, the save window comes first, so call this straight
   * from the key press or click; closed, it answers null. Without it, the file
   * is handed to `offer` once made (reader.js: it downloads, and waits in the
   * bottom bar in case the browser blocked that). Answers { name, picked }. */
  async function saveFile(offer, name, type, description, extension, make) {
    let handle = null;
    if (root.showSaveFilePicker) {
      try {
        handle = await root.showSaveFilePicker({ suggestedName: name, types: [{ description, accept: { [type]: [extension] } }] });
      } catch (err) {
        if (err.name === "AbortError") return null;
        handle = null;                                   // anything else: download it instead
      }
    }
    const bytes = await make();
    if (handle) {
      const writable = await handle.createWritable();
      try {
        await writable.write(new Blob([bytes], { type }));
        await writable.close();
      } catch (err) {
        await writable.abort().catch(() => {});
        throw err;
      }
      return { name: handle.name, picked: true };
    }
    offer(name, new Blob([bytes], { type }));
    return { name, picked: false };
  }

  function create(ctx) {
    const $ = (id) => document.getElementById(id);
    let items = [];              // reader.annotations(), in document order
    let active = null;           // the xref picked out
    let doc = null;
    let ready = false;           // the document worker has the highlights
    let colour = COLOURS[0][1];
    let undoStack = [], redoStack = [];
    let work = Promise.resolve();
    // While the note editor is open, what its card and highlight show instead.
    let drafting = null;         // { xref, note, title, colour }

    const settings = {
      get panel() { return ctx.recall("mimick-notes-panel") !== "0"; },
      get quotes() { return ctx.recall("mimick-panel-quotes") !== "0"; },
      get written() { return ctx.recall("mimick-panel-notes") !== "0"; },
      get bar() { return ctx.recall("mimick-markup-shown") !== "0"; },
      get home() { const h = ctx.recall("mimick-markup-home"); return h in HOMES ? h : "panel"; },
      get font() { return ctx.recall("mimick-note-font") || ""; },
      get size() { const s = Number(ctx.recall("mimick-note-size")); return s >= 6 && s <= 24 ? s : 9; },
      get author() { return ctx.recall("mimick-author") || ""; },
      get all() { return ctx.recall("mimick-panel-all") === "1"; },
    };

    // --- the reader's own order, for All notes and Export notes ------------------
    // Kat asked to put notes in an order of her own by dragging (23 September).
    // Kept per document, by a key that survives reopening -- the words a
    // highlight covers, or for one made elsewhere, where it sits -- since an
    // xref can change when the notes are put back from the browser's store.
    const orderKey = (item) => (item.first >= 0 ? `w${item.first}-${item.last}` : `p${item.page}@${Math.round(item.top)}`);
    function savedOrder() {
      try { return JSON.parse(ctx.recall(`mimick-notes-order:${doc?.key}`) || "null"); } catch { return null; }
    }
    /* Every item, in the reader's order where there is one. A highlight made
     * since keeps its place in the document relative to the ones around it. */
    function ordered() {
      const order = savedOrder();
      if (!Array.isArray(order) || !order.length) return items.slice();
      const rank = new Map(order.map((k, i) => [k, i]));
      let last = -1, gap = 0;
      const ranked = items.map((item) => {
        const r = rank.get(orderKey(item));
        if (r !== undefined) { last = r; gap = 0; return [item, r]; }
        gap += 1e-3;
        return [item, last + gap];
      });
      return ranked.sort((a, b) => a[1] - b[1]).map(([item]) => item);
    }
    const customOrder = () => Array.isArray(savedOrder()) && savedOrder().length > 0;
    function setOrder(list) {
      if (!doc) return;
      ctx.remember(`mimick-notes-order:${doc.key}`, list ? JSON.stringify(list.map(orderKey)) : "");
      refreshAll();
    }

    const shown = (item) => (drafting && drafting.xref === item.xref ? { ...item, ...drafting } : item);
    const find = (xref) => items.find((item) => item.xref === xref) ?? null;
    const activeItem = () => (active === null ? null : find(active));

    // --- talking to the document worker -------------------------------------

    /* Changes run one after another, in the order asked for. */
    function change(fn) {
      const mine = ctx.generation();
      const next = work.then(async () => {
        if (mine !== ctx.generation() || !ready) return undefined;
        const result = await fn();
        if (mine === ctx.generation()) { refreshAll(); scheduleSave(); unsaved(); }
        return result;
      });
      work = next.catch((err) => ctx.status("That did not work: " + err.message));
      return next;
    }

    async function add(first, last, { colour: c, note = "", title = "" }) {
      const { xref, annotations } = await ctx.call("annotation_add", first, last, c, note, title, settings.author);
      items = annotations;
      return xref === null ? null : find(xref);
    }
    async function set(xref, note, title, c) { items = await ctx.call("annotation_set", xref, note, title, c); }
    async function drop(xref) {
      items = await ctx.call("annotation_remove", xref);
      if (active === xref) active = null;
    }

    // --- keeping them ---------------------------------------------------------

    let saveTimer = 0, keptAt = null, keepFailed = false;

    // --- the reminder to save to a file -------------------------------------------
    // From the first change after the last Save a copy or Export notes: every
    // fifteen minutes while it stays unsaved, a line in the status bar and a
    // button that saves. Notes ▾ → Remind me to save turns it off.
    let changedAt = null, remindedAt = null;
    const remindOn = () => ctx.recall("mimick-save-reminder") !== "0";
    // A check can make the wait shorter; nothing a reader sees sets this.
    const remindMs = () => (Number(ctx.recall("mimick-save-reminder-minutes")) || REMIND_MINUTES) * 60000;
    function unsaved() { changedAt ??= Date.now(); }
    function savedToFile() { changedAt = remindedAt = null; ctx.unask("save"); }
    function remindIfDue() {
      if (!doc || !ready || changedAt === null || !remindOn()) return;
      const now = Date.now(), wait = remindMs();
      if (now - changedAt < wait || (remindedAt !== null && now - remindedAt < wait)) return;
      remindedAt = now;
      const minutes = Math.max(1, Math.round((now - changedAt) / 60000));
      ctx.status(`Your newest highlights and notes have gone ${minutes === 1 ? "a minute" : minutes + " minutes"} without being saved `
                 + "to a file. They are kept in this browser, but a file is safer.");
      ctx.ask("save", "Save a copy now", "Save the PDF with your highlights and notes in it (Ctrl+S). "
              + "Notes ▾ → Remind me to save turns these reminders off.", download);
    }
    setInterval(remindIfDue, 5000);
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_AFTER_MS);
      showKept("Keeping…");
    }
    async function save() {
      if (!doc || !ready) return;
      const mine = ctx.generation(), key = doc.key, title = doc.title;
      const job = work.then(() => ctx.call("snapshot"));
      work = job.catch(() => {});
      const snapshot = await job.catch(() => null);
      if (mine !== ctx.generation() || snapshot === null) return;
      const ok = await MimickNotesStore.put(key, title, snapshot);
      if (mine !== ctx.generation()) return;
      keepFailed = !ok;
      keptAt = ok ? new Date() : null;
      if (!ok) ctx.status("Your notes could not be kept in this browser — use Save a copy to keep them");
      showKept();
    }
    function showKept(text) {
      const label = $("notes-kept");
      label.textContent = text ?? (keepFailed ? "Not kept — save a copy"
        : keptAt ? `Kept in this browser · ${keptAt.toTimeString().slice(0, 5)}` : "");
      label.title = "Your highlights and notes are kept in this browser, and come back when you open "
                  + "this PDF again. Save a copy to keep them anywhere else.";
    }

    /* Save a copy of the PDF with the highlights and notes in it. Where the
     * browser lets a page choose where a file goes, the save window opens first
     * -- it has to, inside the key press or click -- and the file is written once
     * made; elsewhere it downloads. */
    async function download() {
      if (!doc || !ready) return;
      const stem = doc.name.replace(/\.pdf$/i, "");
      const name = (/ \(notes\)$/.test(stem) ? stem : stem + " (notes)") + ".pdf";
      const mine = ctx.generation();
      try {
        const saved = await saveFile(ctx.offer, name, "application/pdf", "PDF document", ".pdf", async () => {
          ctx.status("Making a copy with your notes…");
          const job = work.then(() => ctx.call("notes_pdf"));
          work = job.catch(() => {});
          const bytes = await job;
          if (mine !== ctx.generation()) throw new Error("that document is closed now");
          return bytes;
        });
        if (saved) {
          savedToFile();
          ctx.status(`${saved.picked ? "Saved" : "Sent"} ${saved.name}${saved.picked ? "" : " to your downloads"}, with ${plural(items.length, "highlight")}`);
        }
      } catch (err) {
        ctx.status("The copy could not be made: " + err.message);
      }
    }

    /* Every highlight and note as a notes document of their own, in document
     * order: the page (and the section, from the table of contents), the passage
     * quoted with its page, the heading and the note as points. Written by the
     * desktop's notes_export.py in the document worker, so both apps give the
     * same file. The kinds, and the one chosen last, which the dialog offers first. */
    const KINDS = {
      docx: ["Word document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      odt: ["OpenDocument text", "application/vnd.oasis.opendocument.text"],
      pdf: ["PDF document", "application/pdf"],
      md: ["Markdown text", "text/markdown"],
    };
    const lastKind = () => (ctx.recall("mimick-notes-format") in KINDS ? ctx.recall("mimick-notes-format") : "docx");

    /* Export notes… asks which kind first; the dialog's own button then saves,
     * inside its click, which is what lets the browser's save window open. */
    function exportNotes() {
      if (!doc || !ready) return;
      if (!items.length) { ctx.status("There are no highlights or notes to export yet"); return; }
      const dialog = $("export-dialog");
      const chosen = dialog.querySelector(`input[name="export-kind"][value="${lastKind()}"]`);
      if (chosen) chosen.checked = true;
      $("export-count").textContent = `${plural(items.length, "highlight")}, ${items.filter((i) => flat(i.note)).length} with notes`;
      dialog.showModal();
    }

    async function exportAs(kind) {
      if (!doc || !ready || !(kind in KINDS)) return;
      ctx.remember("mimick-notes-format", kind);
      const stem = doc.name.replace(/\.[a-z0-9]+$/i, "").replace(/ \(notes\)$/, "");
      const [description, type] = KINDS[kind];
      const mine = ctx.generation();
      try {
        const saved = await saveFile(ctx.offer, `${stem} (notes).${kind}`, type, description, "." + kind, async () => {
          const sections = items.map((item) => ctx.sectionAt?.(item.page, item.top) ?? null);
          // The reader's own order, as places in the document's.
          const order = ordered().map((item) => items.indexOf(item));
          const job = work.then(() => ctx.call("notes_document", kind, doc.title, doc.name, sections, order));
          work = job.catch(() => {});
          const bytes = await job;
          if (mine !== ctx.generation()) throw new Error("that document is closed now");
          return bytes;
        });
        if (saved) {
          savedToFile();
          ctx.status(`${saved.picked ? "Saved" : "Sent"} ${saved.name}${saved.picked ? "" : " to your downloads"}: ${plural(items.length, "highlight")} and their notes, as a ${description}`);
        }
      } catch (err) {
        ctx.status("The notes could not be exported: " + err.message);
      }
    }
    $("export-go").onclick = (e) => {
      e.preventDefault();
      const kind = $("export-dialog").querySelector('input[name="export-kind"]:checked')?.value;
      $("export-dialog").close();
      ctx.focusPage?.();
      exportAs(kind);
    };

    // --- opening ----------------------------------------------------------------

    async function open(opened) {
      doc = opened;
      ready = false;
      items = []; active = null; undoStack = []; redoStack = []; keptAt = null; keepFailed = false;
      changedAt = remindedAt = null;
      const mine = ctx.generation();
      const kept = await MimickNotesStore.get(doc.key);
      if (mine !== ctx.generation()) return;
      try {
        await ctx.call("set_author", settings.author);
        items = kept ? await ctx.call("restore", kept.annotations) : await ctx.call("annotations");
      } catch (err) {
        if (mine === ctx.generation()) ctx.status("This document's highlights cannot be read: " + err.message);
        return;
      }
      if (mine !== ctx.generation()) return;
      ready = true;
      if (kept) { keptAt = new Date(kept.saved); showKept(); }
      refreshAll();
      if (kept && items.length) {
        ctx.status(`Your ${plural(items.length, "highlight")} from last time ${items.length === 1 ? "is" : "are"} back`);
      }
    }

    function close() {
      clearTimeout(saveTimer);
      changedAt = remindedAt = null;
      doc = null; ready = false; items = []; active = null; undoStack = []; redoStack = []; drafting = null;
      showKept("");
      refreshAll();
    }

    // --- on the page ---------------------------------------------------------

    function draw(page, pageEl) {
      for (const item of items) {
        if (item.page !== page) continue;
        const look = shown(item), picked = item.xref === active;
        for (const rect of item.rects) {
          const box = el("div", { className: "hl annot" });
          box.style.background = css(look.colour, picked ? 150 / 255 : 105 / 255);
          ctx.placeBox(box, page, rect, 1);
          pageEl.append(box);
        }
        // Only the picked-out one offers to be removed, out in the page's own
        // margin level with its last line, so it never sits on a word.
        if (picked && item.rects.length) {
          const [, y0, x1, y1] = item.rects.at(-1);
          const [w] = doc.pages[page], z = ctx.zoom(), size = REMOVE_SIZE / z;
          const x = Math.max(w - size, x1 + size);
          const badge = el("button", { className: "remove on-paper", type: "button", title: "Delete this highlight",
                                       textContent: "×" });
          ctx.placeBox(badge, page, [x - size / 2, (y0 + y1) / 2 - size / 2, x + size / 2, (y0 + y1) / 2 + size / 2]);
          badge.onclick = (e) => { e.stopPropagation(); remove(item); };
          pageEl.append(badge);
        }
      }
    }

    function at(page, x, y) {
      // The newest wins where two overlap, as the desktop's undo does.
      let found = null;
      for (const item of items) {
        if (item.page === page && item.rects.some(([x0, y0, x1, y1]) => x0 <= x && x <= x1 && y0 <= y && y <= y1)) {
          if (!found || item.xref > found.xref) found = item;
        }
      }
      return found;
    }

    function pick(item) {
      const xref = item ? item.xref : null;
      if (xref === active) return;
      active = xref;
      refreshAll();
      if (item) {
        $("cards").querySelector(`[data-xref="${xref}"]`)?.scrollIntoView({ block: "nearest" });
        const words = flat(item.note) || preview(item);
        ctx.status(`“${words.slice(0, 70)}” — Ctrl+C copies it, double-click to edit`);
      }
    }

    // --- highlighting, editing, removing, and undo -----------------------------

    function pushUndo(undone, redone, undo, redo) {
      undoStack.push({ undone, redone, undo, redo });
      undoStack = undoStack.slice(-UNDO_DEPTH);
      redoStack = [];
      refreshControls();
    }

    /* The annotation an undo step is about, whatever object it is now: by its
     * PDF object, then its exact words (newest first), then anything covering
     * its first word. MainWindow._live_annotation. */
    function live(span, ref) {
      const byRef = find(ref[0]);
      if (byRef) return byRef;
      const exact = items.filter((i) => i.first === span[0] && i.last === span[1]);
      if (exact.length) return exact.reduce((a, b) => (b.xref > a.xref ? b : a));
      return items.find((i) => i.first <= span[0] && span[0] <= i.last) ?? null;
    }

    function rememberHighlight(item) {
      const span = [item.first, item.last], ref = [item.xref];
      const { colour: c, note, title } = item;
      const thing = note || title ? "Note" : "Highlight";
      pushUndo(`${thing} removed`, `${thing} put back`,
        async () => { const now = live(span, ref); if (now) await drop(now.xref); },
        async () => { const back = await add(span[0], span[1], { colour: c, note, title }); if (back) { ref[0] = back.xref; active = back.xref; } });
    }

    function rememberDeletion(item) {
      const span = [item.first, item.last], ref = [item.xref];
      const { colour: c, note, title } = item;
      const thing = note || title ? "Note" : "Highlight";
      pushUndo(`${thing} put back`, `${thing} deleted again`,
        async () => { const back = await add(span[0], span[1], { colour: c, note, title }); if (back) { ref[0] = back.xref; active = back.xref; } },
        async () => { const now = live(span, ref); if (now) await drop(now.xref); });
    }

    function rememberNoteChange(item, before, after) {
      const span = [item.first, item.last], ref = [item.xref];
      const apply = async ([note, title, c]) => { const now = live(span, ref); if (now) await set(now.xref, note, title, c); };
      pushUndo("Note change undone", "Note change put back", () => apply(before), () => apply(after));
    }

    function stepUndo(from, to, label) {
      const entry = from.pop();
      if (!entry) { ctx.status(label === "undone" ? "Nothing to undo" : "Nothing to put back"); return; }
      change(async () => {
        await (label === "undone" ? entry.undo() : entry.redo());
        to.push(entry);
        ctx.status(entry[label]);
      });
    }
    const undo = () => stepUndo(undoStack, redoStack, "undone");
    const redo = () => stepUndo(redoStack, undoStack, "redone");

    function highlight(withNote = false) {
      if (!ready) return;
      const span = ctx.selection();
      if (!span) {
        if (withNote && activeItem()) { edit(activeItem()); return; }
        ctx.status(withNote ? "Select some text first, then add a note" : "Select some text first, then highlight it");
        return;
      }
      ctx.clearSelection();
      // The editor opens only once the worker has made the highlight. Until it
      // does, keys belong to it, not the page: Enter there would start reading.
      if (withNote) opening = true;
      change(async () => {
        const item = await add(span[0], span[1], { colour });
        if (!item) { ctx.status("That selection could not be highlighted"); return; }
        active = item.xref;
        if (withNote) {
          // Highlighting and writing on it is one Ctrl+Z: what is remembered
          // is the finished note, once the editor closes.
          setTimeout(() => edit(item, { fresh: true }));
        } else {
          rememberHighlight(item);
          ctx.status(`Highlighted — ${items.length} in this document`);
        }
      }).catch(() => {}).then(() => setTimeout(() => { opening = false; }));
    }

    function remove(item, { remember = true } = {}) {
      if (!item) return;
      change(async () => {
        if (remember) rememberDeletion(item);
        await drop(item.xref);
        ctx.status(remember ? "Highlight deleted — Ctrl+Z puts it back" : "Highlight deleted");
      });
    }

    function step(delta) {
      if (!items.length) return;
      const now = items.findIndex((i) => i.xref === active);
      const index = now < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, now + delta));
      const item = items[index];
      ctx.scrollToPoint(item.page, item.top);
      active = null;
      pick(item);
    }

    // --- copying --------------------------------------------------------------

    async function copy(item, part = "both") {
      if (!item) return;
      const passage = item.first >= 0 ? await ctx.call("selection_text", item.first, item.last) : flat(item.text);
      const note = [item.title, item.note].map((t) => (t || "").trim()).filter(Boolean).join("\n");
      const text = part === "passage" ? passage : part === "note" ? note
        : passage && note ? `“${passage}”\n\n${note}` : passage || note;
      if (!text) { ctx.status("There is nothing written on that one to copy"); return; }
      const said = { passage: "Copied the highlighted passage", note: "Copied the note",
                     both: note ? "Copied the passage and the note" : "Copied the highlighted passage" }[part];
      ctx.copyText(text, said);
    }

    function menuItems(item) {
      const written = !!((item.note || "").trim() || (item.title || "").trim());
      return [
        { label: "Copy the highlighted passage", run: () => copy(item, "passage") },
        ...(written ? [{ label: "Copy the note", run: () => copy(item, "note") },
                       { label: "Copy both", run: () => copy(item, "both") }] : []),
        "-",
        { label: written ? "Edit this note…" : "Write a note on this…", run: () => edit(item) },
        { label: "Read this passage", enabled: ctx.canRead() && item.first >= 0,
          run: () => ctx.readRange(item.first, item.last) },
        "-",
        { label: "Delete this highlight", run: () => remove(item) },
      ];
    }

    // --- the note editor --------------------------------------------------------

    const dialog = $("note-dialog");
    let editing = null, opening = false;

    function edit(item, { fresh = false } = {}) {
      if (!item || !ready) return;
      const before = [item.note, item.title, item.colour];
      editing = { xref: item.xref, fresh, before, deleted: false };
      drafting = { xref: item.xref, note: item.note, title: item.title, colour: item.colour };
      active = item.xref;
      $("note-quote").textContent = `“${preview(item)}”`;
      $("note-title").value = item.title;
      $("note-text").value = item.note;
      paintSwatches();
      refreshAll();
      dialog.showModal();
      placeEditor();
      $("note-text").focus();
    }

    /* Where the reader last dragged the editor to, kept within the window --
     * so the words being written about can stay in view beside it (Kat, 23
     * September). Never moved, or double-clicked back, it sits in the middle. */
    function placeEditor(at = null) {
      if (!at) {
        try { at = JSON.parse(ctx.recall("mimick-note-box") || "null"); } catch { at = null; }
      }
      if (!Array.isArray(at)) {
        dialog.classList.remove("moved");
        dialog.style.left = dialog.style.top = "";
        return;
      }
      const w = dialog.offsetWidth, h = dialog.offsetHeight;
      const left = Math.max(0, Math.min(innerWidth - w, at[0])), top = Math.max(0, Math.min(innerHeight - h, at[1]));
      dialog.classList.add("moved");
      dialog.style.left = left + "px";
      dialog.style.top = top + "px";
      return [left, top];
    }
    {
      const grip = $("note-grip");
      let from = null;
      grip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const box = dialog.getBoundingClientRect();
        from = { x: e.clientX - box.left, y: e.clientY - box.top };
        grip.setPointerCapture(e.pointerId);
        dialog.classList.add("dragging");
        e.preventDefault();
      });
      grip.addEventListener("pointermove", (e) => {
        if (from) placeEditor([e.clientX - from.x, e.clientY - from.y]);
      });
      const drop = (e) => {
        if (!from) return;
        from = null;
        dialog.classList.remove("dragging");
        const box = dialog.getBoundingClientRect();
        ctx.remember("mimick-note-box", JSON.stringify([Math.round(box.left), Math.round(box.top)]));
        $("note-text").focus();
      };
      grip.addEventListener("pointerup", drop);
      grip.addEventListener("pointercancel", drop);
      grip.addEventListener("dblclick", () => {
        ctx.remember("mimick-note-box", "");
        placeEditor();
        $("note-text").focus();
      });
      addEventListener("resize", () => { if (dialog.open && dialog.classList.contains("moved")) placeEditor(); });
    }

    function paintSwatches() {
      const row = $("note-colours");
      row.replaceChildren();
      for (const [name, value] of COLOURS) {
        const button = el("button", { type: "button", className: "swatch", title: name });
        button.style.setProperty("--swatch", css(value));
        button.setAttribute("aria-pressed", sameColour(value, drafting.colour));
        button.onclick = () => {
          drafting.colour = value;
          paintSwatches();
          row.querySelector(`[title="${name}"]`).focus();
          refreshAll();
        };
        row.append(button);
      }
    }

    function drafted() {
      drafting.note = $("note-text").value.trim();
      drafting.title = $("note-title").value.trim();
      refreshAll();
    }
    $("note-text").addEventListener("input", drafted);
    $("note-title").addEventListener("input", drafted);
    // Ctrl+Enter saves, since Enter itself belongs to the text box. Listened for
    // on the whole page, in case focus has wandered out of the editor.
    document.addEventListener("keydown", (e) => {
      if (dialog.open && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); dialog.close("save"); }
    });
    $("note-delete").onclick = () => { editing.deleted = true; dialog.close("save"); };
    $("note-cancel").onclick = () => dialog.close("cancel");
    $("note-form").addEventListener("submit", (e) => { e.preventDefault(); dialog.close("save"); });

    dialog.addEventListener("close", () => {
      const job = editing, draft = drafting;
      editing = null; drafting = null;
      if (!job) return;
      const item = find(job.xref);
      const saving = dialog.returnValue === "save";
      dialog.returnValue = "";
      ctx.focusPage();
      if (!item) { refreshAll(); return; }
      if (!saving) {
        refreshAll();
        if (job.fresh) {
          rememberHighlight(item);
          ctx.status(`Highlighted — ${items.length} in this document`);
        }
        return;
      }
      change(async () => {
        if (job.deleted) {
          if (!job.fresh) rememberDeletion(item);
          await drop(item.xref);
          ctx.status("Highlight deleted");
          return;
        }
        const after = [draft.note, draft.title, draft.colour];
        await set(item.xref, ...after);
        const now = find(item.xref);
        if (job.fresh) {
          if (now) rememberHighlight(now);
        } else if (JSON.stringify(job.before) !== JSON.stringify(after)) {
          rememberNoteChange(item, job.before, after);
        }
        ctx.status("Note saved");
      });
    });

    // --- the notes panel ---------------------------------------------------------

    // The pages the cards are for: every page with any of it on screen, so a
    // note does not leave the column while its highlight can still be seen.
    let panelPages = "";
    const panel = $("notes");

    function renderCards() {
      const cards = $("cards");
      const pages = ctx.pagesShown();
      panelPages = pages.join();
      const scroll = cards.scrollTop;
      cards.replaceChildren();
      const size = Math.max(6, Math.min(40, settings.size * ctx.zoom()));
      cards.style.fontSize = size + "pt";
      cards.style.fontFamily = settings.font ? `"${settings.font}", system-ui, sans-serif` : "";
      const wanted = (i) => drafting?.xref === i.xref || (i.note ? settings.written : settings.quotes);
      cards.classList.toggle("all", settings.all);
      const onPage = settings.all ? ordered().filter(wanted)
        : items.filter((i) => pages.includes(i.page) && wanted(i)).sort((a, b) => a.page - b.page || a.top - b.top);
      for (const item of onPage) cards.append(card(item));
      cards.scrollTop = scroll;
      connect();
    }

    function card(item) {
      const look = shown(item), picked = item.xref === active;
      const node = el("div", { className: "note-card" + (picked ? " picked" : "") });
      node.dataset.xref = item.xref;
      node.style.setProperty("--accent", css(look.colour));
      if (settings.all) {
        node.append(el("div", { className: "where", textContent: `Page ${item.page + 1}` }));
        draggable(node, item);
      }
      if (look.title) node.append(el("div", { className: "heading", textContent: look.title }));
      node.append(look.note ? el("div", { className: "body", textContent: look.note })
                            : el("div", { className: "body quote", textContent: preview(item) }));
      if (picked) {
        const badge = el("button", { className: "remove", type: "button", title: "Delete this highlight", textContent: "×" });
        badge.onclick = (e) => { e.stopPropagation(); remove(item); };
        node.append(badge);
      }
      node.onclick = () => {
        pick(item);
        // In All notes the card may be pages away from what is on screen.
        if (settings.all) ctx.scrollToPoint(item.page, item.top);
      };
      node.ondblclick = () => edit(item);
      node.oncontextmenu = (e) => { e.preventDefault(); pick(item); ctx.showMenu(e.clientX, e.clientY, menuItems(item)); };
      return node;
    }

    /* All notes: a card dragged onto another goes before or after it,
     * whichever half it was dropped on, and that order is kept. */
    let dragged = null;
    function draggable(node, item) {
      node.draggable = true;
      node.addEventListener("dragstart", (e) => {
        dragged = item;
        node.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", orderKey(item));
      });
      node.addEventListener("dragend", () => {
        dragged = null;
        for (const n of $("cards").children) n.classList.remove("dragging", "drop-before", "drop-after");
      });
      const half = (e) => { const b = node.getBoundingClientRect(); return e.clientY < b.top + b.height / 2 ? "before" : "after"; };
      node.addEventListener("dragover", (e) => {
        if (!dragged || dragged === item) return;
        e.preventDefault();
        const where = half(e);
        node.classList.toggle("drop-before", where === "before");
        node.classList.toggle("drop-after", where === "after");
      });
      node.addEventListener("dragleave", () => node.classList.remove("drop-before", "drop-after"));
      node.addEventListener("drop", (e) => {
        if (!dragged || dragged === item) return;
        e.preventDefault();
        const where = half(e), moving = dragged;
        const list = ordered().filter((i) => i !== moving);
        list.splice(list.indexOf(item) + (where === "after" ? 1 : 0), 0, moving);
        setOrder(list);
        ctx.status("Moved — Export notes will follow this order. Notes ▾ → Put notes back in page order undoes it");
      });
    }

    /* A line from each highlight out to its card. */
    function connect() {
      const svg = $("connectors");
      svg.replaceChildren();
      if (!doc || !settings.panel || settings.all) return;
      const main = svg.getBoundingClientRect(), cards = $("cards").getBoundingClientRect();
      const viewBox = ctx.view.getBoundingClientRect();
      for (const node of $("cards").children) {
        const item = find(Number(node.dataset.xref));
        if (!item?.rects.length) continue;
        const box = node.getBoundingClientRect();
        const y2 = box.top + 14;
        if (y2 < cards.top || y2 > cards.bottom) continue;
        const from = ctx.pageRectToClient(item.page, item.rects[0]);
        if (!from || from.top > viewBox.bottom || from.bottom < viewBox.top) continue;
        const x1 = Math.min(from.right + 2, viewBox.right - 2);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        Object.entries({ x1: x1 - main.left, y1: (from.top + from.bottom) / 2 - main.top,
                         x2: box.left - 4 - main.left, y2: y2 - main.top }).forEach(([k, v]) => line.setAttribute(k, v));
        line.setAttribute("stroke", css(shown(item).colour, 120 / 255));
        svg.append(line);
      }
    }
    $("cards").addEventListener("scroll", connect, { passive: true });

    function pageShown() {
      if (!settings.panel) return;
      if (ctx.pagesShown().join() !== panelPages) renderCards();
      else connect();
    }

    function refreshControls() {
      const has = !!doc && ready;
      const written = items.filter((i) => i.note).length, quotes = items.length - written;
      $("filter-quotes").textContent = `Highlights${quotes ? "  " + quotes : ""}`;
      $("filter-notes").textContent = `Notes${written ? "  " + written : ""}`;
      $("filter-quotes").setAttribute("aria-pressed", settings.quotes);
      $("filter-notes").setAttribute("aria-pressed", settings.written);
      $("notes-all").setAttribute("aria-pressed", settings.all);
      for (const id of ["prev-note", "next-note"]) $(id).disabled = !items.length;
      $("note-count").textContent = items.length ? plural(items.length, "note") : "";
      $("notes-foot").hidden = !(has && items.length);
      for (const id of ["markup-highlight", "markup-colour", "markup-note"]) $(id).disabled = !has;
      $("markup-colour").style.setProperty("--swatch", css(colour));
    }

    function refreshAll() {
      ctx.redraw();
      refreshControls();
      if (settings.panel) renderCards();
      else $("connectors").replaceChildren();
    }

    $("filter-quotes").onclick = () => { ctx.remember("mimick-panel-quotes", settings.quotes ? "0" : "1"); refreshAll(); };
    $("filter-notes").onclick = () => { ctx.remember("mimick-panel-notes", settings.written ? "0" : "1"); refreshAll(); };
    $("notes-all").onclick = () => {
      ctx.remember("mimick-panel-all", settings.all ? "0" : "1");
      refreshAll();
      ctx.status(settings.all ? "Every note in the document — drag a card to put them in your own order"
                              : "The notes of the pages on screen, beside their highlights");
    };
    $("prev-note").onclick = () => step(-1);
    $("next-note").onclick = () => step(1);
    $("note-style").onclick = () => chooseStyle();
    $("notes-download").onclick = () => download();

    function setPanel(on) {
      ctx.remember("mimick-notes-panel", on ? "1" : "0");
      panel.hidden = !on;
      $("notes-tab").hidden = on;
      // Putting the column away must not take Add note away with it.
      if (!on && settings.home === "panel") {
        placeBar("top");
        ctx.status("Notes panel hidden — Highlight and Add note moved to the top");
      } else {
        ctx.status(on ? "Notes panel shown" : "Notes panel hidden");
      }
      ctx.relayout();
      refreshAll();
    }

    // --- note appearance ---------------------------------------------------------

    const styleDialog = $("style-dialog");
    let styleBefore = null;
    function chooseStyle() {
      styleBefore = { font: settings.font, size: settings.size };
      $("style-font").value = settings.font;
      $("style-size").value = settings.size;
      $("style-author").value = settings.author;
      styleDialog.showModal();
      previewStyle();
    }
    const previewStyle = () => {
      ctx.remember("mimick-note-font", $("style-font").value.trim());
      const size = Number($("style-size").value);
      if (size >= 6 && size <= 24) ctx.remember("mimick-note-size", size);
      $("style-sample").style.fontFamily = $("style-font").value.trim() ? `"${$("style-font").value.trim()}", system-ui` : "";
      $("style-sample").style.fontSize = (size >= 6 && size <= 24 ? size : 9) * 1.25 + "pt";
      renderCards();
    };
    $("style-font").addEventListener("input", previewStyle);
    $("style-size").addEventListener("input", previewStyle);
    styleDialog.addEventListener("close", () => {
      if (styleDialog.returnValue === "done") {
        ctx.remember("mimick-author", $("style-author").value.trim());
        if (ready) ctx.call("set_author", settings.author);
        ctx.status("Note appearance updated");
      } else if (styleBefore) {
        ctx.remember("mimick-note-font", styleBefore.font);
        ctx.remember("mimick-note-size", styleBefore.size);
      }
      styleDialog.returnValue = "";
      renderCards();
      ctx.focusPage();
    });
    $("style-cancel").onclick = () => styleDialog.close("cancel");
    $("style-form").addEventListener("submit", (e) => { e.preventDefault(); styleDialog.close("done"); });

    // --- the Highlight and Add note strip ----------------------------------------
    // markup_bar.py: one strip with four homes, dragged by its grip.

    const bar = $("markup");
    $("markup-highlight").onclick = () => { highlight(false); ctx.focusPage(); };
    $("markup-note").onclick = () => { highlight(true); };
    $("markup-colour").onclick = (e) => {
      const box = e.currentTarget.getBoundingClientRect();
      ctx.showMenu(box.left, box.bottom + 4, COLOURS.map(([name, value]) => ({
        label: name, swatch: css(value), checked: sameColour(value, colour),
        run: () => { colour = value; refreshControls(); },
      })));
    };

    function placeBar(home, point = null, announce = false) {
      if (home === "panel" && !settings.panel) home = "top";
      const hosts = { panel: $("markup-panel"), top: $("markup-top"), bottom: $("markup-bottom"), float: $("main") };
      hosts[home].append(bar);
      bar.dataset.home = home;
      $("markup-top").hidden = !(home === "top" && settings.bar);
      $("markup-bottom").hidden = !(home === "bottom" && settings.bar);
      bar.hidden = !settings.bar;
      if (home === "float") {
        const [x, y] = inside(...(point ?? JSON.parse(ctx.recall("mimick-markup-point") || "[24, 24]")));
        ctx.remember("mimick-markup-point", JSON.stringify([x, y]));
        keepInside();
      } else {
        bar.style.left = bar.style.top = "";
      }
      ctx.remember("mimick-markup-home", home);
      if (announce) {
        ctx.status({ panel: "Highlight and Add note are in the notes panel",
                     top: "Highlight and Add note are across the top",
                     bottom: "Highlight and Add note are across the bottom",
                     float: "Highlight and Add note are loose over the page — drag the handle to put them back" }[home]);
      }
      ctx.relayout();
      connect();
    }

    /* A point for the loose strip's corner, moved as little as will keep all
     * of it inside the reading area. */
    function inside(x, y) {
      const main = $("main");
      return [Math.max(0, Math.min(x, main.clientWidth - bar.offsetWidth)),
              Math.max(0, Math.min(y, main.clientHeight - bar.offsetHeight))];
    }

    /* Put the loose strip where it was left, or as near as the window now
     * allows. What is remembered is where it was left, so a window made small
     * for a moment does not move it for good. */
    function keepInside() {
      if (bar.dataset.home !== "float" || dragging) return;
      const [x, y] = inside(...JSON.parse(ctx.recall("mimick-markup-point") || "[24, 24]"));
      Object.assign(bar.style, { left: x + "px", top: y + "px" });
    }

    function setBar(on) {
      ctx.remember("mimick-markup-shown", on ? "1" : "0");
      placeBar(settings.home);
      ctx.status(on ? "Highlight and Add note shown" : "Highlight and Add note hidden — Ctrl+H and Ctrl+M still work");
    }

    // Dragging. The strip comes loose where it already is, so it does not jump
    // under the pointer, and follows it; where it is let go decides its home.
    const grip = $("markup-grip");
    let dragging = null;
    const aim = (x, y) => {
      const main = $("main").getBoundingClientRect(), notesBox = panel.getBoundingClientRect();
      if (settings.panel && x >= notesBox.left && x <= notesBox.right && y >= notesBox.top && y <= notesBox.bottom) return "panel";
      if (y - main.top <= SNAP_MARGIN) return "top";
      if (main.bottom - y <= SNAP_MARGIN) return "bottom";
      return "float";
    };
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const box = bar.getBoundingClientRect(), main = $("main").getBoundingClientRect();
      dragging = { dx: e.clientX - box.left, dy: e.clientY - box.top };
      if (bar.dataset.home !== "float") {
        $("main").append(bar);
        bar.dataset.home = "float";
        $("markup-top").hidden = $("markup-bottom").hidden = true;
        ctx.relayout();
      }
      Object.assign(bar.style, { left: box.left - main.left + "px", top: box.top - main.top + "px" });
      bar.classList.add("dragging");
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const main = $("main").getBoundingClientRect();
      const [x, y] = inside(e.clientX - dragging.dx - main.left, e.clientY - dragging.dy - main.top);
      Object.assign(bar.style, { left: x + "px", top: y + "px" });
      bar.dataset.aim = aim(e.clientX, e.clientY);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = null;
      bar.classList.remove("dragging");
      delete bar.dataset.aim;
      const home = aim(e.clientX, e.clientY);
      placeBar(home, home === "float" ? [parseFloat(bar.style.left), parseFloat(bar.style.top)] : null, true);
    };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);
    grip.addEventListener("dblclick", () => placeBar("panel", null, true));
    new ResizeObserver(keepInside).observe($("main"));

    // --- menus -------------------------------------------------------------------

    function notesMenu() {
      const picked = activeItem();
      return [
        { label: "Copy", keys: "Ctrl+C", enabled: !!(ctx.selection() || picked), run: () => ctx.copy() },
        { label: "Highlight selection", keys: "Ctrl+H", enabled: ready, run: () => highlight(false) },
        { label: "Highlight and write a note…", keys: "Ctrl+M", enabled: ready, run: () => highlight(true) },
        "-",
        { label: "Go to next note", keys: "Ctrl+J", enabled: items.length > 0, run: () => step(1) },
        { label: "Go to previous note", keys: "Ctrl+K", enabled: items.length > 0, run: () => step(-1) },
        "-",
        { label: "Undo the last highlight or note", keys: "Ctrl+Z", enabled: undoStack.length > 0, run: undo },
        { label: "Redo it", keys: "Ctrl+Y", enabled: redoStack.length > 0, run: redo },
        "-",
        { label: "Save a copy with your notes (PDF)…", keys: "Ctrl+S", enabled: ready, run: download },
        { label: "Export notes…", enabled: ready && items.length > 0, run: exportNotes },
        { label: "Put notes back in page order", enabled: ready && customOrder(), run: () => {
          setOrder(null);
          ctx.status("Notes are in page order again");
        } },
        { label: "Note appearance…", run: chooseStyle },
        { label: `Remind me to save every ${REMIND_MINUTES} minutes`, checked: remindOn(), run: () => {
          ctx.remember("mimick-save-reminder", remindOn() ? "0" : "1");
          if (!remindOn()) ctx.unask("save");
          ctx.status(remindOn() ? `Mimick will remind you to save a copy when your notes have gone ${REMIND_MINUTES} minutes without one`
                                : "No more reminders to save — your notes are still kept in this browser as you go");
        } },
      ];
    }

    function displayMenu() {
      return [
        { label: "Notes panel", keys: "Ctrl+B", checked: settings.panel, run: () => setPanel(!settings.panel) },
        { label: "Show highlights in the panel", checked: settings.quotes, run: () => $("filter-quotes").click() },
        { label: "Show notes in the panel", checked: settings.written, run: () => $("filter-notes").click() },
        "-",
        { label: "Highlight and note buttons", keys: "Ctrl+Shift+H", checked: settings.bar, run: () => setBar(!settings.bar) },
        ...Object.entries(HOMES).map(([home, label]) => ({
          label, indent: true, checked: settings.home === home, enabled: home !== "panel" || settings.panel,
          run: () => placeBar(home, null, true),
        })),
      ];
    }

    $("notes-menu").onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(); ctx.showMenu(b.left, b.bottom + 4, notesMenu()); };

    panel.hidden = !settings.panel;
    $("notes-tab").hidden = settings.panel;
    // The panel's own › puts it away; the tab on the page's right edge brings it back.
    $("notes-hide").onclick = () => { setPanel(false); ctx.focusPage(); };
    $("notes-tab").onclick = () => setPanel(true);
    placeBar(settings.home);
    refreshControls();

    return {
      COLOURS,
      open, close, draw, at, pick, highlight, edit, remove, step, undo, redo, copy, download, exportNotes, exportAs, menuItems,
      pageShown, connect, refreshAll, displayMenu,
      togglePanel: () => setPanel(!settings.panel),
      toggleBar: () => setBar(!settings.bar),
      get active() { return activeItem(); },
      get ready() { return ready; },
      get count() { return items.length; },
      get editing() { return dialog.open || styleDialog.open; },
      get opening() { return opening; },
    };
  }

  root.MimickNotes = { create };
})(typeof self !== "undefined" ? self : globalThis);
