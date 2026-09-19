/* Find in the document, Ctrl+F: a box over the top right of the page, as a
 * browser's own. Typing lights every match; Enter and Shift+Enter (or F3) step
 * through them and bring each into view; Esc closes the box and leaves the
 * match it was on selected, so Ctrl+H highlights it and Enter reads it.
 *
 * The search is reader.find, in the document worker, over every word as
 * written. A match is a run of whole words, lit where it sits, a page at a time
 * (reader.found_on) so a common word in a long book costs nothing until its
 * page is on screen.
 *
 *   const find = MimickFind.create(ctx)     ctx: see reader.js, "find"
 *   find.open() / find.close() / find.step(±1)
 *   find.draw(page, el)     this page's matches, onto the page
 *   find.opened()           a document's words are ready: search again
 *   find.forget()           the document is closing
 */
(function (root) {
  "use strict";

  const WAIT_MS = 150;       // after the last key, before searching

  function create(ctx) {
    const $ = (id) => document.getElementById(id);
    const bar = $("find-bar"), input = $("find-input"), count = $("find-count");
    let matches = [];          // [[first, last, page]]
    let more = false;          // stopped at document.FIND_LIMIT
    let current = -1;
    let asked = 0;             // bumped by every search, so only the latest lands
    let timer = null;
    const pages = new Map();   // page -> [[match, rects]], or a promise of it

    const isOpen = () => !bar.hidden;
    const plural = (n) => n.toLocaleString();

    function show() {
      const query = input.value.trim();
      $("find-prev").disabled = $("find-next").disabled = matches.length === 0;
      if (!query) { count.textContent = ""; input.classList.remove("none"); return; }
      if (!ctx.ready()) { count.textContent = ctx.hasDocument() ? "Opening…" : "No document"; return; }
      input.classList.toggle("none", matches.length === 0);
      count.textContent = matches.length === 0 ? "No matches"
        : `${plural(current + 1)} of ${plural(matches.length)}${more ? "+" : ""}`;
    }

    async function search({ keepPlace = false } = {}) {
      clearTimeout(timer);
      timer = null;
      const mine = ++asked, generation = ctx.generation(), query = input.value;
      const wasOn = keepPlace && current >= 0 ? matches[current] : null;
      if (!query.trim() || !ctx.ready()) {
        matches = []; more = false; current = -1; pages.clear();
        ctx.redraw(); show();
        return;
      }
      let found;
      try {
        found = await ctx.call("find", query, $("find-case").checked);
      } catch (err) {
        if (mine === asked) count.textContent = "Could not search: " + err.message;
        return;
      }
      if (mine !== asked || generation !== ctx.generation()) return;
      matches = found.matches; more = found.more; pages.clear();
      // The first match at or after what is on screen, as a browser does.
      const from = wasOn ? matches.findIndex((m) => m[0] >= wasOn[0])
        : matches.findIndex((m) => m[2] >= ctx.currentPage());
      current = !matches.length ? -1 : Math.max(0, from);
      show();
      ctx.redraw();
      if (current >= 0) bringIntoView();
    }

    function bringIntoView() {
      const [first, , page] = matches[current];
      // Where the match's own rectangle is, once its page has answered; until
      // then, the top of its page.
      ctx.call("selection_boxes", first, matches[current][1]).then((boxes) => {
        const box = boxes.find(([on]) => on === page) ?? boxes[0];
        if (box) ctx.scrollToRect(box[0], box[1]);
      }).catch(() => ctx.scrollToRect(page, null));
    }

    function step(direction) {
      if (!isOpen()) { open(); return; }
      if (!matches.length) { if (input.value.trim()) search(); return; }
      current = (current + direction + matches.length) % matches.length;
      show();
      ctx.redraw();
      bringIntoView();
    }

    function open() {
      bar.hidden = false;
      // A short selection is what is most likely wanted.
      const chosen = ctx.selectionText();
      if (chosen && chosen.length <= 80 && !chosen.includes("\n")) input.value = chosen;
      input.focus();
      input.select();
      search({ keepPlace: true });
    }

    /* Put the box away. `select` leaves the match it was on selected. */
    function close(select = true) {
      if (!isOpen()) return;
      bar.hidden = true;
      clearTimeout(timer);
      timer = null;
      asked++;
      const on = current >= 0 ? matches[current] : null;
      matches = []; current = -1; pages.clear();
      ctx.redraw();
      if (select && on) {
        ctx.select(on[0], on[1]);
        ctx.status("The match is selected — Enter reads it, Ctrl+H highlights it, right-click reads on from there");
      }
      ctx.focusPage();
    }

    function draw(page, el) {
      if (!matches.length) return;
      const found = pages.get(page);
      if (!found) {
        const mine = asked;
        const asking = ctx.call("found_on", page).then((list) => {
          if (mine !== asked || pages.get(page) !== asking) return;
          pages.set(page, list);
          ctx.redrawPage(page);
        }).catch(() => { if (pages.get(page) === asking) pages.delete(page); });
        pages.set(page, asking);
        return;
      }
      if (!Array.isArray(found)) return;
      for (const [number, rects] of found) {
        for (const rect of rects) {
          const box = document.createElement("div");
          box.className = number === current ? "hl found current" : "hl found";
          ctx.placeBox(box, page, rect, 1);
          el.append(box);
        }
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => search(), WAIT_MS);
    });
    // The box's own keys stay in it; anything else (Ctrl+O, the zoom keys) goes on to the page's.
    bar.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey, letter = e.key.toLowerCase();
      if (e.key === "Enter" && e.target === input) {
        if (timer) search(); else step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") close();
      else if (e.key === "F3" || (ctrl && letter === "g")) step(e.shiftKey ? -1 : 1);
      else if (ctrl && letter === "f") input.select();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    $("find-case").addEventListener("change", () => { search({ keepPlace: true }); input.focus(); });
    $("find-next").onclick = () => { step(1); input.focus(); };
    $("find-prev").onclick = () => { step(-1); input.focus(); };
    $("find-close").onclick = () => close();

    return {
      open, close, step, draw,
      get isOpen() { return isOpen(); },
      /* The document's words have just arrived, or changed: look again. */
      opened() { if (isOpen()) search(); },
      forget() { asked++; matches = []; current = -1; more = false; pages.clear(); if (isOpen()) show(); },
    };
  }

  root.MimickFind = { create };
})(typeof self !== "undefined" ? self : globalThis);
