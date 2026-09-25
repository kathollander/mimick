/* MuPDF gives a page as RGB; ImageData wants RGBA. Shared by the document
 * worker and tools/check_reader.mjs. */
(function (root) {
  "use strict";

  function rgbToRgba(rgb, width, height) {
    const count = width * height;
    if (rgb.length < count * 3) throw new Error(`${rgb.length} bytes is not a ${width}×${height} RGB image`);
    const out = new Uint8ClampedArray(count * 4);
    for (let i = 0, j = 0; i < count; i++, j += 3) {
      const k = i * 4;
      out[k] = rgb[j];
      out[k + 1] = rgb[j + 1];
      out[k + 2] = rgb[j + 2];
      out[k + 3] = 255;
    }
    return out;
  }

  const api = { rgbToRgba };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickPixels = api;
})(typeof self !== "undefined" ? self : globalThis);
