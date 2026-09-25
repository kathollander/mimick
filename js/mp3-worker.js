/* MP3 encoding for Convert to MP3, off the page's thread.
 *
 * LAME, as vendor/lamejs. The desktop hands raw audio to ffmpeg's libmp3lame
 * once it is all made; here each sentence is encoded as it arrives, so what is
 * written to the file grows with the conversion rather than waiting for it.
 *
 * Messages in, each answered once with { type: "encoded", id, bytes } or
 * { type: "error", id, message }:
 *   { type: "start", id, sampleRate, kbps }   a new file
 *   { type: "add", id, samples, gap }         a sentence's audio, then `gap` seconds of silence
 *   { type: "finish", id }                    the last of it
 */
importScripts("../vendor/lamejs/lamejs.iife.js");

let encoder = null, sampleRate = 0;

self.onmessage = ({ data }) => {
  try {
    if (data.type === "start") {
      encoder = new lamejs.Mp3Encoder(1, data.sampleRate, data.kbps);
      sampleRate = data.sampleRate;
      reply(data.id, new Int8Array(0));
    } else if (data.type === "add") {
      if (!encoder) throw new Error("no file started");
      reply(data.id, encoder.encodeBuffer(pcm(data.samples, Math.round((data.gap || 0) * sampleRate))));
    } else if (data.type === "finish") {
      if (!encoder) throw new Error("no file started");
      const last = encoder.flush();
      encoder = null;
      reply(data.id, last);
    } else {
      throw new Error(`no such message: ${data.type}`);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: data.id, message: err.message });
  }
};

/* The voice's samples, -1 to 1, as 16-bit, with silence after. */
function pcm(samples, silence) {
  const out = new Int16Array(samples.length + silence);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/* The encoder hands back a view of its own buffer, which it reuses: copy it. */
function reply(id, view) {
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  self.postMessage({ type: "encoded", id, bytes }, [bytes.buffer]);
}
