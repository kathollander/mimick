/* The table of contents: the PDF's own bookmarks, in a panel on the left of
 * the page, as the notes panel is on the right. Click an entry to go there;
 * right-click it to read from there. The entry for the part on screen is lit,
 * and its parents opened, as the page scrolls.
 *
 * The outline comes with the pages (pages.outline, in the page workers), so it
 * is there as soon as the first page is, long before the sentences are.
 *
 * Shown or hidden with F9, Display ▾, or the tab on the page's left edge, which
 * stays when the panel is away so it can always be had back. The choice is
 * kept. A document with no bookmarks has no panel, and its tab says why.
 *
 *   const contents = MimickContents.create(ctx)    ctx: see reader.js, "contents"
 *   contents.open(outline)      a document's pages are ready
 *   contents.forget()           the document is closing
 *   contents.pageShown(page, y, top)   the place a third of the way down the view, in
 *                               points from its page's top; top is the view's scroll
 *   contents.sectionAt(page, y) the title of the part that place is in, or null
 *   contents.toggle() / contents.displayMenu()
 */
(function (root) {
  "use strict";

  const OPEN_ALL_UP_TO = 60;   // entries; a short outline opens in full, whatever the file says

  function create(ctx) {
    const $ = (id) => document.getElementById(id);
    const panel = $("contents"), list = $("contents-list"), tab = $("contents-tab");
    let entries = [];           // { level, title, page, y, parent, children, open, row, twisty }
    let current = -1;
    let loaded = false;         // a document is open, and its outline known
    let heldAt = null;          // the scroll a click left; its entry stays lit until the page moves

    const wanted = () => ctx.recall("mimick-contents-panel") !== "0";
    const has = () => entries.length > 0;

    function show() {
      const on = loaded && has() && wanted();
      const changed = panel.hidden === on;
      panel.hidden = !on;
      tab.hidden = !loaded || on;
      tab.disabled = !has();
      tab.title = has() ? "Show the table of contents  (F9)"
        : "This document has no table of contents (bookmarks) of its own";
      if (changed) ctx.relayout();
    }

    function setPanel(on) {
      if (!has()) { ctx.status("This document has no table of contents"); return; }
      ctx.remember("mimick-contents-panel", on ? "1" : "0");
      show();
      ctx.status(on ? "Contents shown" : "Contents hidden");
      if (on) reveal(current, "nearest");
    }

    function open(outline) {
      forget();
      loaded = true;
      const stack = [];
      for (const [level, title, page, y, isOpen] of outline ?? []) {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const parent = stack[stack.length - 1] ?? null;
        const entry = { level, title: title || "(untitled)", page, y, parent, children: [], open: isOpen };
        parent?.children.push(entry);
        entries.push(entry);
        stack.push(entry);
      }
      if (entries.length <= OPEN_ALL_UP_TO) for (const entry of entries) entry.open = true;
      render();
      show();
    }

    function forget() {
      entries = [];
      current = -1;
      heldAt = null;
      loaded = false;
      list.replaceChildren();
      show();
    }

    function render() {
      const fragment = document.createDocumentFragment();
      entries.forEach((entry, i) => {
        const row = document.createElement("div");
        row.className = "toc-row";
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", entry.level);
        row.style.setProperty("--depth", depthOf(entry));
        const twisty = document.createElement("button");
        twisty.className = "toc-twisty";
        twisty.tabIndex = -1;
        if (entry.children.length) {
          twisty.onclick = (e) => { e.stopPropagation(); setOpen(entry, !entry.open); };
        } else {
          twisty.disabled = true;
          twisty.setAttribute("aria-hidden", "true");
        }
        const link = document.createElement("button");
        link.className = "toc-link";
        link.textContent = entry.title;
        link.title = entry.page >= 0 ? `${entry.title} — page ${entry.page + 1}` : `${entry.title} — not a place in this file`;
        link.disabled = entry.page < 0;
        link.onclick = () => go(i);
        link.oncontextmenu = (e) => {
          e.preventDefault();
          if (entry.page < 0) return;
          ctx.showMenu(e.clientX, e.clientY, [
            { label: "Go here", run: () => go(i) },
            { label: "Start reading from here", enabled: ctx.canRead(), run: () => ctx.readFrom(entry.page, entry.y) },
          ]);
        };
        const number = document.createElement("span");
        number.className = "toc-page dim";
        number.textContent = entry.page >= 0 ? entry.page + 1 : "";
        row.append(twisty, link, number);
        Object.assign(entry, { row, twisty });
        fragment.append(row);
      });
      list.replaceChildren(fragment);
      for (const entry of entries) paintOpen(entry);
    }

    function depthOf(entry) {
      let depth = 0;
      for (let p = entry.parent; p; p = p.parent) depth++;
      return depth;
    }

    function setOpen(entry, on) {
      entry.open = on;
      paintOpen(entry);
    }

    function paintOpen(entry) {
      if (entry.children.length) {
        entry.twisty.textContent = entry.open ? "▾" : "▸";
        entry.twisty.setAttribute("aria-label", entry.open ? "Close" : "Open");
        entry.row.setAttribute("aria-expanded", String(entry.open));
      }
      for (const child of entry.children) {
        child.row.hidden = !entry.open || entry.row.hidden;
        paintOpen(child);
      }
    }

    function go(i) {
      const entry = entries[i];
      if (!entry || entry.page < 0) return;
      ctx.goTo(entry.page, entry.y);
      light(i);
      // Several short sections can share the screen; the one clicked is the one meant.
      heldAt = ctx.scrollTop();
      ctx.focusPage();
    }

    /* The last entry at or above the place on screen. */
    function pageShown(page, y, top) {
      if (!has()) return;
      if (heldAt !== null && Math.abs(top - heldAt) < 2) return;
      heldAt = null;
      let at = -1;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.page < 0) continue;
        if (e.page < page || (e.page === page && (e.y ?? 0) <= y + 1)) at = i;
        else if (e.page > page) break;
      }
      // Above the first heading, on its own page: that part still.
      const first = entries.findIndex((e) => e.page >= 0);
      if (at < 0 && first >= 0 && entries[first].page === page) at = first;
      if (at !== current) light(at);
    }

    function light(i) {
      entries[current]?.row.classList.remove("current");
      entries[current]?.row.removeAttribute("aria-current");
      current = i;
      const entry = entries[i];
      if (!entry) return;
      entry.row.classList.add("current");
      entry.row.setAttribute("aria-current", "location");
      reveal(i, "nearest");
    }

    function reveal(i, block) {
      const entry = entries[i];
      if (!entry) return;
      for (let p = entry.parent; p; p = p.parent) if (!p.open) setOpen(p, true);
      // By hand: scrollIntoView would move the page's own view too.
      if (panel.hidden || entry.row.hidden) return;
      const top = entry.row.offsetTop, bottom = top + entry.row.offsetHeight;
      if (block === "start" || top < list.scrollTop) list.scrollTop = Math.max(0, top - 8);
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
    }

    // The keys of a tree: ↑ ↓ between entries, → opens or goes in, ← closes or
    // goes out, Home and End; Enter or Space goes there. Kept from the page's own
    // keys, which would otherwise move the text cursor.
    list.addEventListener("keydown", (e) => {
      const at = entries.findIndex((entry) => entry.row.contains(e.target));
      if (at < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
      const shown = entries.filter((entry) => !entry.row.hidden);
      const here = shown.indexOf(entries[at]), entry = entries[at];
      const focus = (target) => target?.row.querySelector(".toc-link").focus();
      const moves = {
        ArrowDown: () => focus(shown[Math.min(shown.length - 1, here + 1)]),
        ArrowUp: () => focus(shown[Math.max(0, here - 1)]),
        Home: () => focus(shown[0]),
        End: () => focus(shown[shown.length - 1]),
        ArrowRight: () => (entry.children.length && !entry.open ? setOpen(entry, true) : focus(entry.children[0])),
        ArrowLeft: () => (entry.children.length && entry.open ? setOpen(entry, false) : focus(entry.parent)),
        Escape: () => ctx.focusPage(),
      };
      if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); moves[e.key](); }
      else if (e.key === " " || e.key === "Enter") e.stopPropagation();   // the button's own click
    });

    $("contents-hide").onclick = () => { setPanel(false); ctx.focusPage(); };
    tab.onclick = () => { setPanel(true); };
    show();

    /* The title of the part a place on a page is in, or null. */
    function sectionAt(page, y) {
      let at = null;
      for (const e of entries) {
        if (e.page < 0) continue;
        if (e.page < page || (e.page === page && (e.y ?? 0) <= y + 1)) at = e;
        else if (e.page > page) break;
      }
      return at?.title ?? null;
    }

    return {
      open, forget, pageShown, sectionAt,
      toggle: () => setPanel(panel.hidden),
      displayMenu: () => [
        { label: "Contents panel", keys: "F9", checked: loaded ? !panel.hidden : wanted(), enabled: !loaded || has(),
          run: () => (loaded ? setPanel(panel.hidden) : ctx.remember("mimick-contents-panel", wanted() ? "0" : "1")) },
      ],
      get entries() { return entries.map(({ level, title, page, y }) => ({ level, title, page, y })); },
      get current() { return current; },
    };
  }

  root.MimickContents = { create };
})(typeof self !== "undefined" ? self : globalThis);
