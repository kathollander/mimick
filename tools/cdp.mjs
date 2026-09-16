/* Driving the reader in a real Chrome, for the check tools that need one.
 *
 * Starts a headless Chrome with a scratch profile of its own, opens
 * reader.html from serve.py (port 8731), and gives real mouse and key input
 * through the DevTools protocol -- the page cannot tell it from a person's.
 *
 *   const r = await startReader("check-notes");
 *   await r.openPdf(path); await r.click(await r.at(284, 268)); await r.key("h", CTRL);
 *   r.check("what", ok, detail); r.finish();
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CTRL = 2, SHIFT = 8;
const PORT = 9333;
const KEYS = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, " ": 32,
               Home: 36, End: 35, Delete: 46 };

async function openTab(url) {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch { await sleep(200); }
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://localhost:${PORT}/json/new?${url}`, { method: "PUT" })).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener("open", ok));
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else for (const l of listeners) l(m);
  });
  const send = (method, params = {}) => new Promise((ok) => {
    const i = ++id;
    pending.set(i, ok);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  return { send, evaluate, on: (f) => listeners.push(f) };
}

/* A headless Chrome showing reader.html, with localStorage and the notes kept
 * in the browser cleared. `name` names the scratch profile. */
export async function startReader(name) {
  const profile = path.join(os.tmpdir(), "mimick-" + name);
  fs.mkdirSync(profile, { recursive: true });
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-downloads-"));
  const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
                                         "--autoplay-policy=no-user-gesture-required"], { stdio: "ignore" });
  process.on("exit", () => chrome.kill());

  const t = await openTab("about:blank");
  const errors = [];
  t.on((m) => {
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });
  await t.send("Runtime.enable");
  await t.send("Network.enable");
  await t.send("Network.clearBrowserCache");
  await t.send("Browser.grantPermissions", { origin: "http://localhost:8731",
                                             permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await t.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await t.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = t.evaluate;
  const wait = async (expr, ms = 90000) => {
    for (let i = 0; i < ms / 250; i++) { if (await ev(expr)) return true; await sleep(250); }
    throw new Error("timed out waiting for " + expr);
  };
  const mouse = (type, [x, y], extra = {}) => t.send("Input.dispatchMouseEvent",
    { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const problems = [];

  const r = {
    t, ev, wait, errors, downloads, sleep,
    async load() {
      await t.send("Page.navigate", { url: "http://localhost:8731/reader.html" });
      await sleep(2500);
      await wait(`/Ready/.test(document.getElementById("status")?.textContent || "")`);
    },
    async reset() {
      await ev(`localStorage.clear()`);
      await ev(`new Promise((ok) => { const q = indexedDB.deleteDatabase("mimick-notes"); q.onsuccess = q.onerror = q.onblocked = ok; })`);
      await r.load();
    },
    /* Open a PDF and wait for its sentences. */
    async openPdf(file) {
      const { root: dom } = (await t.send("DOM.getDocument")).result;
      const { nodeId } = (await t.send("DOM.querySelector", { nodeId: dom.nodeId, selector: "#file" })).result;
      await t.send("DOM.setFileInputFiles", { nodeId, files: [file] });
      await sleep(300);
      await wait(`!document.getElementById("play").disabled`);
      await sleep(500);
    },
    /* A point on a page, in PDF points, as a point on the screen. */
    async at(x, y, page = 0) {
      return JSON.parse(await ev(`(() => { const p = document.querySelector('.page[data-page="${page}"]');
        const b = p.getBoundingClientRect(), s = b.width / 595.276; return JSON.stringify([b.left + ${x} * s, b.top + ${y} * s]); })()`));
    },
    /* The middle of an element on the screen. */
    async centre(selector) {
      return JSON.parse(await ev(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return JSON.stringify([b.left + b.width / 2, b.top + b.height / 2]); })()`));
    },
    mouse,
    async click(p, count = 1) {
      for (let c = 1; c <= count; c++) {
        await mouse("mousePressed", p, { clickCount: c });
        await mouse("mouseReleased", p, { clickCount: c });
      }
    },
    async rightClick([x, y]) {
      await t.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
      await t.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
      await sleep(400);
    },
    async drag(from, to, steps = 6) {
      await mouse("mousePressed", from);
      await sleep(150);
      for (let k = 1; k <= steps; k++) {
        await mouse("mouseMoved", [from[0] + (to[0] - from[0]) * k / steps, from[1] + (to[1] - from[1]) * k / steps]);
        await sleep(60);
      }
      await mouse("mouseReleased", to);
      await sleep(500);
    },
    async key(k, modifiers = 0) {
      const code = k === " " ? "Space" : k.length === 1 ? "Key" + k.toUpperCase() : k;
      const vk = KEYS[k] ?? k.toUpperCase().charCodeAt(0);
      await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
    },
    async type(text) { await t.send("Input.insertText", { text }); },
    /* Choose a menu entry by its label. */
    async menu(label) {
      const p = await ev(`(() => { const b = [...document.querySelectorAll("#menu button")].find((b) => b.querySelector(".label").lastChild.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify([r.left + 20, r.top + r.height / 2]); })()`);
      if (!p) throw new Error("no menu entry " + label);
      await r.click(JSON.parse(p));
      await sleep(300);
    },
    status: () => ev(`document.getElementById("status").textContent`),
    menuLabels: () => ev(`document.getElementById("menu").hidden ? null
      : [...document.querySelectorAll("#menu button")].map((b) => (b.disabled ? "(off) " : "") + b.querySelector(".label").lastChild.textContent.trim())`),
    check(what, ok, detail) {
      console.log(ok ? "  ok  " : "  FAIL", what, detail !== undefined ? "— " + JSON.stringify(detail) : "");
      if (!ok) problems.push(what);
    },
    finish() {
      r.check("no errors on the page", errors.length === 0, errors);
      console.log(problems.length ? `${problems.length} FAILED` : "all passed");
      chrome.kill();
      process.exit(problems.length ? 1 : 0);
    },
  };
  return r;
}
