/* The reader in Firefox, driven through WebDriver (geckodriver).
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_firefox.mjs
 *
 * Needs Firefox and geckodriver (`firefox.geckodriver` with the snap, or
 * `geckodriver`). Headless. Checks the page gets cross-origin isolation and
 * Python, opens the test paper with its contents, finds text, highlights a
 * page and keeps it over a reload, saves a copy and exports notes as downloads
 * (Firefox has no save window for pages), and opens a Word file. With --voice
 * it also downloads Norman and reads a sentence aloud.
 *
 * Firefox as a snap cannot write outside the home folder, so downloads go to a
 * scratch folder there, removed at the end.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4455;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (what, ok, detail) => {
  console.log(ok ? "  ok  " : "  FAIL", what, detail !== undefined ? "— " + JSON.stringify(detail) : "");
  if (!ok) problems.push(what);
};

const driver = ["firefox.geckodriver", "geckodriver"].find((name) => {
  try { execFileSync("which", [name], { stdio: "ignore" }); return true; } catch { return false; }
});
if (!driver) { console.log("No geckodriver found; skipped."); process.exit(0); }

const downloads = fs.mkdtempSync(path.join(os.homedir(), "mimick-firefox-"));
const gecko = spawn(driver, ["--port", String(PORT)], { stdio: "ignore" });
let session = null;
const finish = async (code) => {
  if (session) await fetch(`http://localhost:${PORT}/session/${session}`, { method: "DELETE" }).catch(() => {});
  gecko.kill();
  fs.rmSync(downloads, { recursive: true, force: true });
  process.exit(code);
};

const wd = async (method, url, body) => {
  const res = await fetch(`http://localhost:${PORT}${session ? `/session/${session}` : ""}${url}`, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
};
const js = (script, ...args) => wd("POST", "/execute/sync", { script, args });
const wait = async (script, ms = 60000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (await js(script)) return true;
  return false;
};
const element = async (css) => Object.values(await wd("POST", "/element", { using: "css selector", value: css }))[0];
const click = async (css) => wd("POST", `/element/${await element(css)}/click`, {});
const keys = (...sequence) => wd("POST", "/actions", { actions: [{ type: "key", id: "k", actions: sequence.flatMap((k) =>
  Array.isArray(k) ? [...k.map((v) => ({ type: "keyDown", value: v })), ...[...k].reverse().map((v) => ({ type: "keyUp", value: v }))]
    : [...k].flatMap((v) => [{ type: "keyDown", value: v }, { type: "keyUp", value: v }])) }] });
const CTRL = "\uE009";
const openFile = async (file) => wd("POST", `/element/${await element("#file")}/value`, { text: file });
const status = () => js(`return document.getElementById("status").textContent`);

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/status`); break; } catch { await sleep(200); } }
  ({ sessionId: session } = await wd("POST", "/session", { capabilities: { alwaysMatch: { "moz:firefoxOptions": {
    args: ["-headless"],
    prefs: { "browser.download.folderList": 2, "browser.download.dir": downloads, "browser.download.useDownloadDir": true,
             "browser.download.always_ask_before_handling_new_types": false, "pdfjs.disabled": true } } } } }));
  await wd("POST", "/window/rect", { width: 1400, height: 900 });
  await wd("POST", "/url", { url: "http://localhost:8731/reader.html" });
  const ready = await wait(`return /Ready/.test(document.getElementById("status").textContent)`, 120000);
  check("the page gets ready", ready, await status());
  check("…cross-origin isolated, so the voice can use threads", await js(`return crossOriginIsolated`));
  await js(`localStorage.setItem("mimick-click_read", "0")`);

  await openFile(path.join(root, "sample/test-paper.pdf"));
  await wait(`return !document.getElementById("play").disabled`);
  // Not the status line: on a first visit "Ready to work offline" can land on top of it.
  check("the test paper opens, with sentences to read", (await js(`return document.getElementById("total").textContent`)) === "of 3"
    && !(await js(`return document.getElementById("play").disabled`)), await status());
  check("…and its contents", (await js(`return document.querySelectorAll("#contents-list .toc-row").length`)) === 6);

  await click("#view");
  await keys([CTRL, "f"]); await sleep(300);
  await keys("voice"); await sleep(1500);
  check("Ctrl+F finds text", (await js(`return document.getElementById("find-count").textContent`)) === "1 of 5",
        await js(`return document.getElementById("find-count").textContent`));
  await keys("\uE00C"); await sleep(300);   // Escape

  const before = await js(`return document.querySelectorAll(".hl.annot").length`);
  await click("#view");
  await keys([CTRL, "a"]); await sleep(500);
  await keys([CTRL, "h"]); await sleep(1500);
  const after = await js(`return document.querySelectorAll(".hl.annot").length`);
  check("Ctrl+A, Ctrl+H highlights the page", after > before, [before, after]);
  await sleep(1500);
  await wd("POST", "/refresh", {});
  await wait(`return /Ready/.test(document.getElementById("status").textContent)`, 120000);
  await openFile(path.join(root, "sample/test-paper.pdf"));
  await wait(`return document.querySelectorAll(".hl.annot").length > 1`, 20000);
  check("…and the highlight comes back after a reload", (await js(`return document.querySelectorAll(".hl.annot").length`)) === after);

  await click("#view");
  await keys([CTRL, "s"]);
  const saved = await (async () => { for (let i = 0; i < 40; i++) { await sleep(250); const f = fs.readdirSync(downloads).find((n) => n.endsWith(".pdf")); if (f) return f; } return null; })();
  check("Ctrl+S downloads a copy", saved === "test-paper (notes).pdf", saved);
  await click("#file-menu"); await sleep(300);
  await js(`[...document.querySelectorAll("#menu button")].find((b) => b.textContent.startsWith("Export notes")).click()`);
  const md = await (async () => { for (let i = 0; i < 40; i++) { await sleep(250); const f = fs.readdirSync(downloads).find((n) => n.endsWith(".md")); if (f) return f; } return null; })();
  check("Export notes downloads the notes", md === "test-paper (notes).md", md);

  await openFile(path.join(root, "sample/test-document.docx"));
  await wait(`return document.getElementById("title").textContent === "Notes on Listening" && !document.getElementById("play").disabled`, 30000);
  check("a Word file opens", /^1 page · \d+ sentences to read/.test(await status()), await status());

  if (process.argv.includes("--voice")) {
    await click("#play");
    const reading = await wait(`return /^Sentence [2-9]/.test(document.getElementById("status").textContent)`, 180000);
    check("reads aloud, with the word lit", reading && await js(`return document.querySelector(".hl.word") !== null`), await status());
    await click("#play");
  }
} catch (err) {
  check("no WebDriver errors", false, err.message);
}
console.log(problems.length ? `${problems.length} FAILED` : "all passed");
await finish(problems.length ? 1 : 0);
