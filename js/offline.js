/* The page's half of sw.js: register it, make the page cross-origin isolated,
 * have the whole app kept for offline use, and move to a new version only when
 * that cannot interrupt anything.
 *
 * Loaded in the <head>, before anything else. The first visit has no service
 * worker in charge, so no isolation headers and no threads for the voice: once
 * the worker has taken over, the page reloads, once, before the reader starts
 * (`MimickOffline.reloading` tells it not to).
 *
 *   MimickOffline.onChange(fn)   fn(state), now and on every change:
 *       { supported, ready, done, total, error, updateReady, version }
 *   MimickOffline.complete()     keep everything for offline use; the reader
 *                                asks once Python has loaded
 *   MimickOffline.update()       switch to the waiting version, and reload
 */
(function (root) {
  "use strict";

  const sw = navigator.serviceWorker;
  const state = { supported: !!sw && root.isSecureContext, ready: false, done: 0, total: 0,
                  error: null, updateReady: false, version: null };
  const listeners = [];
  const changed = (patch) => {
    Object.assign(state, patch);
    for (const fn of listeners) { try { fn({ ...state }); } catch (err) { console.error(err); } }
  };

  const api = root.MimickOffline = {
    reloading: false,
    get state() { return { ...state }; },
    onChange(fn) { listeners.push(fn); fn({ ...state }); },
    complete() {},
    update() {},
  };
  if (!state.supported) return;

  // One reload to become isolated; never a loop, if something stops it working.
  const TRIED = "mimick-isolation-reload";
  let tried = false;
  try { tried = sessionStorage.getItem(TRIED) === "1"; } catch { /* private mode */ }
  if (!root.crossOriginIsolated && !tried) {
    api.reloading = true;
    try { sessionStorage.setItem(TRIED, "1"); } catch { /* reloads once at most anyway */ }
  } else if (root.crossOriginIsolated) {
    try { sessionStorage.removeItem(TRIED); } catch { /* nothing kept */ }
  }

  let updating = false;
  sw.addEventListener("controllerchange", () => {
    if (api.reloading || updating) root.location.reload();
  });
  sw.addEventListener("message", ({ data }) => {
    if (!data) return;
    if (data.type === "offline-progress") changed({ done: data.done, total: data.total, version: data.version });
    if (data.type === "offline") changed({ ready: !!data.ready, error: data.error || null, version: data.version,
                                           ...(data.ready ? { done: state.total || 0 } : {}) });
  });

  // ?release: the service worker as served anywhere but this machine, for testing.
  const script = new URLSearchParams(root.location.search).has("release") ? "sw.js?release" : "sw.js";
  sw.register(script).then((registration) => {
    if (api.reloading) {
      // Already running (a hard reload leaves the page out of its hands): reload
      // into it. Otherwise it takes charge once installed, and controllerchange reloads.
      if (sw.controller || registration.active) root.location.reload();
      return;
    }
    const waiting = () => {
      if (registration.waiting && sw.controller) changed({ updateReady: true });
    };
    waiting();
    registration.addEventListener("updatefound", () => {
      const next = registration.installing;
      next?.addEventListener("statechange", () => { if (next.state === "installed") waiting(); });
    });

    api.update = () => {
      if (!registration.waiting) return false;
      updating = true;
      registration.waiting.postMessage({ type: "skip-waiting" });
      return true;
    };
    api.complete = () => {
      sw.ready.then((active) => active.active?.postMessage({ type: "complete" }));
    };
    if (sw.controller) sw.controller.postMessage({ type: "status" });
  }).catch((err) => {
    if (api.reloading) { root.location.reload(); return; }   // once: the next load carries on without it
    changed({ supported: false, error: String(err.message || err) });
    console.warn("Mimick: the offline copy could not be set up:", err);
  });
})(window);
