/* A recovery copy of highlights and notes not yet saved to a file (IndexedDB).
 *
 * The file is what counts (Kat, 20 October): a PDF opens with the notes in it,
 * the same on any computer, and Save a copy is how work is kept (Export
 * notes makes a separate document, and does not count). Until then js/notes.js keeps a copy here, against a hash of the PDF's
 * bytes, so a crash or a browser that quits unexpectedly loses nothing: opening
 * that PDF again asks whether to recover it. Saving to a file deletes it, and
 * so does closing the tab on purpose, Discard, or seven days unopened.
 *
 * What is kept is reader.snapshot(): plain data, a few hundred bytes a
 * highlight -- not the PDF, which for a scanned book would be a hundred
 * megabytes a save. Unlike the pages in js/page-store.js, it is never thrown
 * away to make room; it is the reader's own work.
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

  /* Forget a document's highlights. True once they are gone. */
  async function remove(key) {
    const store = await db();
    if (!store) return false;
    try {
      await done(store.transaction("documents", "readwrite").objectStore("documents").delete(key));
      return true;
    } catch {
      return false;
    }
  }

  /* Delete every copy kept longer ago than maxAge (ms). */
  async function prune(maxAge) {
    const store = await db();
    if (!store) return;
    try {
      const tx = store.transaction("documents", "readwrite");
      const cursor = tx.objectStore("documents").openCursor();
      await new Promise((resolve, reject) => {
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (!at) { resolve(); return; }
          if (!(Date.now() - (at.value?.saved ?? 0) < maxAge)) at.delete();
          at.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    } catch { /* kept as it was */ }
  }

  const api = { get, put, remove, prune };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickNotesStore = api;
})(typeof self !== "undefined" ? self : globalThis);
