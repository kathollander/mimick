/* Kat's list of 16 October: the notes panel and leaving the page.
 *
 *   1. Leaving the page with highlights not yet saved to a file asks first;
 *      after Save a copy it does not.
 *
 * Needs serve.py on 8731. `node tools/check_panel.mjs`
 */
import path from "node:path";
import { CTRL, root, startReader } from "./cdp.mjs";

const SAMPLE = path.join(root, "sample/test-paper.pdf");
const r = await startReader("check-panel");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();
await r.openPdf(SAMPLE);
await wait(`!document.getElementById("markup-highlight").disabled`);

// --- 1. Leaving with work not in a file ------------------------------------------

await r.t.send("Page.enable");
let dialogs = [];
r.t.on((m) => { if (m.method === "Page.javascriptDialogOpening") dialogs.push(m.params.type); });
/* Try to leave; say whether the browser asked, and stay if it did. */
async function tryLeaving() {
  dialogs = [];
  r.t.send("Page.navigate", { url: "about:blank" });
  for (let i = 0; i < 20 && !dialogs.length; i++) await sleep(150);
  if (!dialogs.length) return null;
  await r.t.send("Page.handleJavaScriptDialog", { accept: false });
  await sleep(400);
  return dialogs[0];
}

await r.drag(await r.at(243, 260), await r.at(330, 260));
await r.key("h", CTRL); await sleep(900);
check("a highlight not yet in a file: leaving the page asks first", await tryLeaving() === "beforeunload", dialogs);
check("…and staying keeps the page and the highlight", await ev(`document.querySelectorAll("#cards .note-card").length`) === 1);
// Headless Chrome has no save window to answer: take the download instead.
await ev(`delete window.showSaveFilePicker; delete Window.prototype.showSaveFilePicker`);
await r.key("s", CTRL);
await wait(`/Saved|Sent/.test(document.getElementById("status").textContent)`, 20000);
check("after Save a copy, leaving does not ask", await tryLeaving() === null, dialogs);

r.finish();
