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
 *   notes.sticky               the sticky notes on the page (js/sticky.js)
 *
 * Sticky notes share all of this: the panel lists them among the highlights,
 * Ctrl+J / Ctrl+K and Ctrl+Z take them in turn, and they are kept, saved and
 * exported with the rest. A card, the panel or an undo step tells the two
 * apart by `kind`: a sticky's item has `kind: "sticky"`.
 *
 * Since 15 October (Kat's asks): a highlight's note can be formatted (bold,
 * italics, underline, strikeout, a list), kept in the PDF as its rich text
 * beside the plain words; and a sticky note can be linked to a highlight. A
 * linked sticky's card sits under its highlight's, picking either one lights
 * the other up, and on the page a dashed line joins them while one is picked.
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
  // A recovery copy not recovered within a week is let go (Kat, 20 October).
  const RECOVER_DAYS = 7;
  const SNAP_MARGIN = 56;        // how near an edge a dropped piece counts as aimed at it
  const REMOVE_SIZE = 18;        // the little x, in pixels
  // The editing tools come in three pieces, each moved by its own ⋯ (Kat, 19
  // October), and each kept where it was put.
  const PIECES = { mark: "Highlight and Add note", sticky: "Add sticky", format: "Text formatting" };
  const PLACES = { panel: "in the notes panel", contents: "in the contents column",
                   "top-left": "at the top, on the left", "top-middle": "at the top, in the middle",
                   "top-right": "at the top, on the right", "bottom-left": "at the bottom, on the left",
                   "bottom-middle": "at the bottom, in the middle", "bottom-right": "at the bottom, on the right",
                   float: "loose over the page" };
  // Where they start: across the top, highlighting and sticky notes on the
  // left, text formatting in the middle (Kat, 20 October, from her screenshot).
  const DEFAULT_PLACES = { mark: "top-left", sticky: "top-left", format: "top-middle" };
  // Display ▾ puts all three in one place at once; across the top or the
  // bottom, as they start.
  const HOMES = { panel: "In the notes panel", top: "Across the top", bottom: "Across the bottom",
                  float: "Loose over the page" };
  const homePlace = (home, name) => (home === "top" || home === "bottom" ? DEFAULT_PLACES[name].replace("top", home) : home);

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
    let drafting = null;         // { xref, note, title, colour, html }
    // Linking, waiting for its other end: a sticky note's "Link it to a
    // highlight…" waits for a highlight, a highlight's "Link a sticky note to
    // this…" for a sticky.
    let linking = null;          // { xref, want: "highlight" | "sticky" }

    const settings = {
      get panel() { return ctx.recall("mimick-notes-panel") !== "0"; },
      get quotes() { return ctx.recall("mimick-panel-quotes") !== "0"; },
      get written() { return ctx.recall("mimick-panel-notes") !== "0"; },
      get bar() { return ctx.recall("mimick-markup-shown") !== "0"; },
      // Where a piece was put. Until 20 October the three moved as one strip,
      // kept as mimick-markup-place; a browser that had moved it keeps that.
      place(name) {
        const place = ctx.recall(`mimick-place-${name}`);
        if (place in PLACES) return place;
        return { top: "top-left", bottom: "bottom-left", float: "float" }[ctx.recall("mimick-markup-place")] ?? DEFAULT_PLACES[name];
      },
      // The order of the pieces in a place: the reader's, where they have
      // dropped one before or after another (Kat, 20 October).
      order(place) {
        let kept = [];
        try { kept = JSON.parse(ctx.recall(`mimick-order-${place}`) || "[]"); } catch {}
        const names = Object.keys(PIECES);
        return [...(Array.isArray(kept) ? kept : []).filter((n) => names.includes(n)), ...names].filter((n, i, all) => all.indexOf(n) === i);
      },
      get font() { return ctx.recall("mimick-note-font") || ""; },
      get size() { const s = Number(ctx.recall("mimick-note-size")); return s >= 6 && s <= 24 ? s : 9; },
      get author() { return ctx.recall("mimick-author") || ""; },
      // Show by colour: the colours turned off in the panel, by name (Kat, 16 October).
      get hiddenColours() {
        try { const h = JSON.parse(ctx.recall("mimick-panel-hidden-colours") || "[]"); return Array.isArray(h) ? h : []; }
        catch { return []; }
      },
      get stickies() { return ctx.recall("mimick-panel-sticky") !== "0"; },
      // Display ▾ → Sticky notes: + Add sticky and its formatting row on the strip.
      get sticky() { return ctx.recall("mimick-sticky") !== "0"; },
      get stickyColour() {
        try { const c = JSON.parse(ctx.recall("mimick-sticky-colour") || "null"); return Array.isArray(c) ? c : COLOURS[0][1]; }
        catch { return COLOURS[0][1]; }
      },
    };
    // Not "has rich text": a highlight's note can have that too, since 15 October.
    const isSticky = (item) => item?.kind === "sticky";

    // --- the reader's own order, for Export notes ------------------------------
    // (Dragged in the panel's All notes until 19 October; in the Export notes
    // window since, at Kat's word.)
    // Kat asked to put notes in an order of her own by dragging (23 September).
    // Kept per document, by a key that survives reopening -- the words a
    // highlight covers, or for one made elsewhere, where it sits -- since an
    // xref can change when the notes are put back from the browser's store.
    const orderKey = (item) => (isSticky(item) ? `s${item.page}@${Math.round(item.rect[0])},${Math.round(item.rect[1])}`
      : item.first >= 0 ? `w${item.first}-${item.last}` : `p${item.page}@${Math.round(item.top)}`);
    /* Highlights and sticky notes together, in page order, as the panel lists
     * them -- except that a sticky linked to a highlight comes straight after it. */
    const byPlace = (a, b) => a.page - b.page || a.top - b.top;
    // --- the document's colours ----------------------------------------------------
    // A plain PDF has Mimick's four. One with highlight colours of its own
    // uses those, a dot each, even one Mimick lacks, such as purple; with fewer
    // than four, Mimick's fill it to four, skipping any whose family is there
    // already -- any yellow counts as yellow (Kat, 20 October). One of Mimick's
    // used in the file is always there. Worked out afresh from what is in the
    // document, so a colour goes when the last thing in it does.
    const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - (b?.[i] ?? 0))));
    /* Which of Mimick's four it is a shade of -- loose enough that another
     * program's yellow (Acrobat's is purer) counts as yellow -- or null. */
    function familyOf(value) {
      let best = null, near = 0.4;
      for (const [name, ours] of COLOURS) {
        const d = distance(ours, value);
        if (d < near) { best = name; near = d; }
      }
      return best;
    }
    /* A colour's hue in degrees; 400 for a grey, which has none. */
    function hueOf([r, g, b]) {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min < 0.12) return 400;
      return (max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4) * 60;
    }
    /* A name for a colour that is none of Mimick's, from its hue. */
    function hueName(value) {
      const h = hueOf(value), max = Math.max(...value);
      if (h === 400) return max > 0.8 ? "White" : max < 0.25 ? "Black" : "Grey";
      return h < 15 ? "Red" : h < 45 ? "Orange" : h < 70 ? "Yellow" : h < 160 ? "Green" : h < 200 ? "Teal"
        : h < 255 ? "Blue" : h < 290 ? "Purple" : h < 330 ? "Magenta" : h < 345 ? "Pink" : "Red";
    }
    let paletteKey = null, paletteNow = COLOURS.map(([name, value]) => ({ name, value }));
    /* The colours to show, highlight and make sticky notes in: [{ name, value }],
     * Mimick's family order first (yellow, green, blue, pink), then by hue. */
    function palette() {
      const used = [...items, ...sticky.list].map((i) => i.colour).filter((c) => Array.isArray(c) && c.length >= 3);
      const key = used.map((c) => c.slice(0, 3).map((v) => v.toFixed(3)).join(",")).join(";");
      if (key === paletteKey) return paletteNow;
      const theirs = [];
      for (const c of used) {
        if (COLOURS.some(([, ours]) => sameColour(ours, c))) continue;
        if (!theirs.some((t) => distance(t, c) < 0.06)) theirs.push(c.slice(0, 3));
      }
      const families = new Set(theirs.map(familyOf));
      const entries = theirs.map((value) => ({ value, family: familyOf(value) }));
      for (const [name, value] of COLOURS) {
        const inFile = used.some((c) => sameColour(value, c));
        if (!families.has(name) && (entries.length < 4 || inFile)) entries.push({ value, family: name, ours: true });
      }
      const rank = (e) => { const k = COLOURS.findIndex(([n]) => n === e.family); return k >= 0 ? k * 1000 + (e.ours ? 0 : 1) : 4000 + hueOf(e.value); };
      entries.sort((a, b) => rank(a) - rank(b));
      const taken = new Map();
      paletteNow = entries.map(({ value, family }) => {
        const base = family ?? hueName(value), n = (taken.get(base) ?? 0) + 1;
        taken.set(base, n);
        return { name: n === 1 ? base : `${base} ${n}`, value };
      });
      paletteKey = key;
      return paletteNow;
    }
    /* The dot a colour belongs to: the nearest in the palette. */
    function dotOf(value) {
      let best = palette()[0];
      for (const p of palette()) if (distance(p.value, value) < distance(best.value, value)) best = p;
      return best;
    }
    /* The name of the colour it is in, as its dot is called. */
    const colourName = (item) => dotOf(item.colour).name;
    /* A colour to work in that is in the palette: the dot of its family, or the first. */
    const usable = (value) => (palette().some((p) => sameColour(p.value, value)) ? value
      : (palette().find((p) => familyOf(p.value) === familyOf(value) && familyOf(value)) ?? palette()[0]).value);
    function everything() {
      const loose = [...items, ...sticky.list.filter((s) => !homeOf(s))].sort(byPlace);
      const out = [];
      for (const item of loose) {
        out.push(item);
        if (!isSticky(item)) out.push(...stickiesOf(item).filter((s) => homeOf(s) === item).sort(byPlace));
      }
      return out;
    }
    function savedOrder() {
      try { return JSON.parse(ctx.recall(`mimick-notes-order:${doc?.key}`) || "null"); } catch { return null; }
    }
    /* Every item, in the reader's order where there is one. A highlight made
     * since keeps its place in the document relative to the ones around it. */
    function ordered() {
      const order = savedOrder();
      if (!Array.isArray(order) || !order.length) return everything();
      const rank = new Map(order.map((k, i) => [k, i]));
      let last = -1, gap = 0;
      const ranked = everything().map((item) => {
        const r = rank.get(orderKey(item));
        if (r !== undefined) { last = r; gap = 0; return [item, r]; }
        gap += 1e-3;
        return [item, last + gap];
      });
      return ranked.sort((a, b) => a[1] - b[1]).map(([item]) => item);
    }
    const customOrder = () => Array.isArray(savedOrder()) && savedOrder().length > 0;
    /* Yellow, green, blue, pink, then any other, each in page order; a sticky
     * linked to a highlight stays after it. */
    function inColourOrder() {
      const rank = (item) => palette().findIndex((p) => p.name === colourName(item));
      const groups = [];
      for (const item of everything()) {
        if (isSticky(item) && homeOf(item) && groups.length) groups.at(-1).push(item);
        else groups.push([item]);
      }
      return groups.map((g, i) => [g, i]).sort((a, b) => rank(a[0][0]) - rank(b[0][0]) || a[1] - b[1]).flatMap(([g]) => g);
    }
    const inOrder = (how) => (how === "colour" ? inColourOrder() : how === "own" ? ordered() : everything());
    function setOrder(list) {
      if (!doc) return;
      ctx.remember(`mimick-notes-order:${doc.key}`, list ? JSON.stringify(list.map(orderKey)) : "");
      refreshAll();
    }

    const shown = (item) => (drafting && drafting.xref === item.xref ? { ...item, ...drafting } : item);
    const find = (xref) => items.find((item) => item.xref === xref) ?? null;
    const findAny = (xref) => find(xref) ?? sticky.list.find((s) => s.xref === xref) ?? null;
    const activeItem = () => (active === null ? null : find(active));
    const activeSticky = () => (active === null ? null : sticky.list.find((s) => s.xref === active) ?? null);

    // --- sticky notes linked to highlights ---------------------------------------
    // A sticky names its highlights by their own PDF names, space-separated,
    // which survive saving and undo where xrefs do not (annotations.py). One
    // sticky can be on several highlights (Kat, 16 October).
    const linkNames = (s) => (s?.link || "").split(/\s+/).filter(Boolean);
    /* The highlights a sticky is linked to that are still there, in the order linked. */
    const linkedHighlights = (s) => linkNames(s).map((n) => items.find((h) => h.name === n)).filter(Boolean);
    /* The one whose card it follows in the panel: the first in the document. */
    const homeOf = (s) => linkedHighlights(s).sort(byPlace)[0] ?? null;
    const stickiesOf = (h) => (h?.name ? sticky.list.filter((s) => linkNames(s).includes(h.name)) : []);
    /* Whether `item` is linked to the one picked out, either way round. */
    function partner(item) {
      const picked = active === null ? null : findAny(active);
      if (!picked || !item || picked.xref === item.xref || isSticky(picked) === isSticky(item)) return false;
      const [s, h] = isSticky(picked) ? [picked, item] : [item, picked];
      return linkedHighlights(s).includes(h);
    }
    function goTo(item) {
      if (!item) return;
      ctx.scrollToPoint(item.page, item.top);
      active = null;
      pick(item);
    }

    /* Link it to a highlight: the next highlight clicked, on the page or in
     * the panel -- or from a highlight, the next sticky note. Esc, or a click
     * anywhere else, stops. */
    function startLinking(item) {
      const fromSticky = isSticky(item);
      linking = { xref: item.xref, want: fromSticky ? "highlight" : "sticky" };
      document.body.classList.add("linking");
      ctx.status(fromSticky ? "Click a highlight this sticky note is about — on the page, or its card in the panel. Esc stops"
                            : "Click the sticky note to link to this highlight — on the page, or its card in the panel. Esc stops");
    }
    /* A sticky note picked while a highlight waits for one: link them. */
    function linkHere(xref) {
      if (linking?.want !== "sticky") return false;
      const h = find(linking.xref), s = sticky.list.find((x) => x.xref === xref);
      stopLinking(true);
      if (h && s) linkTo(s, h);
      return !!(h && s);
    }
    function stopLinking(quiet = false) {
      if (linking === null) return;
      linking = null;
      document.body.classList.remove("linking");
      if (!quiet) ctx.status("Not linked");
    }
    function linkTo(s, h) {
      if (linkNames(s).includes(h.name)) {
        ctx.status("That sticky note is already linked to that highlight");
        return;
      }
      change(async () => {
        const before = s.link || "";
        const back = await ctx.call("sticky_link", s.xref, h.xref);
        items = back.annotations;
        sticky.set(back.stickies);
        const now = sticky.list.find((x) => x.xref === s.xref);
        if (now && now.link !== before) sticky.remember(now, "link", before, now.link, "Link");
        active = s.xref;
        const more = now ? linkedHighlights(now).length - 1 : 0;
        ctx.status(`Sticky note linked to “${preview(h).slice(0, 60)}”${more ? ` — and ${plural(more, "other highlight")}` : ""}`
                   + " — picking either one lights up the other");
      });
    }
    /* A sticky's menu: go to and unlink each highlight, and link another. */
    function linkItems(s) {
      const on = linkedHighlights(s);
      const unlink = (h) => {
        sticky.setLink(s, linkNames(s).filter((n) => n !== h.name).join(" "));
        ctx.status("Unlinked — the sticky note and the highlight both stay");
      };
      const out = [];
      if (on.length === 1) {
        out.push({ label: "Go to its highlight", run: () => goTo(on[0]) },
                 { label: "Unlink it from its highlight", run: () => unlink(on[0]) });
      } else if (on.length) {
        const quote = (h) => `“${preview(h).slice(0, 40)}${preview(h).length > 40 ? "…" : ""}”`;
        out.push({ label: "Go to its highlight", enabled: false },
                 ...on.map((h) => ({ label: quote(h), indent: true, run: () => goTo(h) })),
                 { label: "Unlink it from", enabled: false },
                 ...on.map((h) => ({ label: quote(h), indent: true, run: () => unlink(h) })));
      }
      out.push({ label: on.length ? "Link it to another highlight…" : "Link it to a highlight…",
                 enabled: items.length > on.length, run: () => startLinking(s) });
      return out;
    }
    /* Add a sticky note about this: in the page's margin beside the
     * highlight if there is room, or under it, linked to it from the start. */
    function addStickyFor(h) {
      if (!ready || !h.rects.length) return;
      const [w] = doc.pages[h.page];
      const right = Math.max(...h.rects.map((r) => r[2])), bottom = Math.max(...h.rects.map((r) => r[3]));
      const room = w - right - 16;
      if (room >= 100) sticky.addLinked(h.page, right + 10, h.rects[0][1], h.xref, Math.min(180, room));
      else sticky.addLinked(h.page, h.rects[0][0], bottom + 6, h.xref);
    }
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

    async function add(first, last, { colour: c, note = "", title = "", rich = "", name = "" }) {
      const { xref, annotations } = await ctx.call("annotation_add", first, last, c, note, title, settings.author,
                                                   rich || "", name || "");
      items = annotations;
      return xref === null ? null : find(xref);
    }
    /* `rich` is the note as HTML; the worker makes the plain words from it. */
    async function set(xref, note, title, c, rich) {
      items = await ctx.call("annotation_set", xref, note, title, c, rich ?? plainHtml(note));
    }
    async function drop(xref) {
      items = await ctx.call("annotation_remove", xref);
      if (active === xref) active = null;
    }

    // --- keeping them ---------------------------------------------------------
    // The file is what counts (Kat, 20 October): opening a PDF shows the notes
    // in it, the same on any computer. The browser keeps a recovery copy only
    // while there is work not yet saved to a file, for a crash or a browser
    // that quits unexpectedly. Saving to a file deletes it; closing the tab
    // or the browser on purpose, after the browser's warning, lets it go.

    let saveTimer = 0, keptAt = null, savedAt = null, keepFailed = false;
    let recovering = null;       // { key, kept, mine } while the recovery question is open
    // Documents closed on purpose with work unsaved, by key: their recovery
    // copies are deleted, not offered, when they are next opened. Written as
    // the page goes, which only a deliberate close or reload lives to do.
    const CLOSED = "mimick-closed-on-purpose";
    function closedOnPurpose() {
      try { const list = JSON.parse(ctx.recall(CLOSED) || "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
    }
    window.addEventListener("pagehide", () => {
      if (!doc || changedAt === null) return;
      ctx.remember(CLOSED, JSON.stringify([...closedOnPurpose().filter((k) => k !== doc.key), doc.key].slice(-20)));
    });

    // --- the reminder to save to a file -------------------------------------------
    // From the first change after the last Save a copy: every
    // fifteen minutes while it stays unsaved, a line in the status bar and a
    // button that saves. Notes ▾ → Remind me to save turns it off.
    let changedAt = null, remindedAt = null;
    const remindOn = () => ctx.recall("mimick-save-reminder") !== "0";
    // A check can make the wait shorter; nothing a reader sees sets this.
    const remindMs = () => (Number(ctx.recall("mimick-save-reminder-minutes")) || REMIND_MINUTES) * 60000;
    function unsaved() { changedAt ??= Date.now(); showKept(); }
    function savedToFile() {
      changedAt = remindedAt = null;
      ctx.unask("save");
      clearTimeout(saveTimer);
      if (doc) MimickNotesStore.remove(doc.key);
      keptAt = null;
      savedAt = new Date();
      showKept();
    }
    function remindIfDue() {
      if (!doc || !ready || changedAt === null || !remindOn()) return;
      const now = Date.now(), wait = remindMs();
      if (now - changedAt < wait || (remindedAt !== null && now - remindedAt < wait)) return;
      remindedAt = now;
      const minutes = Math.max(1, Math.round((now - changedAt) / 60000));
      ctx.status(`Your newest highlights and notes have gone ${minutes === 1 ? "a minute" : minutes + " minutes"} without being saved `
                 + "to a file. Closing this tab will lose them.");
      ctx.ask("save", "Save a copy now", "Save the PDF with your highlights and notes in it (Ctrl+S). "
              + "Notes ▾ → Remind me to save turns these reminders off.", download);
    }
    setInterval(remindIfDue, 5000);
    // Closing the tab or reloading with changes not yet in a file: the
    // browser asks first, in its own words -- a page cannot give it any (Kat,
    // 16 October). Mimick's own words are in the status bar meanwhile.
    window.addEventListener("beforeunload", (e) => {
      if (doc && ready && changedAt !== null) { e.preventDefault(); e.returnValue = ""; }
    });
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_AFTER_MS);
    }
    async function save() {
      if (!doc || !ready || changedAt === null) return;
      const mine = ctx.generation(), key = doc.key, title = doc.title;
      const job = work.then(() => ctx.call("snapshot"));
      work = job.catch(() => {});
      const snapshot = await job.catch(() => null);
      if (mine !== ctx.generation() || snapshot === null) return;
      const ok = await MimickNotesStore.put(key, title, snapshot);
      if (mine !== ctx.generation()) return;
      keepFailed = !ok;
      keptAt = ok ? new Date() : null;
      if (!ok) ctx.status("No recovery copy could be kept in this browser — use Save a copy to keep your work");
      showKept();
    }
    function showKept(text) {
      const label = $("notes-kept"), open = doc && changedAt !== null;
      const time = (d) => d.toTimeString().slice(0, 5);
      label.textContent = text ?? (!open ? (savedAt ? `Saved to a file · ${time(savedAt)}` : "")
        : keepFailed ? "Not saved to a file, and no recovery copy"
        : `Not saved to a file${keptAt ? ` · recovery copy ${time(keptAt)}` : ""}`);
      label.title = "Your work counts once it is in the PDF: Save a copy (Ctrl+S). Until then this "
                  + "browser keeps a recovery copy, in case it closes unexpectedly.";
      // In the status bar, while there is work not in a file (Kat, 20 October).
      $("unsaved").hidden = !open;
    }

    /* Save a copy of the PDF with the highlights and notes in it. Where the
     * browser lets a page choose where a file goes, the save window opens first
     * -- it has to, inside the key press or click -- and the file is written once
     * made; elsewhere it downloads. */
    async function download(as = "notes") {
      if (!doc || !ready) return;
      const stem = doc.name.replace(/\.pdf$/i, "");
      const name = (stem.endsWith(` (${as})`) ? stem : `${stem} (${as})`) + ".pdf";
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
          const stuck = sticky.list.length;
          ctx.status(`${saved.picked ? "Saved" : "Sent"} ${saved.name}${saved.picked ? "" : " to your downloads"}, with ${plural(items.length, "highlight")}`
                     + (stuck ? ` and ${plural(stuck, "sticky note")}` : ""));
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
      if (!items.length && !sticky.list.length) { ctx.status("There are no highlights or notes to export yet"); return; }
      const dialog = $("export-dialog");
      const chosen = dialog.querySelector(`input[name="export-kind"][value="${lastKind()}"]`);
      if (chosen) chosen.checked = true;
      $("export-count").textContent = `${plural(items.length, "highlight")}, ${items.filter((i) => flat(i.note)).length} with notes`
        + (sticky.list.length ? `, ${plural(sticky.list.length, "sticky note")}` : "");
      // The order chosen last; for a document put in an order of its own
      // before 19 October, that order.
      const how = ["page", "colour", "own"].includes(ctx.recall("mimick-export-order")) ? ctx.recall("mimick-export-order")
        : customOrder() ? "own" : "page";
      dialog.querySelector(`input[name="export-order"][value="${how}"]`).checked = true;
      showOrderList();
      dialog.showModal();
    }
    const exportOrder = () => $("export-dialog").querySelector('input[name="export-order"]:checked')?.value || "page";
    /* My own order: every note as a row, to drag into place. */
    function showOrderList() {
      const list = $("export-list");
      list.hidden = exportOrder() !== "own";
      if (list.hidden) return;
      const scroll = list.scrollTop;
      list.replaceChildren(...ordered().map((item) => {
        const row = el("div", { className: "order-row" });
        row.style.setProperty("--accent", css(item.colour));
        const words = isSticky(item) ? `📌 ${item.title || flat(item.text) || "Sticky note"}`
          : [item.title, flat(item.note), `“${preview(item)}”`].filter(Boolean)[0];
        row.title = "Drag to move it";
        row.append(el("span", { className: "at", textContent: `p. ${item.page + 1}` }), el("span", { className: "words", textContent: words }));
        draggable(row, item);
        return row;
      }));
      list.scrollTop = scroll;
    }
    for (const radio of $("export-dialog").querySelectorAll('input[name="export-order"]')) {
      radio.addEventListener("change", () => { ctx.remember("mimick-export-order", exportOrder()); showOrderList(); });
    }

    async function exportAs(kind) {
      if (!doc || !ready || !(kind in KINDS)) return;
      ctx.remember("mimick-notes-format", kind);
      const stem = doc.name.replace(/\.[a-z0-9]+$/i, "").replace(/ \(notes\)$/, "");
      const [description, type] = KINDS[kind];
      const mine = ctx.generation();
      try {
        const saved = await saveFile(ctx.offer, `${stem} (notes).${kind}`, type, description, "." + kind, async () => {
          // The order chosen in the window, highlights and sticky notes
          // together, each with the section it is in.
          const entries = inOrder(exportOrder()).map((item) => [isSticky(item) ? "s" : "h",
            isSticky(item) ? sticky.list.indexOf(item) : items.indexOf(item), ctx.sectionAt?.(item.page, item.top) ?? null]);
          const job = work.then(() => ctx.call("notes_document", kind, doc.title, doc.name, [], null, entries));
          work = job.catch(() => {});
          const bytes = await job;
          if (mine !== ctx.generation()) throw new Error("that document is closed now");
          return bytes;
        });
        // A notes document is not the PDF: only Save a copy counts as saved
        // (Kat, 20 October), so the warning and the recovery copy stay.
        if (saved) {
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
      items = []; active = null; undoStack = []; redoStack = []; keptAt = savedAt = null; keepFailed = false;
      changedAt = remindedAt = null;
      showKept();
      const mine = ctx.generation();
      const kept = await MimickNotesStore.get(doc.key);
      if (mine !== ctx.generation()) return;
      try {
        await ctx.call("set_author", settings.author);
        // The file's own notes, always; a recovery copy is only offered.
        items = await ctx.call("annotations");
        sticky.set(await ctx.call("stickies"));
      } catch (err) {
        if (mine === ctx.generation()) ctx.status("This document's highlights cannot be read: " + err.message);
        return;
      }
      if (mine !== ctx.generation()) return;
      ready = true;
      refreshAll();
      if (kept) offerRecovery(kept, mine);
    }

    /* A recovery copy found as a document opens: work that never reached a
     * file. Closed on purpose, it goes; the same as the file, it goes;
     * otherwise Mimick asks (Kat, 20 October). Copies kept before then were
     * kept whether or not they were saved, so they are asked about once. */
    async function offerRecovery(kept, mine) {
      const key = doc.key, closed = closedOnPurpose();
      if (closed.includes(key)) ctx.remember(CLOSED, JSON.stringify(closed.filter((k) => k !== key)));
      if (closed.includes(key) || !(Date.now() - kept.saved < RECOVER_DAYS * 864e5)) {
        MimickNotesStore.remove(key);
        return;
      }
      const job = work.then(() => ctx.call("snapshot"));
      work = job.catch(() => {});
      const now = await job.catch(() => null);
      if (mine !== ctx.generation()) return;
      // What it has that the file does not, and what it took away: the copy
      // is the whole document's notes, the file's own among them.
      const all = kept.annotations || [], file = now ?? [];
      const inFile = new Set(file.map((a) => JSON.stringify(a))), names = new Set(all.map((a) => a.name ?? a.xref));
      const added = all.filter((a) => !inFile.has(JSON.stringify(a)));
      const gone = file.filter((a) => !names.has(a.name ?? a.xref)).length;
      if (now && !added.length && !gone) { MimickNotesStore.remove(key); return; }
      const stuck = added.filter((a) => a.kind === "sticky").length, marks = added.length - stuck;
      const kinds = [marks ? plural(marks, "highlight") : "", stuck ? plural(stuck, "sticky note") : ""].filter(Boolean).join(" and ");
      const what = [kinds && `${kinds} added or changed`, gone ? `${plural(gone, "note")} deleted` : ""]
        .filter(Boolean).join(", ") || "changes";
      $("recover-what").textContent = what;
      $("recover-when").textContent = new Date(kept.saved).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      recovering = { key, kept, mine, what };
      recoverDialog.returnValue = "";
      recoverDialog.showModal();
      $("recover-go").focus();
    }
    const recoverDialog = $("recover-dialog");
    // One of the two buttons, not Esc: a key pressed by chance must not decide it.
    recoverDialog.addEventListener("cancel", (e) => e.preventDefault());
    recoverDialog.addEventListener("close", async () => {
      const r = recovering;
      recovering = null;
      if (!r || r.mine !== ctx.generation()) return;
      if (recoverDialog.returnValue !== "recover") {
        MimickNotesStore.remove(r.key);
        ctx.status("Discarded — this document shows what its file holds");
        return;
      }
      try {
        const job = work.then(() => ctx.call("restore", r.kept.annotations));
        work = job.catch(() => {});
        items = await job;
        sticky.set(await ctx.call("stickies"));
      } catch (err) {
        if (r.mine === ctx.generation()) ctx.status("The unsaved work could not be recovered: " + err.message);
        return;
      }
      if (r.mine !== ctx.generation()) return;
      undoStack = []; redoStack = [];
      keptAt = new Date(r.kept.saved);
      unsaved();
      refreshAll();
      ctx.status(`Recovered: ${r.what}. Not saved to a file yet — Save a copy (Ctrl+S) to keep them.`);
    });

    function close() {
      clearTimeout(saveTimer);
      changedAt = remindedAt = null;
      doc = null; ready = false; items = []; active = null; undoStack = []; redoStack = []; drafting = null;
      sticky.clear();
      showKept("");
      refreshAll();
    }

    // --- on the page ---------------------------------------------------------

    function draw(page, pageEl) {
      sticky.draw(page, pageEl);
      for (const item of items) {
        if (item.page !== page) continue;
        const look = shown(item), picked = item.xref === active, linked = partner(item);
        for (const rect of item.rects) {
          const box = el("div", { className: "hl annot" + (linked ? " partner" : "") });
          box.style.background = css(look.colour, picked || linked ? 150 / 255 : 105 / 255);
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
      // A dashed line between the one picked out and what it is linked to,
      // where both are on this page.
      const picked = active === null ? null : findAny(active);
      const pairs = !picked ? [] : isSticky(picked) ? linkedHighlights(picked).map((h) => [picked, h])
        : stickiesOf(picked).map((s) => [s, picked]);
      for (const [s, h] of pairs) if (h && s.page === page && h.page === page) pageEl.append(linkLine(page, s, h));
    }

    /* From the sticky's nearest edge to the nearest point of the highlight's
     * first line, in page points. */
    function linkLine(page, s, h) {
      const [w, ht] = doc.pages[page];
      const [sx0, sy0, sx1, sy1] = s.rect, [hx0, hy0, hx1, hy1] = h.rects[0];
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const hx = clamp((sx0 + sx1) / 2, hx0, hx1), hy = clamp((sy0 + sy1) / 2, hy0, hy1);
      const sx = clamp(hx, sx0, sx1), sy = clamp(hy, sy0, s.folded ? sy0 + 20 / ctx.zoom() : sy1);
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "hl link-line");
      svg.setAttribute("viewBox", `0 0 ${w} ${ht}`);
      svg.setAttribute("preserveAspectRatio", "none");
      const line = document.createElementNS(NS, "line");
      Object.entries({ x1: sx, y1: sy, x2: hx, y2: hy }).forEach(([k, v]) => line.setAttribute(k, v));
      line.setAttribute("stroke", css(s.colour.map((c) => c * 0.6)));
      svg.append(line);
      return svg;
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
      if (linking !== null) {
        const from = findAny(linking.xref);
        if (from && item && isSticky(item) === (linking.want === "sticky")) {
          stopLinking(true);
          if (isSticky(item)) linkTo(item, from); else linkTo(from, item);
          return;
        }
        stopLinking();
      }
      const xref = item ? item.xref : null;
      if (xref === active) return;
      active = xref;
      refreshAll();
      if (item && isSticky(item)) {
        $("cards").querySelector(`[data-xref="${xref}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (item) {
        $("cards").querySelector(`[data-xref="${xref}"]`)?.scrollIntoView({ block: "nearest" });
        const words = flat(item.note) || preview(item);
        ctx.status(`“${words.slice(0, 70)}” — Ctrl+C copies it, double-click to edit`);
      }
    }

    // --- highlighting, editing, removing, and undo -----------------------------

    function pushUndo(undone, redone, undo, redo, tag = null) {
      undoStack.push({ undone, redone, undo, redo, tag });
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

    // Put back with its name, a highlight is still the one its sticky notes
    // are linked to.
    function rememberHighlight(item) {
      const span = [item.first, item.last], ref = [item.xref];
      const { colour: c, note, title, rich, name } = item;
      const thing = note || title ? "Note" : "Highlight";
      pushUndo(`${thing} removed`, `${thing} put back`,
        async () => { const now = live(span, ref); if (now) await drop(now.xref); },
        async () => { const back = await add(span[0], span[1], { colour: c, note, title, rich, name }); if (back) { ref[0] = back.xref; active = back.xref; } });
    }

    function rememberDeletion(item) {
      const span = [item.first, item.last], ref = [item.xref];
      const { colour: c, note, title, rich, name } = item;
      const thing = note || title ? "Note" : "Highlight";
      pushUndo(`${thing} put back`, `${thing} deleted again`,
        async () => { const back = await add(span[0], span[1], { colour: c, note, title, rich, name }); if (back) { ref[0] = back.xref; active = back.xref; } },
        async () => { const now = live(span, ref); if (now) await drop(now.xref); });
    }

    function rememberNoteChange(item, before, after) {
      const span = [item.first, item.last], ref = [item.xref];
      const apply = async ([note, title, c, rich]) => { const now = live(span, ref); if (now) await set(now.xref, note, title, c, rich); };
      pushUndo("Note change undone", "Note change put back", () => apply(before), () => apply(after));
    }

    /* Forget the steps made under `tag` -- a sticky opened and left empty. */
    function dropUndo(tag) {
      undoStack = undoStack.filter((entry) => entry.tag !== tag);
      refreshControls();
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

    // --- sticky notes -------------------------------------------------------------
    // js/sticky.js; this is what it needs of the notes and the reader.

    const sticky = MimickSticky.create({
      call: ctx.call, status: ctx.status, showMenu: ctx.showMenu, copyText: ctx.copyText, COLOURS,
      change, dropUndo: (xref) => dropUndo("sticky:" + xref),
      pushUndo,
      zoom: ctx.zoom,
      pageSize: (page) => doc.pages[page],
      ready: () => !!doc && ready,
      focusPage: () => ctx.focusPage(),
      canRead: () => ctx.canRead(),
      readSticky: (item) => ctx.readSticky(item),
      caretSpot: () => ctx.caretSpot(),
      viewSpot: () => ctx.viewSpot(),
      download: () => download(),
      colour: () => usable(settings.stickyColour),
      palette: () => palette(),
      active: () => active,
      activeSticky,
      pick: (item) => { if (item && active !== item.xref) { active = item.xref; refreshAll(); } },
      linkHere,
      formatChanged: () => showFormat(),
      partner,
      linkItems,
      linked: (annotations) => { items = annotations; },
    });

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
        const item = await add(span[0], span[1], { colour: usable(colour) });
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
      const all = everything();
      if (!all.length) return;
      const now = all.findIndex((i) => i.xref === active);
      const index = now < 0 ? (delta > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, now + delta));
      const item = all[index];
      ctx.scrollToPoint(item.page, item.top);
      active = null;
      pick(item);
      if (isSticky(item)) ctx.status(`Sticky note on page ${item.page + 1} — double-click its card, or click into it, to write`);
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
        { label: "Add a sticky note about this", run: () => addStickyFor(item) },
        { label: "Link a sticky note to this…", enabled: sticky.list.some((s) => !stickiesOf(item).includes(s)),
          run: () => startLinking(item) },
        ...(stickiesOf(item).length ? [{ label: stickiesOf(item).length === 1 ? "Go to its sticky note"
          : `Go to its sticky notes (${stickiesOf(item).length})`, run: () => goTo(stickiesOf(item)[0]) }] : []),
        "-",
        { label: "Delete this highlight", run: () => remove(item) },
      ];
    }

    // --- the note editor --------------------------------------------------------

    const dialog = $("note-dialog");
    let editing = null, opening = false;

    // The note is typed into an editable box, formatted by the row over it or
    // the usual keys -- done here, not left to the browser: Firefox on Linux
    // gives Ctrl+B to its bookmarks (29 September). The worker cleans what it
    // is given down to the few tags a note can hold (annotations.clean_rich).
    const noteText = $("note-text");
    const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const plainHtml = (text) => ((text || "").trim()
      ? (text || "").split("\n").map((line) => `<p>${line ? escapeHtml(line) : "<br>"}</p>`).join("") : "");
    // Sizes a note never has, but a pasted or older one might: as the card's own.
    const richShown = (rich) => rich.replace(/font-size:\s*([\d.]+)pt/g, (m, n) => `font-size:${n / 11}em`);
    const notePlain = () => noteText.innerText.replace(/\n\n/g, "\n").trim();
    function caretToEnd(box) {
      box.focus();
      const end = document.createRange();
      end.selectNodeContents(box);
      end.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(end);
    }

    function edit(item, { fresh = false } = {}) {
      if (!item || !ready) return;
      const before = [item.note, item.title, item.colour, item.rich || plainHtml(item.note)];
      editing = { xref: item.xref, fresh, before, deleted: false };
      drafting = { xref: item.xref, note: item.note, title: item.title, colour: item.colour };
      active = item.xref;
      $("note-quote").textContent = `“${preview(item)}”`;
      $("note-title").value = item.title;
      // The worker's clean_rich made this, so it holds nothing but words and
      // a few tags, and can be put in as it is.
      noteText.innerHTML = item.rich ? richShown(item.rich) : plainHtml(item.note);
      noteRange = null;
      drafting.html = noteText.innerHTML;
      paintSwatches();
      showNoteFormat();
      refreshAll();
      dialog.showModal();
      placeEditor();
      caretToEnd(noteText);
    }

    // Where the cursor was in the note, for a button that took the focus.
    let noteRange = null;
    function noteFormat(what) {
      if (document.activeElement !== noteText) {
        noteText.focus();
        if (noteRange && noteText.contains(noteRange.startContainer)) {
          getSelection().removeAllRanges();
          getSelection().addRange(noteRange);
        }
      }
      document.execCommand("styleWithCSS", false, false);
      if (what === "strike") document.execCommand("strikeThrough");
      else if (what === "list") MimickSticky.keepingCaret(noteText, () => document.execCommand("insertUnorderedList"));
      else document.execCommand(what);
      drafted();
      showNoteFormat();
    }
    const NOTE_FORMATS = { bold: "bold", italic: "italic", underline: "underline", strike: "strikeThrough",
                           list: "insertUnorderedList" };
    function showNoteFormat() {
      const inside = document.activeElement === noteText;
      for (const button of $("note-format").querySelectorAll("[data-fmt]")) {
        let on = false;
        try { on = inside && document.queryCommandState(NOTE_FORMATS[button.dataset.fmt]); } catch { on = false; }
        button.setAttribute("aria-pressed", on);
      }
      noteText.classList.toggle("empty", !noteText.textContent.trim() && !noteText.querySelector("li"));
    }
    for (const button of $("note-format").querySelectorAll("[data-fmt]")) {
      // The cursor stays in the note: a press must not take the focus.
      button.addEventListener("pointerdown", (e) => e.preventDefault());
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.onclick = () => noteFormat(button.dataset.fmt);
    }
    noteText.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const what = ctrl && !e.altKey && (!e.shiftKey ? { KeyB: "bold", KeyI: "italic", KeyU: "underline" }[e.code]
                                                      : { KeyX: "strike", Digit8: "list" }[e.code]);
      if (what) { e.preventDefault(); e.stopPropagation(); noteFormat(what); }
    });
    noteText.addEventListener("paste", (e) => {
      const html = e.clipboardData?.getData("text/html"), plain = e.clipboardData?.getData("text/plain");
      e.preventDefault();
      if (html) document.execCommand("insertHTML", false, MimickSticky.pasteable(html));
      else if (plain) document.execCommand("insertText", false, plain);
    });
    document.addEventListener("selectionchange", () => {
      if (!dialog.open) return;
      const sel = getSelection();
      if (sel.rangeCount && noteText.contains(sel.anchorNode)) noteRange = sel.getRangeAt(0).cloneRange();
      showNoteFormat();
    });

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
        noteText.focus();
      };
      grip.addEventListener("pointerup", drop);
      grip.addEventListener("pointercancel", drop);
      grip.addEventListener("dblclick", () => {
        ctx.remember("mimick-note-box", "");
        placeEditor();
        noteText.focus();
      });
      addEventListener("resize", () => { if (dialog.open && dialog.classList.contains("moved")) placeEditor(); });
    }

    function paintSwatches() {
      const row = $("note-colours");
      row.replaceChildren();
      for (const { name, value } of palette()) {
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
      if (!drafting) return;
      drafting.note = notePlain();
      drafting.html = noteText.innerHTML;
      drafting.title = $("note-title").value.trim();
      showNoteFormat();
      refreshAll();
    }
    noteText.addEventListener("input", drafted);
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
        await set(item.xref, draft.note, draft.title, draft.colour, draft.html);
        const now = find(item.xref);
        const after = now ? [now.note, now.title, now.colour, now.rich || plainHtml(now.note)] : job.before;
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

    // A note's size at this zoom, in pixels: the cards and Note appearance's
    // sample alike. Its points are the page's, as its text and the stickies.
    const shownSize = (size) => Math.max(8, Math.min(53, size * ctx.zoom()));
    function renderCards() {
      const cards = $("cards");
      const pages = ctx.pagesShown();
      panelPages = pages.join();
      const scroll = cards.scrollTop;
      cards.replaceChildren();
      cards.style.fontSize = shownSize(settings.size) + "px";
      cards.style.fontFamily = settings.font ? `"${settings.font}", system-ui, sans-serif` : "";
      const hidden = settings.hiddenColours;
      const wanted = (i) => drafting?.xref === i.xref
        || ((isSticky(i) ? settings.stickies : i.note ? settings.written : settings.quotes) && !hidden.includes(colourName(i)));
      // Find in notes: the whole document's notes with the words, wherever they are.
      const query = searching();
      cards.classList.toggle("searching", !!query);
      const onPage = query ? everything().filter((i) => wanted(i) && matches(i, query))
        : everything().filter((i) => pages.includes(i.page) && wanted(i));
      for (const item of onPage) cards.append(card(item));
      if (query && !onPage.length) cards.append(el("div", { className: "none", textContent: `No notes with “${$("notes-find").value.trim()}”` }));
      cards.scrollTop = scroll;
      connect();
    }

    /* What is typed in Find in notes, as it is matched, or "". */
    const searching = () => flat($("notes-find").value).toLowerCase();
    /* Whether a note has the words: its title, its note, the passage, a sticky's words. */
    function matches(item, query) {
      const words = isSticky(item) ? [item.title, item.text] : [item.title, item.note, item.text];
      return words.some((w) => flat(w).toLowerCase().includes(query));
    }
    /* A found card's page, since it may be pages from what is on screen. */
    function wherePage(node, item) {
      if (searching()) node.append(el("div", { className: "where", textContent: `Page ${item.page + 1}` }));
    }

    function stickyCard(item) {
      const picked = item.xref === active;
      const linked = linkedHighlights(item), on = linked[0] ?? null;
      const node = el("div", { className: "note-card sticky-card" + (picked ? " picked" : "") + (item.folded ? " folded" : "")
                                          + (on ? " attached" : "") + (partner(item) ? " partner" : "") });
      node.dataset.xref = item.xref;
      node.style.setProperty("--accent", css(item.colour));
      wherePage(node, item);
      // 📌 tells a sticky's card from a note's at a glance (Kat, 15 October).
      const heading = el("div", { className: "heading", textContent: `📌 ${item.title || "Sticky note"}` });
      heading.title = "Double-click to give it a title";
      heading.ondblclick = (e) => { e.stopPropagation(); ctx.scrollToPoint(item.page, item.top); setTimeout(() => sticky.editTitle(item)); };
      node.append(heading);
      if (on) {
        const more = linked.length > 1 ? ` and ${linked.length - 1} more` : "";
        node.append(el("div", { className: "on", textContent: `On “${preview(on).slice(0, 60)}”${more}` }));
      }
      const body = el("div", { className: "body rich" });
      // The worker's clean_rich made this, and it holds nothing but words, <p>,
      // <ul>, <li>, <b>, <i>, <u>, <s> and a font size -- so it can be shown.
      body.innerHTML = flat(item.text) ? richShown(item.rich) : "<p><i>Empty</i></p>";
      node.append(body);
      if (picked) {
        const badge = el("button", { className: "remove", type: "button", title: "Delete this sticky note", textContent: "×" });
        badge.onclick = (e) => { e.stopPropagation(); sticky.remove(item); };
        node.append(badge);
      }
      node.onclick = () => { pick(item); ctx.scrollToPoint(item.page, item.top); };
      node.ondblclick = () => { ctx.scrollToPoint(item.page, item.top); setTimeout(() => sticky.focus(item)); };
      node.oncontextmenu = (e) => { e.preventDefault(); pick(item); ctx.showMenu(e.clientX, e.clientY, sticky.menuItems(item)); };
      return node;
    }

    function card(item) {
      if (isSticky(item)) return stickyCard(item);
      const look = shown(item), picked = item.xref === active;
      const node = el("div", { className: "note-card" + (picked ? " picked" : "") + (partner(item) ? " partner" : "") });
      node.dataset.xref = item.xref;
      node.style.setProperty("--accent", css(look.colour));
      wherePage(node, item);
      if (look.title) node.append(el("div", { className: "heading", textContent: look.title }));
      // While the editor is open the card shows the plain words as typed;
      // otherwise the note as saved, formatted if it is. clean_rich made it.
      const formatted = item.rich && !(drafting && drafting.xref === item.xref);
      const body = formatted ? el("div", { className: "body rich" })
        : look.note ? el("div", { className: "body", textContent: look.note })
        : el("div", { className: "body quote", textContent: preview(item) });
      if (formatted) body.innerHTML = richShown(item.rich);
      node.append(body);
      if (picked) {
        const badge = el("button", { className: "remove", type: "button", title: "Delete this highlight", textContent: "×" });
        badge.onclick = (e) => { e.stopPropagation(); remove(item); };
        node.append(badge);
      }
      node.onclick = () => {
        pick(item);
        // A found card may be pages away from what is on screen.
        if (searching()) ctx.scrollToPoint(item.page, item.top);
      };
      node.ondblclick = () => edit(item);
      node.oncontextmenu = (e) => { e.preventDefault(); pick(item); ctx.showMenu(e.clientX, e.clientY, menuItems(item)); };
      return node;
    }

    /* My own order, in Export notes: a row dragged onto another goes before
     * or after it, whichever half it was dropped on, and that order is kept. */
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
        for (const n of $("export-list").children) n.classList.remove("dragging", "drop-before", "drop-after");
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
        showOrderList();
      });
    }

    /* A line from each highlight out to its card. */
    function connect() {
      const svg = $("connectors");
      svg.replaceChildren();
      if (!doc || !settings.panel || searching()) return;
      const main = svg.getBoundingClientRect(), cards = $("cards").getBoundingClientRect();
      const viewBox = ctx.view.getBoundingClientRect();
      for (const node of $("cards").children) {
        const item = findAny(Number(node.dataset.xref));
        const rect = item && (isSticky(item) ? item.rect : item.rects[0]);
        if (!rect) continue;
        const box = node.getBoundingClientRect();
        const y2 = box.top + 14;
        if (y2 < cards.top || y2 > cards.bottom) continue;
        const from = ctx.pageRectToClient(item.page, isSticky(item) ? [rect[0], rect[1], rect[2], rect[1] + 14 / ctx.zoom()] : rect);
        if (!from || from.top > viewBox.bottom || from.bottom < viewBox.top) continue;
        const x1 = Math.min(from.right + 2, viewBox.right - 2);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        Object.entries({ x1: x1 - main.left, y1: (from.top + from.bottom) / 2 - main.top,
                         x2: box.left - 4 - main.left, y2: y2 - main.top }).forEach(([k, v]) => line.setAttribute(k, v));
        line.setAttribute("stroke", css(isSticky(item) ? item.colour : shown(item).colour, 120 / 255));
        svg.append(line);
      }
    }
    $("cards").addEventListener("scroll", connect, { passive: true });

    function pageShown() {
      if (!settings.panel) return;
      if (ctx.pagesShown().join() !== panelPages && !searching()) renderCards();
      else connect();
    }

    function refreshControls() {
      const has = !!doc && ready;
      const written = items.filter((i) => i.note).length, quotes = items.length - written;
      $("filter-quotes").textContent = `Highlights${quotes ? "  " + quotes : ""}`;
      $("filter-notes").textContent = `Notes${written ? "  " + written : ""}`;
      $("filter-quotes").setAttribute("aria-pressed", settings.quotes);
      $("filter-notes").setAttribute("aria-pressed", settings.written);
      const stuck = sticky.list.length;
      $("filter-sticky").textContent = `Sticky${stuck ? "  " + stuck : ""}`;
      $("filter-sticky").setAttribute("aria-pressed", settings.stickies);
      showColourChips();
      for (const id of ["prev-note", "next-note"]) $(id).disabled = !(items.length + stuck);
      $("note-count").textContent = [items.length ? plural(items.length, "note") : "", stuck ? plural(stuck, "sticky") : ""]
        .filter(Boolean).join(" · ");
      $("notes-foot").hidden = !(has && (items.length || stuck));
      showPieces();
      $("markup-sticky").disabled = !has;
      showFormat();
      for (const id of ["markup-highlight", "markup-colour", "markup-note"]) $(id).disabled = !has;
      $("markup-colour").style.setProperty("--swatch", css(usable(colour)));
    }

    function refreshAll() {
      ctx.redraw();
      refreshControls();
      if (settings.panel) renderCards();
      else $("connectors").replaceChildren();
    }

    $("filter-quotes").onclick = () => { ctx.remember("mimick-panel-quotes", settings.quotes ? "0" : "1"); refreshAll(); };
    $("filter-notes").onclick = () => { ctx.remember("mimick-panel-notes", settings.written ? "0" : "1"); refreshAll(); };
    $("filter-sticky").onclick = () => { ctx.remember("mimick-panel-sticky", settings.stickies ? "0" : "1"); refreshAll(); };

    /* Show by colour: a toggle for each colour of the palette, always there
     * (Kat, 19 October), lit while shown, as the chips above it are. One with
     * nothing in it is off until something is. */
    let chipsShown = "";
    function showColourChips() {
      const box = $("filter-colours");
      const used = new Set([...items, ...sticky.list].map(colourName));
      const names = palette().map((p) => p.name);
      const hidden = settings.hiddenColours;
      // Kept when nothing changed, so a chip keeps the focus it was clicked with.
      const now = names.map((n) => n + (!used.has(n) ? "0" : hidden.includes(n) ? "-" : "+")).join();
      if (now === chipsShown) return;
      chipsShown = now;
      box.replaceChildren(...names.map((name) => {
        const inUse = used.has(name), shownNow = inUse && !hidden.includes(name);
        const value = palette().find((p) => p.name === name)?.value;
        const chip = el("button", { type: "button", className: "colour-chip", disabled: !inUse,
                                    title: `${name}: ${!inUse ? "nothing in this colour yet" : shownNow ? "shown — click to hide" : "hidden — click to show"}` });
        chip.setAttribute("aria-label", name);
        chip.setAttribute("aria-pressed", shownNow);
        chip.style.setProperty("--swatch", value ? css(value) : "var(--dim)");
        chip.onclick = () => {
          const next = shownNow ? [...hidden, name] : hidden.filter((n) => n !== name);
          ctx.remember("mimick-panel-hidden-colours", JSON.stringify(next));
          refreshAll();
          ctx.status(`${name} ${shownNow ? "hidden from" : "shown in"} the notes panel`);
        };
        return chip;
      }));
    }

    $("notes-find").addEventListener("input", () => {
      renderCards();
      const query = searching();
      if (query) {
        const found = $("cards").querySelectorAll(".note-card").length;
        ctx.status(found ? `${plural(found, "note")} with “${$("notes-find").value.trim()}”` : "No notes have those words");
      }
    });
    $("notes-find").addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if ($("notes-find").value) { $("notes-find").value = ""; renderCards(); }
      else ctx.focusPage();
    });
    $("prev-note").onclick = () => step(-1);
    $("next-note").onclick = () => step(1);
    $("notes-download").onclick = () => download();

    function setPanel(on) {
      ctx.remember("mimick-notes-panel", on ? "1" : "0");
      panel.hidden = !on;
      $("notes-tab").hidden = on;
      // A strip in the panel goes away with it, and comes back with it: it
      // stays wherever it was last put (Kat, 1 October). Ctrl+H and Ctrl+M
      // still work without it.
      ctx.status(on ? "Notes panel shown" : "Notes panel hidden");
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
      $("style-sample").style.fontFamily = $("style-font").value.trim() ? `"${$("style-font").value.trim()}", system-ui, sans-serif` : "";
      $("style-sample").style.fontSize = shownSize(size >= 6 && size <= 24 ? size : 9) + "px";
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

    $("markup-highlight").onclick = () => { highlight(false); ctx.focusPage(); };
    $("markup-note").onclick = () => { highlight(true); };
    $("markup-colour").onclick = (e) => {
      const box = e.currentTarget.getBoundingClientRect();
      ctx.showMenu(box.left, box.bottom + 4, palette().map(({ name, value }) => ({
        label: name, swatch: css(value), checked: sameColour(value, usable(colour)),
        run: () => { colour = value; refreshControls(); },
      })));
    };

    // + Add sticky puts one on the page on screen, to be dragged where it goes
    // (Kat, 1 October: no "click where it goes" step). Its colour, and the row
    // that formats the sticky being typed in: a press on one of these must not
    // take the cursor out of the sticky, so none of them takes focus; the size
    // box does, and hands it straight back.
    $("markup-sticky").onclick = () => sticky.addOnScreen();
    const FORMATS = { "fmt-bold": "bold", "fmt-italic": "italic", "fmt-underline": "underline",
                      "fmt-strike": "strike", "fmt-list": "list" };
    for (const [id, what] of Object.entries(FORMATS)) {
      $(id).addEventListener("pointerdown", (e) => e.preventDefault());
      $(id).onclick = () => sticky.format(what);
    }
    const sizeBox = $("fmt-size");
    for (const size of sticky.SIZES) sizeBox.append(el("option", { value: size, textContent: size }));
    sizeBox.onchange = () => sticky.format("size", sizeBox.value);
    $("sticky-colour").addEventListener("pointerdown", (e) => e.preventDefault());
    $("sticky-colour").onclick = (e) => {
      const box = e.currentTarget.getBoundingClientRect();
      const item = activeSticky();
      const now = item?.colour ?? usable(settings.stickyColour);
      ctx.showMenu(box.left, box.bottom + 4, palette().map(({ name, value }) => ({
        label: name, swatch: css(value), checked: sameColour(value, now),
        run: () => {
          ctx.remember("mimick-sticky-colour", JSON.stringify(value));
          if (item) sticky.format("colour", value);
          else ctx.status(`New sticky notes will be ${name.toLowerCase()}`);
          refreshControls();
        },
      })));
    };
    function showFormat() {
      const state = sticky.formatState();
      $("markup-format").classList.toggle("live", state.editing);
      for (const [id, what] of Object.entries(FORMATS)) {
        $(id).disabled = !state.editing;
        $(id).setAttribute("aria-pressed", !!state[what]);
      }
      sizeBox.disabled = !state.editing;
      if (state.editing && document.activeElement !== sizeBox) {
        const near = sticky.SIZES.reduce((a, b) => (Math.abs(b - state.size) < Math.abs(a - state.size) ? b : a));
        sizeBox.value = near;
      }
      $("sticky-colour").style.setProperty("--swatch", css(state.colour ?? activeSticky()?.colour ?? usable(settings.stickyColour)));
      $("sticky-colour").disabled = !ready;
    }

    function setSticky(on) {
      ctx.remember("mimick-sticky", on ? "1" : "0");
      refreshControls();
      ctx.status(on ? "Sticky notes: + Add sticky and its formatting are on the Highlight / Add note strip"
                    : "+ Add sticky is off the strip — the sticky notes on the page stay where they are");
    }

    const piece = (name) => $(`piece-${name}`);
    const hostOf = (place) => place === "panel" ? $("markup-panel") : place === "contents" ? $("markup-contents")
      : place === "float" ? $("main") : $(`markup-${place.split("-")[0]}`).querySelector(`[data-slot="${place.split("-")[1]}"]`);
    const shapeOf = (place) => (place === "panel" || place === "contents" ? "column" : place === "float" ? "float" : "row");
    const contentsShown = () => !$("contents").hidden;

    /* Where a piece is shown just now. One in the contents column goes away
     * with it and comes back with it, as one in the notes panel does; but a
     * document with no contents has no column to bring back, so there it
     * stands in at the top left. */
    function where(name) {
      const place = settings.place(name);
      if (place === "contents" && !contentsShown() && !$("contents-tab").hidden && $("contents-tab").disabled) return "top-left";
      return place;
    }

    /* Put a piece in a place; keep = remember it there. In a shared place the
     * pieces keep the reader's order (settings.order). */
    function mount(name, place, point = null, keep = false) {
      const el = piece(name), host = hostOf(place), names = settings.order(place);
      const next = names.slice(names.indexOf(name) + 1).map(piece).find((p) => p.parentElement === host);
      if (el.parentElement !== host || (next && el.nextElementSibling !== next)) host.insertBefore(el, next ?? null);
      el.dataset.home = place;
      el.dataset.shape = shapeOf(place);
      el.style.width = "";
      if (place === "float") {
        const [x, y] = inside(el, ...(point ?? floatPoint(name)));
        if (keep) ctx.remember(`mimick-point-${name}`, JSON.stringify([x, y]));
        Object.assign(el.style, { left: x + "px", top: y + "px" });
      } else {
        el.style.left = el.style.top = "";
      }
      if (keep) ctx.remember(`mimick-place-${name}`, place);
    }
    function floatPoint(name) {
      try {
        const kept = JSON.parse(ctx.recall(`mimick-point-${name}`) || "null");
        if (Array.isArray(kept)) return kept;
        const [x, y] = JSON.parse(ctx.recall("mimick-markup-point") || "[24, 24]");
        return [x, y + 52 * Object.keys(PIECES).indexOf(name)];
      } catch { return [24, 24]; }
    }

    /* Which pieces show, and which bars and docks have anything in them. */
    function showPieces() {
      for (const name of Object.keys(PIECES)) piece(name).hidden = !settings.bar || (name !== "mark" && !settings.sticky);
      const filled = (box) => [...box.querySelectorAll(".piece")].some((p) => !p.hidden);
      for (const id of ["markup-top", "markup-bottom", "markup-contents", "markup-panel"]) $(id).hidden = !filled($(id));
    }

    function arrange() {
      for (const name of Object.keys(PIECES)) if (!piece(name).classList.contains("dragging")) mount(name, where(name));
      showPieces();
    }

    function placePiece(name, place, point = null, announce = false) {
      if (place === "panel" && !settings.panel && announce) setPanel(true);
      mount(name, place, point, true);
      showPieces();
      if (announce) {
        ctx.status(`${PIECES[name]} ${name === "mark" || name === "format" ? "are" : "is"} ${PLACES[place]}`
                   + (place === "float" ? " — drag its ⋯ to put it back" : ""));
      }
      ctx.relayout();
      connect();
    }

    function placeAll(home) {
      if (home === "panel" && !settings.panel) setPanel(true);
      Object.keys(PIECES).forEach((name, i) => mount(name, homePlace(home, name), home === "float" ? [24, 24 + 52 * i] : null, true));
      showPieces();
      ctx.status(`The editing buttons are ${{ top: "across the top", bottom: "across the bottom" }[home] ?? PLACES[home]}`);
      ctx.relayout();
      connect();
    }

    /* A point for a loose piece's corner, moved as little as will keep all
     * of it inside the reading area. */
    function inside(el, x, y) {
      const main = $("main");
      return [Math.max(0, Math.min(x, main.clientWidth - el.offsetWidth)),
              Math.max(0, Math.min(y, main.clientHeight - el.offsetHeight))];
    }

    /* Put the loose pieces where they were left, or as near as the window now
     * allows. What is remembered is where they were left, so a window made
     * small for a moment does not move them for good. */
    function keepInside() {
      for (const name of Object.keys(PIECES)) {
        const el = piece(name);
        if (el.dataset.home !== "float" || el.classList.contains("dragging")) continue;
        const [x, y] = inside(el, ...floatPoint(name));
        Object.assign(el.style, { left: x + "px", top: y + "px" });
      }
    }

    function setBar(on) {
      // Asked for while they are all in a closed panel: the panel opens to show them.
      if (settings.bar && !settings.panel && Object.keys(PIECES).every((n) => where(n) === "panel")) { setPanel(true); return; }
      ctx.remember("mimick-markup-shown", on ? "1" : "0");
      arrange();
      ctx.relayout();
      ctx.status(on ? "Highlight and Add note shown" : "Highlight and Add note hidden — Ctrl+H and Ctrl+M still work");
    }

    // Dragging. A piece comes loose where it already is, so it does not jump
    // under the pointer, and follows it; where it is let go decides its place.
    let dragging = null;         // { name, dx, dy, from, x, y, moved }
    // A piece is taken out and put back as it is pressed, so the browser never
    // sees a click on its ⋯, or a double-click: two presses that do not move
    // it are counted here instead.
    let lastTap = null;          // { name, at }
    // The top and bottom edges are split in three: left, middle, right (Kat,
    // 19 October). Below and above them, anywhere over a side column, or just
    // short of it, is that column -- the whole side, not a target to hit
    // exactly (Kat, 1 October) -- but only while it is open.
    const aim = (x, y) => {
      const main = $("main").getBoundingClientRect();
      const third = x < main.left + main.width / 3 ? "left" : x < main.left + main.width * 2 / 3 ? "middle" : "right";
      const column = settings.panel && !panel.hidden && x >= panel.getBoundingClientRect().left - SNAP_MARGIN / 2 ? "panel"
        : contentsShown() && x <= $("contents").getBoundingClientRect().right + SNAP_MARGIN / 2 ? "contents" : null;
      // Over a column only its very ends are the bars, so the column still
      // reaches down to its foot.
      const edge = column ? SNAP_MARGIN / 2 : SNAP_MARGIN;
      if (y - main.top <= edge) return "top-" + third;
      if (main.bottom - y <= edge) return "bottom-" + third;
      return column ?? "float";
    };
    // While dragging over a place it docks, the piece snaps there in the shape
    // it will have, outlined, with a label saying so (Kat, 1 October; the
    // words hers, 20 October). Off it again, it follows the pointer, loose.
    const label = el("div", { id: "markup-ghost", hidden: true });
    document.body.append(label);
    // Over a place that has pieces already, the others make room where it
    // would go -- before the first one whose middle is past the pointer -- so
    // a piece can be put first, last or between (Kat, 20 October).
    const spacer = el("div", { className: "piece-spacer" });
    function makeRoom(it, place, x, y) {
      spacer.remove();
      const host = hostOf(place), row = shapeOf(place) === "row";
      if (host.closest(".strip, .dock").hidden) return null;
      const others = [...host.children].filter((p) => p.classList.contains("piece") && !p.hidden && p !== it);
      if (!others.length) return null;
      const before = others.find((p) => {
        const b = p.getBoundingClientRect();
        return row ? x < b.left + b.width / 2 : y < b.top + b.height / 2;
      });
      spacer.style.width = row ? it.offsetWidth + "px" : "";
      spacer.style.height = row ? "1px" : it.offsetHeight + "px";
      host.insertBefore(spacer, before ?? null);
      return spacer.getBoundingClientRect();
    }
    /* Dropped where the room was made: that is its place in the order there. */
    function keepOrder(name, place) {
      const host = hostOf(place);
      if (spacer.parentElement !== host) return;
      // The piece being dragged is out of its place meanwhile (pointerdown).
      const list = [...host.children].map((p) => (p === spacer ? name : p.dataset.piece)).filter(Boolean);
      ctx.remember(`mimick-order-${place}`, JSON.stringify([...list, ...settings.order(place).filter((n) => !list.includes(n))]));
    }
    function snap(it, place, x, y) {
      it.dataset.shape = shapeOf(place);
      if (place === "float") { it.style.width = ""; label.hidden = true; spacer.remove(); return false; }
      const main = $("main").getBoundingClientRect();
      let left, top;
      if (place === "panel" || place === "contents") {
        const column = (place === "panel" ? panel : $("contents")).getBoundingClientRect();
        it.style.width = column.width + "px";
        left = column.left - main.left;
        // Where its dock begins, whether or not anything is in it yet.
        const room = makeRoom(it, place, x, y);
        top = room ? room.top - main.top
          : hostOf(place).previousElementSibling.getBoundingClientRect().bottom + (place === "panel" ? 6 : 0) - main.top;
      } else {
        const [edge, slot] = place.split("-");
        it.style.width = "";
        const room = makeRoom(it, place, x, y);
        left = room ? room.left - main.left
          : slot === "left" ? 14 : slot === "middle" ? (main.width - it.offsetWidth) / 2 : main.width - it.offsetWidth - 14;
        top = edge === "top" ? 0 : main.height - it.offsetHeight;
      }
      Object.assign(it.style, { left: left + "px", top: top + "px" });
      const box = it.getBoundingClientRect(), low = place.startsWith("bottom");
      label.textContent = "Drag and drop here.";
      label.hidden = false;
      label.dataset.home = place;
      label.dataset.edge = low ? "bottom" : "top";
      Object.assign(label.style, { left: box.left + box.width / 2 + "px", top: (low ? box.top - 6 : box.bottom + 6) + "px" });
      return true;
    }
    for (const name of Object.keys(PIECES)) {
      const it = piece(name), grip = $(`grip-${name}`);
      grip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const box = it.getBoundingClientRect(), main = $("main").getBoundingClientRect();
        dragging = { name, dx: e.clientX - box.left, dy: e.clientY - box.top, from: it.dataset.home,
                     x: e.clientX, y: e.clientY, moved: false };
        it.classList.add("dragging");
        if (it.dataset.home !== "float") {
          $("main").append(it);
          it.dataset.home = it.dataset.shape = "float";
          showPieces();
          ctx.relayout();
        }
        Object.assign(it.style, { left: box.left - main.left + "px", top: box.top - main.top + "px" });
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener("pointermove", (e) => {
        if (dragging?.name !== name) return;
        dragging.moved ||= Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) > 4;
        if (!dragging.moved) return;
        it.dataset.aim = aim(e.clientX, e.clientY);
        if (snap(it, it.dataset.aim, e.clientX, e.clientY)) return;
        const main = $("main").getBoundingClientRect();
        const [x, y] = inside(it, e.clientX - dragging.dx - main.left, e.clientY - dragging.dy - main.top);
        Object.assign(it.style, { left: x + "px", top: y + "px" });
      });
      const endDrag = (e) => {
        if (dragging?.name !== name) return;
        const { from, moved } = dragging;
        dragging = null;
        it.classList.remove("dragging");
        delete it.dataset.aim;
        label.hidden = true;
        if (!moved) {
          spacer.remove();
          // A press, not a drag: it stays where it was. A second one soon
          // after puts it back where it started.
          const again = lastTap?.name === name && e.timeStamp - lastTap.at < 450;
          lastTap = again ? null : { name, at: e.timeStamp };
          if (again) placePiece(name, DEFAULT_PLACES[name], null, true);
          else { mount(name, from); showPieces(); ctx.relayout(); }
          return;
        }
        lastTap = null;
        const place = aim(e.clientX, e.clientY);
        if (place !== "float") keepOrder(name, place);
        spacer.remove();
        placePiece(name, place, place === "float" ? [parseFloat(it.style.left), parseFloat(it.style.top)] : null, true);
      };
      grip.addEventListener("pointerup", endDrag);
      grip.addEventListener("pointercancel", endDrag);
    }
    new ResizeObserver(keepInside).observe($("main"));
    // The contents column opening or closing, or a document with none, moves
    // what was put in it.
    const contentsMoved = new MutationObserver(() => { if (!dragging) { arrange(); ctx.relayout(); } });
    contentsMoved.observe($("contents"), { attributes: true, attributeFilter: ["hidden"] });
    contentsMoved.observe($("contents-tab"), { attributes: true, attributeFilter: ["hidden", "disabled"] });

    // --- menus -------------------------------------------------------------------

    function notesMenu() {
      const picked = activeItem();
      return [
        { label: "Copy", keys: "Ctrl+C", enabled: !!(ctx.selection() || picked), run: () => ctx.copy() },
        { label: "Highlight selection", keys: "Ctrl+H", enabled: ready, run: () => highlight(false) },
        { label: "Highlight and write a note…", keys: "Ctrl+M", enabled: ready, run: () => highlight(true) },
        { label: "Add a sticky note", keys: "Ctrl+Alt+M", enabled: ready, run: () => sticky.addAtCaret() },
        "-",
        { label: "Go to next note", keys: "Ctrl+J", enabled: items.length + sticky.list.length > 0, run: () => step(1) },
        { label: "Go to previous note", keys: "Ctrl+K", enabled: items.length + sticky.list.length > 0, run: () => step(-1) },
        "-",
        { label: "Undo the last highlight or note", keys: "Ctrl+Z", enabled: undoStack.length > 0, run: undo },
        { label: "Redo it", keys: "Ctrl+Y", enabled: redoStack.length > 0, run: redo },
        "-",
        { label: "Save a copy with your notes (PDF)…", keys: "Ctrl+S", enabled: ready, run: download },
        { label: "Export notes…", enabled: ready && items.length + sticky.list.length > 0, run: exportNotes },
        { label: `Remind me to save every ${REMIND_MINUTES} minutes`, checked: remindOn(), run: () => {
          ctx.remember("mimick-save-reminder", remindOn() ? "0" : "1");
          if (!remindOn()) ctx.unask("save");
          ctx.status(remindOn() ? `Mimick will remind you to save a copy when your notes have gone ${REMIND_MINUTES} minutes without one`
                                : "No more reminders to save — the status bar still says when your work is not in a file");
        } },
      ];
    }

    function displayMenu() {
      return [
        { label: "Notes panel", keys: "Ctrl+B", checked: settings.panel, run: () => setPanel(!settings.panel) },
        { label: "Show highlights in the panel", checked: settings.quotes, run: () => $("filter-quotes").click() },
        { label: "Show notes in the panel", checked: settings.written, run: () => $("filter-notes").click() },
        { label: "Show sticky notes in the panel", checked: settings.stickies, run: () => $("filter-sticky").click() },
        // Here rather than as ⚙ in the panel, to give its colours room (Kat, 20 October).
        { label: "Note appearance…", run: chooseStyle },
        "-",
        { label: "Sticky notes", checked: settings.sticky, run: () => setSticky(!settings.sticky) },
        { label: "Highlight and note buttons", keys: "Ctrl+Shift+H", checked: settings.bar, run: () => setBar(!settings.bar) },
        ...Object.entries(HOMES).map(([home, label]) => ({
          label, indent: true, checked: Object.keys(PIECES).every((name) => settings.place(name) === homePlace(home, name)),
          run: () => placeAll(home),
        })),
      ];
    }

    $("notes-menu").onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(); ctx.showMenu(b.left, b.bottom + 4, notesMenu()); };

    panel.hidden = !settings.panel;
    $("notes-tab").hidden = settings.panel;
    // The panel's own › puts it away; the tab on the page's right edge brings it back.
    $("notes-hide").onclick = () => { setPanel(false); ctx.focusPage(); };
    $("notes-tab").onclick = () => setPanel(true);
    arrange();
    refreshControls();
    MimickNotesStore.prune(RECOVER_DAYS * 864e5);

    return {
      COLOURS,
      open, close, draw, at, pick, highlight, edit, remove, step, undo, redo, copy, download: () => download(),
      downloadSmaller: () => download("smaller"), exportNotes, exportAs, menuItems,
      pageShown, connect, refreshAll, displayMenu, sticky,
      /* Find went to a match in a sticky: bring it on screen and pick it out. */
      showSticky(xref) {
        const item = sticky.list.find((s) => s.xref === xref);
        if (!item) return;
        ctx.scrollToPoint(item.page, item.top);
        active = null;
        pick(item);
      },
      togglePanel: () => setPanel(!settings.panel),
      toggleSticky: () => setSticky(!settings.sticky),
      get stickyOn() { return settings.sticky; },
      toggleBar: () => setBar(!settings.bar),
      get active() { return activeItem(); },
      get ready() { return ready; },
      get count() { return items.length + sticky.list.length; },
      get editing() { return dialog.open || styleDialog.open; },
      get opening() { return opening; },
      get linking() { return linking !== null; },
      stopLinking: () => stopLinking(),
    };
  }

  root.MimickNotes = { create };
})(typeof self !== "undefined" ? self : globalThis);
