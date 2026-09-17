/* Working offline, installing, and updating, in a real Chrome.
 *
 *     node tools/check_offline.mjs
 *
 * Needs no serve.py: it copies the app into a scratch folder and serves that
 * on port 8732, so it can stop the server and change files without touching
 * this repo. The page is opened as reader.html?release, so sw.js behaves as it
 * does on the real site (cache first) rather than as on localhost.
 *
 *   1. sw.js is stamped for the files as they are (tools/stamp_offline.py).
 *   2. The first visit ends up cross-origin isolated and installable, and
 *      About says when everything is kept.
 *   3. With the server stopped, the page reloads, opens a PDF and has the
 *      voice's engine and samples to hand.
 *   4. A changed file on the server makes a new version, which a tab with a
 *      document open does not pick up piecemeal -- it is offered under Help,
 *      and taken whole.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { root, startReader } from "./cdp.mjs";

const PORT = 8732;
execFileSync("python3", [path.join(root, "tools/stamp_offline.py"), "--check"], { stdio: "inherit" });

// The app, copied: everything sw.js lists, and the server.
const site = fs.mkdtempSync(path.join(os.tmpdir(), "mimick-offline-site-"));
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const listed = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]);
for (const file of [...listed, "sw.js", "serve.py"]) {
  fs.mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(site, file));
}
let server = null;
const serve = async () => {
  server = spawn("python3", [path.join(site, "serve.py"), String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${PORT}/reader.html`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("the scratch server did not start");
};
const stop = async () => { server.kill(); await new Promise((r) => server.on("exit", r)); };
process.on("exit", () => server?.kill());
await serve();

const r = await startReader("check-offline", { port: PORT });
const { ev, wait, sleep, check, t } = r;
// A clean profile each run: no service worker or caches from last time.
await t.send("Storage.clearDataForOrigin", { origin: `http://localhost:${PORT}`, storageTypes: "all" });
await r.load("?release");
const about = () => ev(`document.getElementById("about-offline").textContent`);

// 2. The first visit.
check("the page is cross-origin isolated, under the service worker",
      await ev(`crossOriginIsolated && !!navigator.serviceWorker.controller`));
const { result: { errors: installErrors = [] } = {} } = await t.send("Page.getInstallabilityErrors");
check("Chrome finds it installable", installErrors.length === 0, installErrors);
const manifest = await ev(`fetch("manifest.json").then((r) => r.json())`);
check("the manifest names it and has its icons", manifest.short_name === "Mimick"
      && manifest.icons.every((icon) => fs.existsSync(path.join(root, icon.src))), manifest.icons);
await wait(`/^Ready:/.test(document.getElementById("about-offline").textContent)`, 180000);
check("About says when everything is kept", /^Ready:/.test(await about()), await about());
const cached = await ev(`caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith("mimick-app-"))
  .map((n) => caches.open(n).then((c) => c.keys()).then((k) => k.length))))`);
check("…every file of one version, and no other", cached.length === 1 && cached[0] === listed.length, [cached, listed.length]);

// 3. No server.
await stop();
await r.load("?release");
check("with the server stopped, the page still loads and gets ready", /Ready/.test(await r.status()), await r.status());
check("…still isolated, so the voice gets threads", await ev(`crossOriginIsolated`));
await r.openPdf(path.join(root, "sample/test-paper.pdf"));
check("…opens a PDF and has its sentences", /29 sentences/.test(await r.status()), await r.status());
const engine = await ev(`Promise.all(["vendor/onnxruntime/ort.wasm.min.js", "vendor/piper/piper_phonemize.wasm",
  "vendor/lamejs/lamejs.iife.js", "voices/en_US-norman-medium.mp3"].map((f) => fetch(f).then((r) => r.ok, () => false)))`);
check("…and has the voice's engine, the MP3 encoder and the samples", engine.every(Boolean), engine);

// 4. An update, with a document open.
fs.appendFileSync(path.join(site, "js/find.js"), "\nself.mimickUpdated = true;\n");
fs.writeFileSync(path.join(site, "sw.js"), sw.replace(/const VERSION = "[^"]*";/, 'const VERSION = "next-version";'));
await serve();
await ev(`navigator.serviceWorker.getRegistration().then((r) => r.update())`);
await wait(`MimickOffline.state.updateReady`, 180000);
check("a new version is found and waits", true);
check("…while this tab keeps every file of the version it opened with",
      !(await ev(`fetch("js/find.js").then((r) => r.text())`)).includes("mimickUpdated"));
await r.click(await r.centre("#help-menu")); await sleep(300);
check("Help offers the update", (await r.menuLabels())?.includes("Update Mimick (reloads the page)"), await r.menuLabels());
await r.menu("Update Mimick (reloads the page)");
await sleep(3000);
await wait(`/Ready/.test(document.getElementById("status")?.textContent || "")`);
await wait(`MimickOffline.state.version === "next-version"`, 30000).catch(() => {});
check("taking it reloads into the new version, whole",
      (await ev(`MimickOffline.state.version`)) === "next-version"
      && (await ev(`fetch("js/find.js").then((r) => r.text())`)).includes("mimickUpdated"),
      await ev(`MimickOffline.state`));
const names = await ev(`caches.keys()`);
check("…and the old version's copy is gone", names.filter((n) => n.startsWith("mimick-app-")).length === 1, names);

await stop();
fs.rmSync(site, { recursive: true, force: true });
r.finish();
