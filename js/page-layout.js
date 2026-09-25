/* Where every page sits, and which of them are on screen.
 *
 * The same arithmetic as the desktop's page_view: pages in one column, 16px
 * apart, 12px above the first and below the last, zoom from 40% to 400%. Only
 * the pages in view, and one either side, are ever drawn -- a sixty-page paper
 * at any zoom is tens of thousands of pixels tall, and a bitmap of all of it
 * would not fit in a tab (desktop trap 4, which in a browser is memory).
 *
 * No DOM here, so tools/check_reader.mjs can hold it to what it promises.
 */
(function (root) {
  "use strict";

  const PAGE_GAP = 16;          // between pages, CSS pixels
  const PAGE_MARGIN = 12;       // above the first page, below the last, and at the sides
  const RENDER_MARGIN = 1;      // pages drawn beyond the visible band, each way
  const ZOOM_MIN = 0.4, ZOOM_MAX = 4, ZOOM_STEP = 1.15, ZOOM_DEFAULT = 1.25;
  // The most pixels one page is drawn with. At 400% on a high-density screen a
  // single A4 page would be 30 million pixels, 120 MB, and three are kept at
  // once; past this the page is drawn at this size and scaled up instead.
  const MAX_PAGE_PIXELS = 12_000_000;

  const clampZoom = (zoom) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

  /* pages: [[width, height] in PDF points]. */
  function layout(pages, zoom, viewportWidth = 0) {
    const sizes = pages.map(([w, h]) => [Math.max(1, Math.round(w * zoom)), Math.max(1, Math.round(h * zoom))]);
    const offsets = [];
    let y = PAGE_MARGIN;
    for (const [, h] of sizes) {
      offsets.push(y);
      y += h + PAGE_GAP;
    }
    const height = sizes.length ? y - PAGE_GAP + PAGE_MARGIN : 0;
    const widest = sizes.reduce((m, [w]) => Math.max(m, w), 0);
    const width = Math.max(widest + 2 * PAGE_MARGIN, viewportWidth);
    const lefts = sizes.map(([w]) => Math.round((width - w) / 2));

    /* The page at height y: the last one whose top, less the gap above it, is
     * at or above y -- so the gap belongs to the page below it. */
    function pageAt(y) {
      let lo = 0, hi = offsets.length - 1, found = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] - PAGE_GAP <= y) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return found;
    }

    /* Pages any part of which is between top and top + viewHeight. */
    function onScreen(top, viewHeight) {
      if (!offsets.length) return [];
      const first = pageAt(top), bottom = top + viewHeight;
      const out = [];
      for (let p = first; p < offsets.length && offsets[p] < bottom; p++)
        if (offsets[p] + sizes[p][1] > top) out.push(p);
      return out;
    }

    /* On screen, plus RENDER_MARGIN either side: what is worth keeping drawn. */
    function band(top, viewHeight) {
      const shown = onScreen(top, viewHeight);
      if (!shown.length) return [];
      const first = Math.max(0, shown[0] - RENDER_MARGIN);
      const last = Math.min(offsets.length - 1, shown[shown.length - 1] + RENDER_MARGIN);
      return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    }

    /* Where the reader is, as a page and a fraction down it -- which survives a
     * zoom, where a scroll position in pixels does not. */
    // In the gap above a page, the distance into the gap is kept in pixels:
    // the gap does not grow with the zoom, so as a fraction it would drift.
    function anchor(top) {
      const page = pageAt(top);
      if (top < offsets[page]) return { page, fraction: 0, gap: top - offsets[page] };
      return { page, fraction: Math.min(1, (top - offsets[page]) / sizes[page][1]), gap: 0 };
    }

    function topFor({ page, fraction = 0, gap = 0 }) {
      if (!offsets.length) return 0;
      page = Math.min(offsets.length - 1, Math.max(0, page));
      return Math.max(0, Math.round(offsets[page] + fraction * sizes[page][1] + gap));
    }

    /* Device pixels per PDF point to draw a page at, capped by MAX_PAGE_PIXELS. */
    function renderScale(page, devicePixelRatio = 1) {
      const [w, h] = pages[page];
      const wanted = zoom * devicePixelRatio;
      const cap = Math.sqrt(MAX_PAGE_PIXELS / (w * h));
      return Math.min(wanted, cap);
    }

    return { zoom, sizes, offsets, lefts, width, height, pageAt, onScreen, band, anchor, topFor, renderScale };
  }

  const api = { PAGE_GAP, PAGE_MARGIN, RENDER_MARGIN, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT,
                MAX_PAGE_PIXELS, clampZoom, layout };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickLayout = api;
})(typeof self !== "undefined" ? self : globalThis);
