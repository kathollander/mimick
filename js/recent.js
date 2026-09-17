/* Open Recent: the last files opened, kept as the browser's own file handles
 * (IndexedDB), so File ▾ can open one again without hunting for it.
 *
 * Only Chromium browsers give a page file handles -- from its open window
 * (showOpenFilePicker), a drop, or the installed app being chosen to open a
 * file. Elsewhere, and for a file chosen the old way, there is nothing to keep,
 * and File ▾ shows no recent files. A handle is not the file: opening one again
 * asks the browser, which may ask the reader for permission once a visit, and
 * a file since moved or deleted cannot be found.
 *
 *   MimickRecent.supported        handles can be kept here
 *   MimickRecent.add(handle)      a file just opened; the newest first, KEEP at most
 *   MimickRecent.list()           [{ id, name, opened }], newest first (cached)
 *   MimickRecent.file(id)         the File, asking permission if need be (call in a click)
 *   MimickRecent.remove(id) / clear()
 *   MimickRecent.load()           read the list from storage; a promise
 */
(function (root) {
  "use strict";

  const KEEP = 8;
  const supported = "FileSystemFileHandle" in root && "indexedDB" in root;
  let entries = [];            // [{ id, name, opened, handle }], newest first

  let opening = null;
  function db() {
    opening ??= new Promise((resolve) => {
      let request;
      try { request = indexedDB.open("mimick-recent", 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    });
    return opening;
  }
  const done = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function load() {
    if (!supported) return [];
    const store = await db();
    if (!store) return [];
    try {
      entries = (await done(store.transaction("files").objectStore("files").getAll()))
        .sort((a, b) => b.opened - a.opened);
    } catch {
      entries = [];
    }
    return list();
  }

  async function add(handle) {
    if (!supported || !(handle instanceof root.FileSystemFileHandle)) return;
    const store = await db();
    if (!store) return;
    // The same file opened again moves to the top rather than being listed twice.
    let same = null;
    for (const entry of entries) {
      try { if (await entry.handle.isSameEntry(handle)) { same = entry; break; } } catch { /* a stale handle */ }
    }
    const entry = { id: same?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: handle.name, opened: Date.now(), handle };
    entries = [entry, ...entries.filter((e) => e !== same)];
    const dropped = entries.slice(KEEP);
    entries = entries.slice(0, KEEP);
    try {
      const files = store.transaction("files", "readwrite").objectStore("files");
      files.put(entry);
      for (const old of dropped) files.delete(old.id);
    } catch { /* storage refused: the list lasts this visit only */ }
  }

  const list = () => entries.map(({ id, name, opened }) => ({ id, name, opened }));

  /* The file itself. Throws with a message fit to show when it cannot be had. */
  async function file(id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error("it is no longer in the list");
    const options = { mode: "read" };
    let permission = await entry.handle.queryPermission?.(options) ?? "granted";
    if (permission !== "granted") permission = await entry.handle.requestPermission(options);
    if (permission !== "granted") throw new Error("the browser was not allowed to open it");
    try {
      const got = await entry.handle.getFile();
      add(entry.handle);
      return got;
    } catch {
      throw new Error("it could not be found — it may have been moved, renamed or deleted");
    }
  }

  async function remove(id) {
    entries = entries.filter((e) => e.id !== id);
    const store = await db();
    try { store?.transaction("files", "readwrite").objectStore("files").delete(id); } catch { /* not kept */ }
  }

  async function clear() {
    entries = [];
    const store = await db();
    try { store?.transaction("files", "readwrite").objectStore("files").clear(); } catch { /* not kept */ }
  }

  root.MimickRecent = { supported, KEEP, load, add, list, file, remove, clear };
})(typeof self !== "undefined" ? self : globalThis);
