/* Open Recent, in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_recent.mjs
 *
 * Headless Chrome has no open window to answer, so the file handles are made
 * the other way a page can have them: the poem and the test paper are written
 * into the site's private file system (navigator.storage), and their handles
 * given to MimickRecent as a real open would. Checks File ▾ lists them newest
 * first, that choosing one opens it (and moves it to the top), that the list
 * survives a reload, that a file since deleted says so and leaves the list, and
 * that Clear recent files empties it. Needs no voice.
 */
import fs from "node:fs";
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const r = await startReader("check-recent");
const { ev, sleep, check, wait } = r;
await r.load();
await r.reset();
await ev(`MimickRecent.clear()`);

// Into the private file system, and into the list, oldest first.
for (const name of ["sample.pdf", "test-paper.pdf"]) {
  const b64 = fs.readFileSync(path.join(root, "sample", name)).toString("base64");
  await ev(`(async () => {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(${JSON.stringify(name)}, { create: true });
    const w = await handle.createWritable();
    await w.write(Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0)));
    await w.close();
    await MimickRecent.add(handle);
    return true;
  })()`);
  await sleep(50);
}

const fileMenu = async () => {
  await r.click(await r.centre("#file-menu")); await sleep(300);
  return r.menuLabels();
};
let labels = await fileMenu();
check("File lists recent files, newest first, under Open…", JSON.stringify(labels?.slice(0, 5))
  === JSON.stringify(["Open…", "(off) Open recent", "test-paper.pdf", "sample.pdf", "Clear recent files"]), labels);

await r.menu("sample.pdf");
await wait(`!document.getElementById("play").disabled`, 60000).catch(() => {});
check("choosing one opens it", (await ev(`document.getElementById("title").textContent`)) === "sample",
      await ev(`document.getElementById("title").textContent`));
labels = await fileMenu();
check("…and moves it to the top", labels?.[2] === "sample.pdf" && labels?.[3] === "test-paper.pdf", labels);
await r.key("Escape");

await r.load();
labels = await fileMenu();
check("the list is kept over a reload", labels?.[2] === "sample.pdf" && labels?.[3] === "test-paper.pdf", labels);
await r.key("Escape");

await ev(`navigator.storage.getDirectory().then((dir) => dir.removeEntry("test-paper.pdf"))`);
await fileMenu();
await r.menu("test-paper.pdf"); await sleep(1000);
const said = await r.status();
check("a file since deleted says it cannot be found", /Could not open test-paper\.pdf: .*moved, renamed or deleted/.test(said), said);
labels = await fileMenu();
check("…and leaves the list", !labels?.includes("test-paper.pdf"), labels);

await r.menu("Clear recent files"); await sleep(300);
labels = await fileMenu();
check("Clear recent files empties it", !labels?.includes("Open recent") && !labels?.includes("sample.pdf"), labels);
await r.key("Escape");
await ev(`navigator.storage.getDirectory().then((dir) => dir.removeEntry("sample.pdf"))`);
r.finish();
