/* Media keys, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_media.mjs
 *
 * Presses a keyboard's play/pause, next and previous keys on the poem
 * (sample/sample.pdf) and checks they start, skip and pause reading, and that the
 * browser's media controls are told what is playing (Media Session: the
 * document's title, the voice, playing or paused). Shares check_convert's
 * profile, so the voice it downloaded is already there.
 */
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const r = await startReader("check-convert");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await r.openPdf(path.join(root, "sample/sample.pdf"));

const VK = { MediaPlayPause: 179, MediaTrackNext: 176, MediaTrackPrevious: 177, MediaStop: 178 };
const press = async (key) => {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await r.t.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: VK[key] });
  }
};
const state = () => ev(`JSON.stringify({
  play: document.getElementById("play").textContent,
  status: document.getElementById("status").textContent,
  session: navigator.mediaSession.playbackState,
  title: navigator.mediaSession.metadata?.title ?? null,
  artist: navigator.mediaSession.metadata?.artist ?? null })`).then(JSON.parse);

await r.click(await r.at(40, 40));
await press("MediaPlayPause");
await wait(`document.getElementById("play").textContent === "Pause"`, 120000).catch(() => {});
await wait(`/^Sentence \\d+ of/.test(document.getElementById("status").textContent)`, 60000).catch(() => {});
let s = await state();
check("the play/pause key starts reading", s.play === "Pause" && /^Sentence 1 of/.test(s.status), s);
check("…and tells the browser's media controls what is playing", s.session === "playing" && s.title && /^Mimick · Norman/.test(s.artist), s);

await press("MediaTrackNext"); await sleep(1500);
s = await state();
check("the next-track key goes on a sentence", /^Sentence 2 of/.test(s.status), s.status);
await press("MediaTrackPrevious"); await sleep(1500);
s = await state();
check("the previous-track key goes back one", /^Sentence 1 of/.test(s.status), s.status);

await press("MediaPlayPause"); await sleep(600);
s = await state();
check("play/pause again pauses", s.play === "Resume" && s.session === "paused", s);
await press("MediaStop"); await sleep(600);
s = await state();
check("the stop key stops", s.play === "Read aloud" && s.session === "none", s);
r.finish();
