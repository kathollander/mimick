/* Pages drawn ahead of time, kept in the browser's own storage (IndexedDB).
 *
 * Only for documents that are slow to draw -- in practice scans, whose pages
 * are pictures MuPDF takes most of a second each to unpack. Their pages are
 * drawn once, in the background, at KEEP_SCALE, and kept as compressed images,
 * so scrolling shows a page at once and so does opening the book again. The
 * PDF itself is never changed, and nothing leaves the computer.
 *
 * Documents are known by a hash of their bytes. The pages of the KEEP_DOCUMENTS
 * most recently opened slow documents are kept; older ones are deleted.
 *
 * Storage can be refused (a private window, blocked site data). Then every
 * call here does nothing, and the reader draws pages as it would anyway.
 */
(function (root) {
  "use strict";

  const KEEP_SCALE = 150 / 72;   // 150 dpi
  const KEEP_DOCUMENTS = 4;

  let opening = null;
  function db() {
    opening ??= new Promise((resolve) => {
      let request;
      try { request = indexedDB.open("mimick-pages", 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => {
        request.result.createObjectStore("pages");       // [hash, page] -> Blob
        request.result.createObjectStore("documents");   // hash -> { opened, pages }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return opening;
  }

  const done = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function hash(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* The pages already kept for this document, as a Set of page numbers. Marks
   * it the most recently opened, and forgets the oldest past KEEP_DOCUMENTS. */
  async function open(key) {
    const store = await db();
    if (!store) return new Set();
    try {
      const tx = store.transaction(["pages", "documents"], "readwrite");
      const documents = tx.objectStore("documents"), pages = tx.objectStore("pages");
      const kept = new Set(await done(pages.getAllKeys(IDBKeyRange.bound([key, 0], [key, Infinity]))).then(
        (keys) => keys.map(([, page]) => page)));
      const known = await done(documents.get(key));
      if (known) documents.put({ ...known, opened: Date.now() }, key);
      const all = await done(documents.getAll()), keys = await done(documents.getAllKeys());
      const older = keys.map((k, i) => [k, all[i].opened]).filter(([k]) => k !== key)
        .sort((a, b) => b[1] - a[1]).slice(KEEP_DOCUMENTS - 1);
      for (const [old] of older) {
        documents.delete(old);
        pages.delete(IDBKeyRange.bound([old, 0], [old, Infinity]));
      }
      return kept;
    } catch {
      return new Set();
    }
  }

  /* Remember that this document is slow, so it counts towards KEEP_DOCUMENTS. */
  async function markSlow(key, pageCount) {
    const store = await db();
    if (!store) return;
    try {
      store.transaction("documents", "readwrite").objectStore("documents").put({ opened: Date.now(), pages: pageCount }, key);
    } catch { /* storage refused: the reader carries on without it */ }
  }

  async function put(key, page, blob) {
    const store = await db();
    if (!store) return false;
    try {
      await done(store.transaction("pages", "readwrite").objectStore("pages").put(blob, [key, page]));
      return true;
    } catch {
      return false;   // most likely out of space
    }
  }

  async function get(key, page) {
    const store = await db();
    if (!store) return null;
    try {
      return (await done(store.transaction("pages").objectStore("pages").get([key, page]))) ?? null;
    } catch {
      return null;
    }
  }

  const api = { KEEP_SCALE, KEEP_DOCUMENTS, hash, open, markSlow, put, get };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickPageStore = api;
})(typeof self !== "undefined" ? self : globalThis);
