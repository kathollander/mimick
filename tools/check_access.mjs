/* The page's own accessibility, in a real Chrome: the theme, reduced motion,
 * and names on every control.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_access.mjs
 *
 * Checks the page follows the system's light or dark setting, that Display →
 * Theme overrides it and is kept over a reload (on <html> before the page
 * draws), that the text cursor stops blinking when the system asks for less
 * motion, and that every button, box and slider has a name a screen reader can
 * say -- words, not a glyph like ‹ or ⚙. Needs no voice.
 */
import path from "node:path";
import { root, startReader } from "./cdp.mjs";

const r = await startReader("check-access");
const { ev, sleep, check } = r;
const media = (features) => r.t.send("Emulation.setEmulatedMedia", { features });
await r.load();
await r.reset();

const panel = () => ev(`getComputedStyle(document.documentElement).getPropertyValue("--panel").trim()`);
const DARK = "#191d24", LIGHT = "#f7f8fa";

// 1. The system's setting.
await media([{ name: "prefers-color-scheme", value: "light" }]); await sleep(300);
check("a light system gets the light theme", (await panel()) === LIGHT, await panel());
await media([{ name: "prefers-color-scheme", value: "dark" }]); await sleep(300);
check("a dark system gets the dark theme", (await panel()) === DARK, await panel());

// 2. Display → Theme.
await r.openPdf(path.join(root, "sample/sample.pdf"));
await r.click(await r.centre("#display-menu")); await sleep(300);
const labels = await r.menuLabels();
check("Display offers the theme", ["Match the system", "Dark", "Light"].every((l) => labels?.includes(l)), labels);
await r.menu("Light");
check("Light overrides a dark system", (await panel()) === LIGHT && (await ev(`document.documentElement.dataset.theme`)) === "light", await panel());
check("…and the browser's own title bar colour follows", (await ev(`document.querySelector('meta[name="theme-color"]').content`)) === LIGHT);
await r.load();
check("…kept over a reload, set before the page draws", (await ev(`document.documentElement.dataset.theme`)) === "light" && (await panel()) === LIGHT);
await r.click(await r.centre("#display-menu")); await sleep(300);
await r.menu("Match the system");
check("Match the system goes back to it", (await panel()) === DARK && (await ev(`document.documentElement.dataset.theme`)) === undefined, await panel());

// 3. Less motion: the cursor holds still.
await r.openPdf(path.join(root, "sample/sample.pdf"));
await ev(`localStorage.setItem("mimick-click_read", "0")`);
await r.click(await r.at(80, 60)); await sleep(400);
const blink = () => ev(`(() => { const c = document.querySelector(".caret"); return c ? getComputedStyle(c).animationName : null; })()`);
check("the text cursor blinks normally", (await blink()) === "blink", await blink());
await media([{ name: "prefers-reduced-motion", value: "reduce" }]); await sleep(300);
check("…and holds still when the system asks for less motion", (await blink()) === "none", await blink());

// 4. Every control has a name.
const unnamed = await ev(`[...document.querySelectorAll("button, input, select")].filter((el) => {
  if (el.type === "file" || el.closest("#menu") || el.closest(".toc-row")) return false;
  const label = el.getAttribute("aria-label") || (el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent)
    || el.closest("label")?.textContent || el.textContent || el.placeholder || "";
  return !/[A-Za-z]{2}/.test(label);
}).map((el) => el.id || el.outerHTML.slice(0, 60))`);
check("every button, box and slider has a name in words", unnamed.length === 0, unnamed);
r.finish();
