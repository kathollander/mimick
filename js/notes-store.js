/* Highlights and notes, kept in the browser between visits (IndexedDB).
 *
 * The browser's companion file. The desktop never writes into the PDF you
 * opened, and writes your notes to "<name> (notes).pdf" beside it; a tab has no
 * "beside", so the notes are kept here instead, against a hash of the PDF's
 * bytes, and put back whenever that same PDF is opened again. "Download a copy"
 * is how they leave the browser, as a PDF with real annotations in it.
 *
 * What is kept is reader.snapshot(): plain data, a few hundred bytes a
 * highlight -- not the PDF, which for a scanned book would be a hundred
 * megabytes a save. Unlike the pages in js/page-store.js, notes are never
 * thrown away to make room; they are the reader's own work.
 *
 * Storage can be refused (a private window, blocked site data). Then get gives
 * nothing back and put says it failed, and the reader says so.
 */
(function (root) {
  "use strict";

  let opening = null;
  function db() {
    opening ??= new Promise((resolve) => {
      let request;
      try { request = indexedDB.open("mimick-notes", 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => request.result.createObjectStore("documents");  // hash -> entry
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

  /* { name, saved, annotations } for this document, or null. */
  async function get(key) {
    const store = await db();
    if (!store) return null;
    try {
      return (await done(store.transaction("documents").objectStore("documents").get(key))) ?? null;
    } catch {
      return null;
    }
  }

  /* Keep a document's highlights. True once they are written. */
  async function put(key, name, annotations) {
    const store = await db();
    if (!store) return false;
    try {
      const tx = store.transaction("documents", "readwrite");
      await done(tx.objectStore("documents").put({ name, saved: Date.now(), annotations }, key));
      return true;
    } catch {
      return false;
    }
  }

  const api = { get, put };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickNotesStore = api;
})(typeof self !== "undefined" ? self : globalThis);
