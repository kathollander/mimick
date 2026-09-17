/* Recognising the text of a scanned PDF (OCR), in this browser.
 *
 * A scan without a text layer is pictures of pages: nothing to read aloud.
 * Tesseract (vendor/tesseract, tesseract.js) reads each page's picture, drawn
 * by a page worker at about 200 dots an inch, and gives back its words and where
 * they sit. reader.add_text_layer writes them into the PDF as invisible text,
 * and the reader opens that as it would any PDF.
 *
 * What was found is kept in this browser (IndexedDB, "mimick-ocr"), by the same
 * key as the document, so opening the scan again puts the text back in a moment
 * rather than reading every page again. Forget this document removes it.
 *
 *   const ocr = MimickOcr.create(ctx)   ctx: see reader.js, "recognising text"
 *   ocr.recognise(pageSizes)            [[page, words]]; throws "cancelled" if stopped
 *   ocr.stop() / ocr.running
 *   MimickOcr.stored(key) / keep(key, found) / forget(key)
 */
(function (root) {
  "use strict";

  const TARGET_WIDTH = 2200;     // pixels across a page: about 200 dpi on A4 or Letter
  const MAX_SCALE = 3;

  // --- keeping what was found ------------------------------------------------------

  let opening = null;
  function db() {
    opening ??= new Promise((resolve) => {
      let request;
      try { request = indexedDB.open("mimick-ocr", 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => request.result.createObjectStore("documents");
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    });
    return opening;
  }
  const done = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function stored(key) {
    const store = await db();
    try { return store ? (await done(store.transaction("documents").objectStore("documents").get(key)))?.found ?? null : null; }
    catch { return null; }
  }
  async function keep(key, found) {
    const store = await db();
    try { await done(store.transaction("documents", "readwrite").objectStore("documents").put({ found, at: Date.now() }, key)); return true; }
    catch { return false; }
  }
  async function forget(key) {
    const store = await db();
    try { await done(store?.transaction("documents", "readwrite").objectStore("documents").delete(key)); } catch { /* not kept */ }
  }

  // --- recognising -------------------------------------------------------------------

  function create(ctx) {
    let tesseract = null;        // a promise of the Tesseract worker, made on first use
    let job = null;              // { cancelled }

    const url = (path) => new URL(path, root.location.href).href;
    function engine() {
      tesseract ??= root.Tesseract.createWorker("eng", 1 /* LSTM only */, {
        workerPath: url("vendor/tesseract/worker.min.js"),
        corePath: url("vendor/tesseract/tesseract-core-simd-lstm.wasm.js"),
        langPath: url("vendor/tesseract"),
        cacheMethod: "none",     // the service worker keeps these files already
        workerBlobURL: false,
      });
      return tesseract;
    }

    /* Every page's words, [[page, [[text, x0, y0, x1, y1] in points]]], a
     * line's words given the line's own top and bottom so they sit level. */
    async function recognise(pageSizes) {
      if (job) throw new Error("already recognising text");
      const mine = job = { cancelled: false };
      const found = [];
      const t0 = performance.now();
      try {
        const worker = await engine();
        for (let page = 0; page < pageSizes.length; page++) {
          if (mine.cancelled) throw new Error("cancelled");
          const [width] = pageSizes[page];
          const scale = Math.min(MAX_SCALE, TARGET_WIDTH / width);
          const bitmap = await ctx.renderPage(page, scale);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          bitmap.close();
          const blob = await canvas.convertToBlob({ type: "image/png" });
          if (mine.cancelled) throw new Error("cancelled");
          const { data } = await worker.recognize(blob, {}, { blocks: true, text: false });
          const words = [];
          for (const block of data.blocks ?? []) {
            for (const paragraph of block.paragraphs) {
              for (const line of paragraph.lines) {
                const top = line.bbox.y0 / scale, bottom = line.bbox.y1 / scale;
                for (const word of line.words) {
                  const text = word.text.trim();
                  if (!text || word.confidence < 20) continue;
                  words.push([text, word.bbox.x0 / scale, top, word.bbox.x1 / scale, bottom]);
                }
              }
            }
          }
          found.push([page, words]);
          const each = (performance.now() - t0) / (page + 1);
          ctx.progress(page + 1, pageSizes.length, each * (pageSizes.length - page - 1));
        }
        return found;
      } finally {
        if (job === mine) job = null;
      }
    }

    return {
      recognise,
      stop() { if (job) job.cancelled = true; },
      /* Let the engine go: it holds its model in memory. */
      async close() { const t = tesseract; tesseract = null; if (t) (await t).terminate(); },
      get running() { return !!job; },
    };
  }

  root.MimickOcr = { create, stored, keep, forget };
})(typeof self !== "undefined" ? self : globalThis);
