/* Sticky notes: rich-text boxes on the page, typed into where they sit.
 *
 * Kat asked for them on 29 September 2026: a note that is part of the PDF,
 * the way a text box is in Acrobat -- moved and resized while you work, saved
 * in place, and still editable when the saved copy is opened again. Each is a
 * FreeText annotation made by the desktop's annotations.py in the document
 * worker (reader.stickies, sticky_add, sticky_set, sticky_remove); every
 * change comes back as the whole list, as highlights do.
 *
 * The box on the page is only the words. Their size, bold, italics,
 * underline, strikeout, list and colour are on the Highlight / Add note strip
 * (js/notes.js), which lights up while a sticky has the cursor; the usual keys
 * work in the box itself.
 *
 * Words on a sticky are in points on the page, so they grow and shrink with
 * the zoom like the document's own: a size is kept as `font-size: 18pt` and
 * shown as `calc(18 * var(--pt))`, where --pt is a point in pixels.
 *
 *   const sticky = MimickSticky.create(ctx)    ctx: see notes.js, "sticky notes"
 *   sticky.set(list) / sticky.list             the worker's list
 *   sticky.draw(page, el)                      put the page's stickies on it
 *   sticky.at(page, x, y)                      the sticky under a point, or null
 *   sticky.place() / placing / placeAt(at)     + Add sticky, then a click
 *   sticky.addAtCaret()                        Ctrl+Alt+M
 *   sticky.focus(item) / remove(item) / menuItems(item)
 *   sticky.format(what, value)                 from the strip
 */
(function (root) {
  "use strict";

  const SIZE = 11;                                   // annotations.STICKY_SIZE
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];   // annotations.STICKY_SIZES
  const MIN = 36;                                    // annotations.STICKY_MIN, points
  const COMMIT_MS = 600;
  const BIG = 7;                                     // execCommand's marker size, swapped for a real one

  const css = ([r, g, b]) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  const darker = ([r, g, b]) => css([r * 0.72, g * 0.72, b * 0.72]);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const shown = (rich) => (rich || "").replace(/font-size:\s*([\d.]+)pt/g, "font-size: calc($1 * var(--pt))");
  const kept = (html) => html.replace(/font-size:\s*calc\(\s*([\d.]+)\s*\*\s*var\(--pt\)\s*\)/g, "font-size:$1pt");
  const flat = (text) => (text || "").split(/\s+/).filter(Boolean).join(" ");

  /* Pasted HTML, rebuilt from nothing but its words and the few tags a sticky
   * can hold -- never the page's own markup, which could carry anything. */
  const KEEP = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s",
                 P: "p", DIV: "div", LI: "li", UL: "ul", OL: "ul", BR: "br" };
  function pasteable(html) {
    const source = new DOMParser().parseFromString(html, "text/html").body;
    const copy = (node, into) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { into.append(child.textContent); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|HEAD|TITLE|TEMPLATE)$/.test(child.tagName)) continue;
        const tag = KEEP[child.tagName];
        if (!tag) { copy(child, into); continue; }
        const made = document.createElement(tag);
        into.append(made);
        if (tag !== "br") copy(child, made);
      }
    };
    const out = document.createElement("div");
    copy(source, out);
    return out.innerHTML;
  }

  function create(ctx) {
    let list = [];
    const boxes = new Map();         // xref -> { root, text, shownRich }
    let editing = null;              // { xref, before, fresh, box }
    let commitTimer = 0;
    let range = null;                // the selection in the sticky being typed in
    let placing = false;
    let pendingSize = null;
    // A sticky's xref changes each time an undo makes it again, so undo steps
    // hold an id of their own, which follows it to its newest xref.
    let nextId = 1;
    const idOf = new Map(), xrefOf = new Map();
    const idFor = (xref) => {
      if (!idOf.has(xref)) { idOf.set(xref, nextId); xrefOf.set(nextId, xref); nextId++; }
      return idOf.get(xref);
    };

    const find = (xref) => list.find((s) => s.xref === xref) ?? null;
    const zoom = () => ctx.zoom();

    // --- the list, and the boxes on the pages -----------------------------------

    function set(next) {
      list = next || [];
      for (const [xref, box] of boxes) {
        if (!find(xref) && !(editing && editing.xref === xref)) { box.root.remove(); boxes.delete(xref); }
      }
    }

    function boxFor(item) {
      let box = boxes.get(item.xref);
      if (box) return box;
      const rootEl = el("div", { className: "sticky" });
      rootEl.dataset.xref = item.xref;
      const grip = el("div", { className: "sticky-grip", title: "Drag to move this sticky note" });
      const fold = el("button", { type: "button", className: "sticky-fold", title: "Fold it away to a small tab",
                                  textContent: "▾" });
      const close = el("button", { type: "button", className: "sticky-delete", title: "Delete this sticky note",
                                   textContent: "×" });
      fold.setAttribute("aria-label", "Fold this sticky note");
      close.setAttribute("aria-label", "Delete this sticky note");
      grip.append(fold, close);
      const text = el("div", { className: "sticky-text", contentEditable: "true", spellcheck: true });
      text.setAttribute("role", "textbox");
      text.setAttribute("aria-multiline", "true");
      text.setAttribute("aria-label", "Sticky note");
      const corner = el("div", { className: "sticky-corner", title: "Drag to make it wider or taller" });
      const tab = el("button", { type: "button", className: "sticky-tab" });
      tab.setAttribute("aria-label", "Open this sticky note");
      rootEl.append(grip, text, corner, tab);
      box = { root: rootEl, text, shownRich: null, xref: item.xref };
      boxes.set(item.xref, box);

      fold.onclick = (e) => { e.stopPropagation(); setFolded(box.xref, true); };
      close.onclick = (e) => { e.stopPropagation(); const now = find(box.xref); if (now) remove(now); };
      tab.onclick = (e) => { e.stopPropagation(); setFolded(box.xref, false, true); };
      grip.addEventListener("pointerdown", (e) => startDrag(e, box, "move"));
      corner.addEventListener("pointerdown", (e) => startDrag(e, box, "size"));
      rootEl.addEventListener("contextmenu", (e) => {
        if (e.target.closest(".sticky-text")) { e.stopPropagation(); return; }      // the browser's own: spelling, paste
        e.preventDefault();
        e.stopPropagation();
        const now = find(box.xref);
        if (now) ctx.showMenu(e.clientX, e.clientY, menuItems(now));
      });
      rootEl.addEventListener("dblclick", (e) => e.stopPropagation());
      text.addEventListener("focus", () => startEditing(box));
      text.addEventListener("blur", () => setTimeout(() => leftBox(box)));
      text.addEventListener("input", () => { tidySizes(box); scheduleCommit(); ctx.formatChanged(); });
      text.addEventListener("keydown", (e) => keys(e, box));
      text.addEventListener("paste", (e) => {
        const html = e.clipboardData?.getData("text/html"), plain = e.clipboardData?.getData("text/plain");
        e.preventDefault();
        if (html) document.execCommand("insertHTML", false, pasteable(html));
        else if (plain) document.execCommand("insertText", false, plain);
      });
      return box;
    }

    /* Everything but the words is set on every draw, which is cheap; the words
     * only when they changed and nobody is typing in them. */
    function show(box, item) {
      const [w, h] = ctx.pageSize(item.page);
      const [x0, y0, x1, y1] = item.rect;
      const r = box.root;
      Object.assign(r.style, { left: `${x0 / w * 100}%`, top: `${y0 / h * 100}%`,
                               width: `${(x1 - x0) / w * 100}%`, minHeight: `${(y1 - y0) / h * 100}%` });
      r.style.setProperty("--pt", zoom() + "px");
      r.style.setProperty("--paper", css(item.colour));
      r.style.setProperty("--edge", darker(item.colour));
      r.classList.toggle("folded", !!item.folded);
      r.classList.toggle("picked", ctx.active() === item.xref);
      r.querySelector(".sticky-tab").title = `Sticky note: ${flat(item.text).slice(0, 80) || "empty"} — click to open`;
      if (box.shownRich !== item.rich && !(editing && editing.xref === item.xref)) {
        box.text.innerHTML = shown(item.rich);
        box.shownRich = item.rich;
      }
    }

    function draw(page, pageEl) {
      for (const item of list) {
        if (item.page !== page) continue;
        const box = boxFor(item);
        if (box.root.parentNode !== pageEl) pageEl.append(box.root);
        show(box, item);
      }
    }

    function at(page, x, y) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i], [x0, y0, x1, y1] = s.rect;
        if (s.page === page && x >= x0 && x <= x1 && y >= y0 && y <= y1) return s;
      }
      return null;
    }

    // --- talking to the worker, with undo ------------------------------------

    const apply = (result) => { set(result); };

    /* The sticky an undo step is about, whatever its xref is now. */
    const live = (id) => find(xrefOf.get(id));

    /* Make a sticky again from what was kept of it, as the same one. */
    async function make(snap, id) {
      const { xref, stickies } = await ctx.call("sticky_add", snap.page, snap.rect[0], snap.rect[1], snap.rich,
                                                snap.colour, snap.rect[2] - snap.rect[0]);
      idOf.set(xref, id);
      xrefOf.set(id, xref);
      apply(stickies);
      apply(await ctx.call("sticky_set", xref, null, snap.rect, null, !!snap.folded));
      return xref;
    }
    const snapOf = (item) => ({ page: item.page, rect: item.rect.slice(), rich: item.rich, colour: item.colour.slice(),
                               folded: item.folded });

    function rememberAdded(item) {
      const id = idFor(item.xref);
      let snap = snapOf(item);
      ctx.pushUndo("Sticky note removed", "Sticky note put back",
        async () => { const now = live(id); if (now) { snap = snapOf(now); apply(await ctx.call("sticky_remove", now.xref)); } },
        async () => { await make(snap, id); }, "sticky:" + item.xref);
    }
    function rememberRemoved(item) {
      const id = idFor(item.xref), snap = snapOf(item);
      ctx.pushUndo("Sticky note put back", "Sticky note deleted again",
        async () => { await make(snap, id); },
        async () => { const now = live(id); if (now) apply(await ctx.call("sticky_remove", now.xref)); });
    }
    function rememberChange(item, field, before, after, label) {
      const id = idFor(item.xref);
      const put = async (value) => {
        const now = live(id);
        if (!now) return;
        const args = { rich: null, rect: null, colour: null };
        args[field] = value;
        apply(await ctx.call("sticky_set", now.xref, args.rich, args.rect, args.colour, null));
        const box = boxes.get(now.xref);
        if (box && field === "rich") box.shownRich = null;       // shown afresh, not as typed
      };
      ctx.pushUndo(`${label} undone`, `${label} put back`, () => put(before), () => put(after));
    }

    // --- adding ----------------------------------------------------------------

    function place(on = !placing) {
      if (!ctx.ready()) return;
      placing = on;
      document.body.classList.toggle("placing-sticky", on);
      ctx.formatChanged();
      if (on) ctx.status("Click where the sticky note goes — Esc to stop");
      else ctx.status("");
    }

    function placeAt(at) {
      place(false);
      if (!at) return;
      add(at.page, at.x, at.y);
    }

    /* Ctrl+Alt+M: at the text cursor if there is one, or near the top of the
     * page on screen. */
    function addAtCaret() {
      if (!ctx.ready()) return;
      const spot = ctx.caretSpot() ?? ctx.viewSpot();
      if (!spot) return;
      add(spot.page, spot.x, spot.y);
    }

    function add(page, x, y) {
      ctx.change(async () => {
        const { xref, stickies } = await ctx.call("sticky_add", page, x, y, "", ctx.colour());
        apply(stickies);
        const item = find(xref);
        if (!item) return;
        rememberAdded(item);
        ctx.status("Sticky note added — type, and Esc when you are done. The strip's buttons format it");
        setTimeout(() => { const box = boxes.get(xref); if (box) { editing = null; focusBox(box, true); } });
      });
    }

    function remove(item) {
      if (!item) return;
      if (editing && editing.xref === item.xref) { clearTimeout(commitTimer); editing = null; }
      ctx.change(async () => {
        rememberRemoved(item);
        apply(await ctx.call("sticky_remove", item.xref));
        ctx.status("Sticky note deleted — Ctrl+Z puts it back");
      });
      ctx.focusPage();
    }

    function setFolded(xref, folded, thenFocus = false) {
      ctx.change(async () => {
        apply(await ctx.call("sticky_set", xref, null, null, null, folded));
        ctx.status(folded ? "Sticky note folded — click its tab to open it" : "Sticky note opened");
        if (thenFocus) setTimeout(() => { const box = boxes.get(xref); if (box) focusBox(box); });
      });
    }

    function focus(item) {
      if (!item) return;
      if (item.folded) { setFolded(item.xref, false, true); return; }
      const box = boxes.get(item.xref);
      if (box) focusBox(box);
    }
    function focusBox(box, fresh = false) {
      if (fresh) editing = { xref: box.xref, before: "", fresh: true, box };
      box.text.focus();
      const end = document.createRange();
      end.selectNodeContents(box.text);
      end.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(end);
    }

    // --- typing ------------------------------------------------------------------

    function startEditing(box) {
      if (editing && editing.xref === box.xref) return;
      finish();
      const item = find(box.xref);
      editing = { xref: box.xref, before: item?.rich ?? "", fresh: false, box };
      ctx.pick(item);
      ctx.formatChanged();
    }

    /* Focus went somewhere. To the strip's buttons, a size box or a menu it is
     * still being typed in; anywhere else, it is finished. */
    function leftBox(box) {
      if (!editing || editing.box !== box) return;
      const now = document.activeElement;
      if (box.text.contains(now) || now?.closest?.("#markup, #menu")) return;
      finish();
    }
    document.addEventListener("focusin", (e) => {
      if (editing && !editing.box.text.contains(e.target) && !e.target.closest?.("#markup, #menu")) finish();
    });

    const richOf = (box) => kept(box.text.innerHTML);

    function scheduleCommit() {
      clearTimeout(commitTimer);
      commitTimer = setTimeout(commit, COMMIT_MS);
    }
    function commit() {
      clearTimeout(commitTimer);
      if (!editing) return;
      const { xref, box } = editing, rich = richOf(box);
      ctx.change(async () => { apply(await ctx.call("sticky_set", xref, rich, null, null, null)); });
    }

    function finish() {
      if (!editing) return;
      const job = editing;
      editing = null;
      clearTimeout(commitTimer);
      range = null;
      const rich = richOf(job.box), empty = !flat(job.box.text.textContent);
      ctx.formatChanged();
      ctx.change(async () => {
        if (empty && job.fresh) {
          // A sticky opened and left without a word goes again, and so does its undo.
          ctx.dropUndo(job.xref);
          apply(await ctx.call("sticky_remove", job.xref));
          ctx.status("Empty sticky note removed");
          return;
        }
        const after = await ctx.call("sticky_set", job.xref, rich, null, null, null);
        apply(after);
        const now = find(job.xref);
        job.box.shownRich = null;
        if (now && !job.fresh && now.rich !== job.before) rememberChange(now, "rich", job.before, now.rich, "Sticky note change");
      });
    }

    document.addEventListener("selectionchange", () => {
      if (!editing) return;
      const s = getSelection();
      if (s.rangeCount && editing.box.text.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange();
      ctx.formatChanged();
    });

    function keys(e, box) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { e.preventDefault(); box.text.blur(); ctx.focusPage(); return; }
      if (ctrl && e.key === "Enter") { e.preventDefault(); box.text.blur(); ctx.focusPage(); return; }
      // Bold, italic and underline by hand, not left to the browser: Firefox on
      // Linux gives Ctrl+B to its bookmarks, and bolds nothing (29 September).
      const styleKey = { KeyB: "bold", KeyI: "italic", KeyU: "underline" }[e.code];
      if (ctrl && !e.shiftKey && !e.altKey && styleKey) { e.preventDefault(); e.stopPropagation(); format(styleKey); return; }
      if (ctrl && e.shiftKey && e.code === "KeyX") { e.preventDefault(); format("strike"); return; }
      if (ctrl && e.shiftKey && e.code === "Digit8") { e.preventDefault(); format("list"); return; }
      if (ctrl && !e.shiftKey && e.code === "BracketRight") { e.preventDefault(); format("bigger"); return; }
      if (ctrl && !e.shiftKey && e.code === "BracketLeft") { e.preventDefault(); format("smaller"); return; }
      if (ctrl && !e.shiftKey && e.code === "KeyS") { e.preventDefault(); commit(); ctx.download(); return; }
      // Undo, redo, select all, cut, copy and paste are the browser's own.
      // Nothing here may reach the page's keys: Space would start reading, the
      // arrows move its cursor.
      e.stopPropagation();
    }

    // --- formatting, from the strip or the keys --------------------------------

    function inBox() {
      if (!editing) return null;
      const box = editing.box;
      // Only coming back from the size box or a menu: while the note has the
      // keyboard its own selection is the truth, and the one kept from the last
      // selectionchange can be a keystroke behind -- putting that back sent a
      // quick Ctrl+B's words to where the cursor had been (29 September).
      if (document.activeElement !== box.text) {
        box.text.focus();
        if (range && box.text.contains(range.startContainer)) {
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(range);
        }
      }
      return box;
    }

    /* The size under the cursor, in points. */
    function sizeHere() {
      if (!editing) return SIZE;
      const s = getSelection();
      let node = s.rangeCount ? s.getRangeAt(0).startContainer : null;
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (!node || !editing.box.text.contains(node)) node = editing.box.text;
      return Math.round(parseFloat(getComputedStyle(node).fontSize) / zoom() * 2) / 2;
    }

    /* execCommand only knows seven sizes, and marks the words with <font
     * size=7>; each mark is given the size asked for instead, and any size
     * inside it goes, so the new size wins. The mark itself stays where it is:
     * taking it out of the page would drop the typing cursor out of it. */
    function tidySizes(box) {
      const marks = box.text.querySelectorAll(`font[size="${BIG}"]`);
      if (!marks.length) return;
      const size = pendingSize ?? SIZE;
      for (const mark of marks) {
        for (const inner of mark.querySelectorAll("[style]")) inner.style.fontSize = "";
        mark.removeAttribute("size");
        mark.style.fontSize = `calc(${size} * var(--pt))`;
      }
    }

    function setSize(size) {
      const box = inBox();
      if (!box) return;
      pendingSize = size;
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("fontSize", false, String(BIG));
      tidySizes(box);
      scheduleCommit();
    }

    function format(what, value) {
      if (what === "colour") { recolour(value); return; }
      const box = inBox();
      if (!box) { ctx.status("Click into a sticky note first, then format its words"); return; }
      document.execCommand("styleWithCSS", false, false);
      if (what === "bold" || what === "italic" || what === "underline") document.execCommand(what);
      else if (what === "strike") document.execCommand("strikeThrough");
      else if (what === "list") document.execCommand("insertUnorderedList");
      else if (what === "size") { setSize(Number(value)); return; }
      else if (what === "bigger" || what === "smaller") {
        const now = sizeHere();
        const next = what === "bigger" ? SIZES.find((s) => s > now) ?? SIZES.at(-1)
                                       : [...SIZES].reverse().find((s) => s < now) ?? SIZES[0];
        setSize(next);
        ctx.status(`Text size ${next}`);
        return;
      }
      scheduleCommit();
      ctx.formatChanged();
    }

    function recolour(colour) {
      const item = editing ? find(editing.xref) : ctx.activeSticky();
      if (!item) return;
      const before = item.colour.slice();
      ctx.change(async () => {
        apply(await ctx.call("sticky_set", item.xref, null, null, colour, null));
        rememberChange(item, "colour", before, colour, "Sticky note colour");
      });
      if (editing) inBox();
    }

    /* What the strip's buttons show: whether a sticky is being typed in, and
     * the styles and size where the cursor is. */
    function formatState() {
      if (!editing) return { editing: false };
      const query = (name) => { try { return document.queryCommandState(name); } catch { return false; } };
      return { editing: true, bold: query("bold"), italic: query("italic"), underline: query("underline"),
               strike: query("strikeThrough"), list: query("insertUnorderedList"), size: sizeHere(),
               colour: find(editing.xref)?.colour ?? null };
    }

    // --- moving and resizing ------------------------------------------------------

    function startDrag(e, box, kind) {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      const item = find(box.xref);
      if (!item) return;
      if (editing && editing.xref === box.xref) commit();
      const target = e.currentTarget;
      const [w, h] = ctx.pageSize(item.page);
      const from = { x: e.clientX, y: e.clientY, rect: item.rect.slice() };
      const pageBox = box.root.parentElement.getBoundingClientRect();
      const scale = pageBox.width / w;
      let rect = from.rect.slice();
      target.setPointerCapture(e.pointerId);
      box.root.classList.add("dragging");
      const moveTo = (ev) => {
        const dx = (ev.clientX - from.x) / scale, dy = (ev.clientY - from.y) / scale;
        const [x0, y0, x1, y1] = from.rect;
        if (kind === "move") {
          const nx = Math.max(0, Math.min(w - (x1 - x0), x0 + dx)), ny = Math.max(0, Math.min(h - MIN, y0 + dy));
          rect = [nx, ny, nx + (x1 - x0), ny + (y1 - y0)];
        } else {
          rect = [x0, y0, Math.max(x0 + MIN, Math.min(w, x1 + dx)), Math.max(y0 + MIN, Math.min(h, y1 + dy))];
        }
        Object.assign(box.root.style, { left: `${rect[0] / w * 100}%`, top: `${rect[1] / h * 100}%`,
                                        width: `${(rect[2] - rect[0]) / w * 100}%`,
                                        minHeight: `${(rect[3] - rect[1]) / h * 100}%` });
      };
      const done = () => {
        target.removeEventListener("pointermove", moveTo);
        target.removeEventListener("pointerup", done);
        target.removeEventListener("pointercancel", done);
        box.root.classList.remove("dragging");
        if (rect.every((v, i) => Math.abs(v - from.rect[i]) < 0.5)) return;
        ctx.change(async () => {
          apply(await ctx.call("sticky_set", box.xref, null, rect, null, null));
          const now = find(box.xref);
          if (now) rememberChange(now, "rect", from.rect, now.rect.slice(), kind === "move" ? "Move" : "Resize");
          ctx.status(kind === "move" ? "Sticky note moved — it is saved in this place" : "Sticky note resized");
        });
      };
      target.addEventListener("pointermove", moveTo);
      target.addEventListener("pointerup", done);
      target.addEventListener("pointercancel", done);
    }

    // --- menus ---------------------------------------------------------------------

    function menuItems(item) {
      return [
        { label: "Edit this sticky note", run: () => focus(item) },
        { label: "Read this sticky note", enabled: ctx.canRead() && !!flat(item.text), run: () => ctx.readSticky(item) },
        { label: "Copy its words", enabled: !!flat(item.text), run: () => ctx.copyText(item.text, "Copied the sticky note") },
        "-",
        { label: "Colour", enabled: false },
        ...ctx.COLOURS.map(([name, value]) => ({
          label: name, indent: true, swatch: css(value),
          checked: value.every((v, i) => Math.abs(v - item.colour[i]) < 0.02),
          run: () => { ctx.pick(item); recolourItem(item, value); },
        })),
        "-",
        { label: item.folded ? "Open it" : "Fold it away", run: () => setFolded(item.xref, !item.folded, item.folded) },
        { label: "Delete this sticky note", run: () => remove(item) },
      ];
    }
    function recolourItem(item, colour) {
      const before = item.colour.slice();
      ctx.change(async () => {
        apply(await ctx.call("sticky_set", item.xref, null, null, colour, null));
        rememberChange(item, "colour", before, colour, "Sticky note colour");
      });
    }

    return {
      set, draw, at, place, placeAt, addAtCaret, remove, focus, menuItems, format, formatState, finish,
      SIZES,
      clear() {
        editing = null; clearTimeout(commitTimer); range = null; place(false);
        idOf.clear(); xrefOf.clear();
        for (const box of boxes.values()) box.root.remove();
        boxes.clear();
        list = [];
      },
      get list() { return list; },
      get placing() { return placing; },
      get editing() { return editing ? editing.xref : null; },
      shownRich: shown,
    };
  }

  root.MimickSticky = { create, SIZE };
})(typeof self !== "undefined" ? self : globalThis);
