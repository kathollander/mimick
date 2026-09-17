/* How to say words: the pronunciation list, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_say.mjs
 *
 * On the poem (sample/sample.pdf): selects its first word, right-clicks, and
 * checks the menu offers to teach it; adds a sound-alike in the dialog, and
 * checks it is listed, kept over a reload, and removable. Then, in the voice
 * worker itself, that a sentence is said with the sound-alike -- different sound
 * -- while its timings still come back under the printed word, so the page
 * lights the right one; and that reading aloud with the list set lights words
 * as usual. Shares check_convert's profile, for its downloaded voice.
 */
import path from "node:path";
import { SHIFT, root, startReader } from "./cdp.mjs";

const r = await startReader("check-convert");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`localStorage.setItem("mimick-click_read", "0")`);
await r.openPdf(path.join(root, "sample/sample.pdf"));

const listed = () => ev(`[...document.querySelectorAll("#say-list .say-row")].map((row) =>
  row.querySelector(".word").textContent + " → " + row.querySelector(".as").textContent)`);

// 1. Right-click a selected word.
await r.click(await r.at(80, 60)); await sleep(300);
await r.key("Home"); await sleep(200);
await r.key("ArrowRight", SHIFT); await sleep(800);
await r.rightClick(await r.at(80, 60));
const offered = await r.menuLabels();
check("right-clicking one selected word offers to teach how to say it", offered?.includes("How to say “Once”…"), offered);
await r.menu("How to say “Once”…");
check("…which opens the list with the word filled in", await ev(`document.getElementById("say-dialog").open
  && document.getElementById("say-word").value === "Once" && document.activeElement.id === "say-as"`));
await r.type("wunss"); await r.key("Enter"); await sleep(300);
check("Enter adds it to the list", JSON.stringify(await listed()) === JSON.stringify(["Once → wunss"]), await listed());
await r.click(await r.centre("#say-word")); await r.type("dreary");
await r.click(await r.centre("#say-as")); await r.type("dree ree");
await r.click(await r.centre("#say-add")); await sleep(300);
check("a sound-alike of two words is joined into one", (await listed()).includes("dreary → dree-ree"), await listed());
await r.key("Escape"); await sleep(300);

// 2. Kept, and removable.
await r.load();
await r.click(await r.centre("#display-menu")); await sleep(300);
await r.menu("How to say words…");
check("kept over a reload, and found under Display", JSON.stringify(await listed()) === JSON.stringify(["Once → wunss", "dreary → dree-ree"]), await listed());
await r.click(await ev(`(() => { const b = document.querySelector("#say-list .say-row button").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`));
await sleep(300);
check("✕ takes one off the list", JSON.stringify(await listed()) === JSON.stringify(["dreary → dree-ree"]), await listed());
await r.key("Escape"); await sleep(300);

// 3. Reading with it: the words are still lit.
await r.openPdf(path.join(root, "sample/sample.pdf"));
await r.click(await r.centre("#play"));
await wait(`document.querySelector(".hl.word") !== null`, 120000).catch(() => {});
check("reading aloud with the list set lights each word as usual", await ev(`document.querySelector(".hl.word") !== null`), await r.status());
await r.click(await r.centre("#play")); await sleep(300);

// 4. In the voice worker: another sound, the same printed words.
const said = await r.inWorker("piper-worker.js", `(async () => {
  const text = "Once upon a midnight dreary, while I pondered, weak and weary.";
  const plain = await voice.speak(text);
  const swapped = MimickPronounce.apply(text, [["dreary", "dree-ree"]]);
  const other = await voice.speak(swapped.text);
  return { swapped: swapped.text, plain: plain.samples.length, other: other.samples.length,
           words: MimickPronounce.unswap(other.marks, swapped.back).map((m) => m.word) };
})()`);
check("the voice is given the sound-alike", said?.swapped === "Once upon a midnight dree-ree, while I pondered, weak and weary.", said?.swapped);
check("…which sounds different", said && said.plain !== said.other, said && [said.plain, said.other]);
check("…and its timing comes back under the printed word", said?.words?.some((w) => /^dreary/i.test(w)) && !said.words.some((w) => /dree/i.test(w)), said?.words);
r.finish();
