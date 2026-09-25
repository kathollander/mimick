/* Counts what a Python worker downloads while it starts, for the page's
 * progress bar. Pyodide fetches its runtime, its standard library and the PDF
 * library with the worker's own `fetch`, so this wraps it and counts the bytes
 * as they arrive -- from the network on a first visit, from the cache after.
 * The bytes are the ones read, after any gzip, so they add up to the files'
 * own sizes whatever the server did (reader.js, DOWNLOAD_BYTES).
 *
 *   const stop = countDownloads((bytes, open) => ...)
 *       bytes so far, and how many fetches are still coming in, at most every
 *       quarter second; stop() puts fetch back and says the last
 *
 * Loaded by js/document-worker.js and js/page-worker.js before Pyodide.
 */
self.countDownloads = function countDownloads(onBytes) {
  "use strict";
  const real = self.fetch;
  let bytes = 0, open = 0, told = "", timer = 0;
  const tell = () => {
    timer = 0;
    if (`${bytes} ${open}` !== told) { told = `${bytes} ${open}`; onBytes(bytes, open); }
  };
  const later = () => { timer ||= setTimeout(tell, 250); };
  const closed = () => { open--; later(); };
  self.fetch = async (...args) => {
    open++;
    later();
    let response;
    try { response = await real.apply(self, args); } catch (err) { closed(); throw err; }
    // An opaque or bodiless answer cannot be rebuilt; pass it on as it is.
    if (!response.body || response.type === "opaque" || response.status < 200) { closed(); return response; }
    const counted = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        later();
        controller.enqueue(chunk);
      },
      flush: closed,
    }));
    return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return () => {
    self.fetch = real;
    clearTimeout(timer);
    tell();
  };
};
