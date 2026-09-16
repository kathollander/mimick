/* Selecting, the text cursor and the right-click menu, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_selecting.mjs
 *
 * Starts a headless Chrome of its own, opens the sample, and drives the reader
 * with real clicks and keys: right-click -> Start reading from here, the cursor
 * following the voice, the arrows and Shift, drag, double-click, Ctrl+A, Ctrl+C,
 * Esc and Enter. The word positions it aims at are the sample's, page 1 --
 * "is also at the", words 158-161 of sentence 3. The voice must be able to load
 * (it is fetched once into the scratch profile, about 60 MB).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(os.tmpdir(), "mimick-check-selecting");
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${profile}`,
                                       "--autoplay-policy=no-user-gesture-required"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());

// The Chrome DevTools Protocol, just enough of it.
async function openTab(url) {
  for (let i = 0; i < 50; i++) { try { await fetch("http://localhost:9333/json/version"); break; } catch { await sleep(200); } }
  const r = await fetch(`http://localhost:9333/json/new?${url}`, { method: "PUT" });
  const { webSocketDebuggerUrl } = await r.json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener("open", ok));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else for (const l of listeners) l(m);
  });
  const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  return { ws, send, evaluate, on: (f) => listeners.push(f) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const t = await openTab("about:blank");
const errors = [];
t.on((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
});
await t.send("Runtime.enable"); await t.send("Network.enable"); await t.send("Network.clearBrowserCache");
await t.send("Browser.grantPermissions", { origin: "http://localhost:8731", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
await t.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await t.send("Page.navigate", { url: "http://localhost:8731/reader.html" });
const ev = t.evaluate;
const wait = async (expr, ms = 90000) => { for (let i = 0; i < ms / 250; i++) { if (await ev(expr)) return true; await sleep(250); } throw new Error("timed out: " + expr); };
await sleep(3000);
await wait(`/Ready/.test(document.getElementById("status")?.textContent || "")`);
await t.evaluate(`localStorage.clear()`);
const { root: dom } = (await t.send("DOM.getDocument")).result;
const { nodeId } = (await t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
await t.send("DOM.setFileInputFiles", { nodeId, files: [path.join(root, "sample/mdpi-sample.pdf")] });
await wait(`!document.getElementById("play").disabled`);
await sleep(500);

const W = 595.276;
const at = async (x, y, page = 0) => JSON.parse(await ev(`(() => { const b = document.querySelector('.page[data-page="${page}"]').getBoundingClientRect(); const s = b.width / ${W}; return JSON.stringify([b.left + ${x} * s, b.top + ${y} * s]); })()`));
const mouse = async (type, [x, y], extra = {}) => t.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
const click = async (p, count = 1) => { for (let c = 1; c <= count; c++) { await mouse("mousePressed", p, { clickCount: c }); await mouse("mouseReleased", p, { clickCount: c }); } };
const KEYS = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, " ": 32, a: 65, c: 67, Home: 36, End: 35 };
const key = async (k, modifiers = 0) => {
  const base = { key: k, code: k === " " ? "Space" : k.length === 1 ? "Key" + k.toUpperCase() : k, windowsVirtualKeyCode: KEYS[k], modifiers };
  await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await t.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};
const state = () => ev(`JSON.stringify({ status: document.getElementById("status").textContent, play: document.getElementById("play").textContent,
  sel: document.querySelectorAll(".hl.selection").length, caret: [...document.querySelectorAll(".caret")].map(c => c.parentElement.dataset.page + "@" + parseFloat(c.style.left).toFixed(2) + "," + parseFloat(c.style.top).toFixed(2)),
  menu: document.getElementById("menu").hidden ? null : [...document.querySelectorAll("#menu button")].map(b => (b.disabled ? "(off) " : "") + b.firstChild.textContent) })`).then(JSON.parse);
const problems = [];
const check = (what, ok, detail) => { console.log(ok ? "  ok  " : "  FAIL", what, detail !== undefined ? "— " + JSON.stringify(detail) : ""); if (!ok) problems.push(what); };

// 1. Right-click on a word.
const is = await at(284, 268);
await t.send("Input.dispatchMouseEvent", { type: "mousePressed", x: is[0], y: is[1], button: "right", buttons: 2, clickCount: 1 });
await t.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: is[0], y: is[1], button: "right", buttons: 0, clickCount: 1 });
await sleep(500);
let s = await state();
check("right-click shows the menu with Start reading from here", s.menu && s.menu[0] === "Start reading from here", s.menu);
const item = JSON.parse(await ev(`(() => { const b = document.querySelector("#menu button").getBoundingClientRect(); return JSON.stringify([b.left + 20, b.top + b.height / 2]); })()`));
await click(item);
await wait(`document.getElementById("play").textContent === "Pause"`, 60000);
await wait(`/Sentence/.test(document.getElementById("status").textContent)`, 60000);
s = await state();
check("…and it reads from the sentence clicked (sentence 4)", /Sentence 4 of/.test(s.status), s.status);
await sleep(1500);
check("the cursor follows the voice", (await state()).caret.length === 1, (await state()).caret);

// 2. Pause, then the arrows move the cursor.
await key(" ");
await wait(`document.getElementById("play").textContent === "Resume"`);
await click(is);          // a click reads again -- so pause after
await sleep(800);
await key(" "); await sleep(300);
if ((await state()).play !== "Resume") { await key(" "); await sleep(300); }
const before = (await state()).caret[0];
await key("ArrowRight"); await sleep(300);
const after = (await state()).caret[0];
check("→ moves the cursor a word while paused", before !== after, [before, after]);
await key("ArrowDown"); await sleep(300);
const down = (await state()).caret[0];
check("↓ moves it down a line", parseFloat(down.split(",")[1]) > parseFloat(after.split(",")[1]), [after, down]);
await key("ArrowUp"); await sleep(300);
await key("ArrowRight", 8); await key("ArrowRight", 8); await key("ArrowRight", 8); await sleep(500);
s = await state();
check("Shift+→ ×3 selects three words", /^3 words selected/.test(s.status) && s.sel > 0, [s.status, s.sel]);
await key("c", 2); await sleep(400);
const copied = await ev(`navigator.clipboard.readText()`);
check("Ctrl+C copies them", /Copied 3 words/.test((await state()).status) && copied.split(" ").length === 3, copied);
await key("Escape"); await sleep(300);
check("Esc clears the selection", (await state()).sel === 0);
await key("End"); await sleep(300);
await key("Home", 8); await sleep(400);
s = await state();
check("End, then Shift+Home selects the line", /words selected/.test(s.status) && s.sel === 1, [s.status, s.sel]);

// 3. Drag to select.
await key("Escape");
const from = await at(283, 268), to = await at(330, 268);
await mouse("mousePressed", from); await sleep(150);
for (let k = 1; k <= 5; k++) { await mouse("mouseMoved", [from[0] + (to[0] - from[0]) * k / 5, from[1]]); await sleep(60); }
await mouse("mouseReleased", to); await sleep(600);
s = await state();
check("dragging selects is also at the", /^4 words selected/.test(s.status) && s.sel === 1, [s.status, s.sel]);
await key("c", 2); await sleep(400);
check("…and copies as 'is also at the'", (await ev(`navigator.clipboard.readText()`)) === "is also at the", await ev(`navigator.clipboard.readText()`));

// 4. Double-click selects a sentence (words 157-165 = 9 words).
await click(is, 2); await sleep(900);
s = await state();
check("double-click selects the sentence", /^9 words selected/.test(s.status), [s.status, s.play]);
check("…and does not leave reading going", s.play !== "Pause", s.play);

// 5. Enter reads the selection.
await key("Enter");
await wait(`/Reading your selection/.test(document.getElementById("status").textContent)`, 60000);
check("Enter reads the selection", true);
await key(" "); await sleep(300);

// 6. Ctrl+A selects the page; right-click now offers the selection.
await key("a", 2); await sleep(500);
s = await state();
check("Ctrl+A selects the page", /words selected/.test(s.status) && s.sel > 10, [s.status, s.sel]);
const gap = await at(40, 40);
await t.send("Input.dispatchMouseEvent", { type: "mousePressed", x: gap[0], y: gap[1], button: "right", buttons: 2, clickCount: 1 });
await t.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: gap[0], y: gap[1], button: "right", buttons: 0, clickCount: 1 });
await sleep(400);
s = await state();
check("right-click off the text: Start greyed, Read the selection and Copy offered",
      JSON.stringify(s.menu) === JSON.stringify(["(off) Start reading from here", "Read the selection", "Copy"]), s.menu);
await key("Escape"); await sleep(200);
check("Esc closes the menu", (await state()).menu === null);
check("no errors on the page", errors.length === 0, errors);
console.log(problems.length ? `${problems.length} FAILED` : "all passed");
chrome.kill();
process.exit(problems.length ? 1 : 0);
