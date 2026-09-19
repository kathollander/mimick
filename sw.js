/* The reader's service worker: it keeps a copy of the whole app, so Mimick
 * opens and reads with no network at all, and it gives every response the
 * isolation headers the voice's threads need (SharedArrayBuffer).
 *
 * Kept in versions. VERSION is a hash of every file below, written by
 * tools/stamp_offline.py, so any change to any of them makes a new version,
 * cached whole beside the old. A tab keeps the version it opened with until
 * the page asks for the new one (js/offline.js), so old and new scripts are
 * never mixed -- HANDOFF.md, trap 10.
 *
 * A first visit is not held up: only the page's own small files are cached
 * before this worker takes over, and the rest -- Python, the voice's engine,
 * the MP3 encoder, the voice samples -- is kept as the page loads it and then
 * filled in when the page asks ("complete"), once Python is running. An update
 * is different: nobody is waiting on it, so it caches everything before it can
 * take over. Voice models are kept by js/piper-worker.js in a cache of their
 * own, which this leaves alone.
 *
 * On localhost the files are fetched fresh whenever the server answers, and
 * the cached copy is used only when it does not, so an edit shows on reload
 * and a test can still stop serve.py and reload offline. Registered as
 * sw.js?release (a page opened with ?release), it behaves as it does
 * anywhere else -- tools/check_offline.mjs.
 *
 * The isolation headers are coi-serviceworker's idea (Guido Zuidhof and
 * contributors, MIT), which this replaces.
 */
"use strict";

// --- made by tools/stamp_offline.py; do not edit by hand ----------------------
const VERSION = "373f6a036e340e92";
const FILES = [
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-64.png",
  "icons/maskable-512.png",
  "index.html",
  "js/contents.js",
  "js/convert.js",
  "js/document-worker.js",
  "js/download-count.js",
  "js/find.js",
  "js/mp3-worker.js",
  "js/notes-store.js",
  "js/notes.js",
  "js/ocr.js",
  "js/offline.js",
  "js/page-layout.js",
  "js/page-store.js",
  "js/page-worker.js",
  "js/piper-core.js",
  "js/piper-worker.js",
  "js/pixels.js",
  "js/pronounce.js",
  "js/python.js",
  "js/read-aloud.js",
  "js/reader.js",
  "js/recent.js",
  "js/timing.js",
  "js/tour.js",
  "js/voice-picker.js",
  "js/voices.js",
  "manifest.json",
  "pages.py",
  "py/annotations.py",
  "py/citations.py",
  "py/convert.py",
  "py/document.py",
  "py/layout.py",
  "py/speech.py",
  "reader.html",
  "reader.py",
  "reading.py",
  "sample/sample.pdf",
  "vendor/lamejs/lamejs.iife.js",
  "vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
  "vendor/onnxruntime/ort-wasm-simd-threaded.wasm",
  "vendor/onnxruntime/ort.wasm.min.js",
  "vendor/piper/piper_phonemize.data",
  "vendor/piper/piper_phonemize.js",
  "vendor/piper/piper_phonemize.wasm",
  "vendor/pyodide/pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl",
  "vendor/pyodide/pyodide-lock.json",
  "vendor/pyodide/pyodide.asm.js",
  "vendor/pyodide/pyodide.asm.wasm",
  "vendor/pyodide/pyodide.js",
  "vendor/pyodide/python_stdlib.zip",
  "vendor/tesseract/eng.traineddata.gz",
  "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js",
  "voices/en_GB-southern_english_female-low.mp3",
  "voices/en_GB-vctk-medium.mp3",
  "voices/en_US-joe-medium.mp3",
  "voices/en_US-kathleen-low.mp3",
  "voices/en_US-kusal-medium.mp3",
  "voices/en_US-libritts_r-medium.mp3",
  "voices/en_US-norman-medium.mp3"
];
// --- end of stamp --------------------------------------------------------------

const CACHE = `mimick-app-${VERSION}`;
const LATER = ["vendor/", "voices/"];
const later = (path) => LATER.some((prefix) => path.startsWith(prefix));
const scope = new URL("./", self.location.href).href;
const DEV = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname)
  && !new URL(self.location.href).searchParams.has("release");

/* Fetch files into this version's cache, fresh from the server, skipping any
 * already there. Says how far it has got to anyone listening. */
async function fill(paths, tell = () => {}) {
  const cache = await caches.open(CACHE);
  let done = 0;
  for (const path of paths) {
    const url = scope + path;
    if (!(await cache.match(url))) {
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      await cache.put(url, response);
    }
    tell(++done, paths.length);
  }
}

async function complete() {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const path of FILES) if (!(await cache.match(scope + path))) missing.push(path);
  return missing;
}

self.addEventListener("install", (event) => {
  const update = !!self.registration.active;
  event.waitUntil(fill(update ? FILES : FILES.filter((path) => !later(path))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Older versions go once this one is in charge; the voices stay.
    for (const name of await caches.keys()) {
      if (name.startsWith("mimick-app-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

let completing = null;
self.addEventListener("message", (event) => {
  const { type } = event.data || {};
  const reply = (message) => event.source?.postMessage({ ...message, version: VERSION });
  if (type === "skip-waiting") {
    self.skipWaiting();
  } else if (type === "status") {
    event.waitUntil(complete().then((missing) => reply({ type: "offline", ready: missing.length === 0, missing: missing.length })));
  } else if (type === "complete") {
    completing ??= complete().then((missing) => fill(missing, (done, total) => {
      if (done % 3 === 0 || done === total) reply({ type: "offline-progress", done, total });
    })).finally(() => { completing = null; });
    event.waitUntil(completing.then(() => reply({ type: "offline", ready: true, missing: 0 }),
                                    (err) => reply({ type: "offline", ready: false, error: String(err.message || err) })));
  }
});

// Files being fetched into the cache right now, by path: a promise that
// settles once each is kept (or could not be).
const fetching = new Map();

/* The headers that make the page cross-origin isolated. */
function isolated(response) {
  if (response.status === 0) return response;      // opaque: nothing can be added
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const url = new URL(request.url);
  // The app's own files by path, whatever query they were asked with; a bare
  // folder is its reader.
  let path = url.href.startsWith(scope) ? url.href.slice(scope.length).split(/[?#]/)[0] : null;
  if (path === "") path = "reader.html";
  const ours = path !== null && FILES.includes(path);

  event.respondWith((async () => {
    if (!ours) return isolated(await fetch(request));
    const cache = await caches.open(CACHE);
    const key = scope + path;
    if (DEV) {
      try {
        // By URL: a page load's own request cannot be asked again with other options.
        const fresh = await fetch(url.href, { cache: "no-cache" });
        if (fresh.ok) return isolated(fresh);
      } catch { /* the server is not there: fall back on the copy */ }
      const kept = await cache.match(key);
      if (kept) return isolated(kept);
      return isolated(await fetch(url.href));
    }
    const kept = await cache.match(key);
    if (kept) return isolated(kept);
    // A file of this version not cached yet (the second stage still going):
    // keep it as it passes. On a first visit every Python worker asks for the
    // same 18 MB at once, and Firefox would download it once for each -- four
    // times, on a slow line taking minutes. So only the first ask goes out;
    // the others wait for it to be kept and are answered from the cache.
    let keeping = fetching.get(key);
    if (!keeping) {
      const response = fetch(url.href);
      // Cloned before the page reads the body: this callback runs before the await below.
      keeping = response.then((r) => (r.ok ? cache.put(key, r.clone()) : null))
        .catch(() => null).finally(() => fetching.delete(key));
      fetching.set(key, keeping);
      event.waitUntil(keeping);
      return isolated(await response);
    }
    await keeping;
    return isolated((await cache.match(key)) ?? await fetch(url.href));
  })());
});
