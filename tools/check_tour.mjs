/* The guided tour (js/tour.js), in a real Chrome.
 *
 *     python3 serve.py &          # the page, on 8731
 *     node tools/check_tour.mjs
 *
 * Starts the tour from the front page, which opens the sample poem, and walks
 * it with real keys and clicks: the card and the spotlight, a step that says
 * so once the reader does the thing (Space, a click on a sentence, the speed,
 * Ctrl+H) and then waits for Next, Click to read turned on and off again, Skip
 * and Back, and the two ways out. It shares the
 * "check-convert" profile for its downloaded voice, as check_media does, so the
 * reading steps are done for real rather than skipped.
 */
import { CTRL, startReader } from "./cdp.mjs";

const PORT = 8731;
const r = await startReader("check-convert");
const { ev, wait, sleep, check } = r;
await r.load();
await r.reset();

const card = () => ev(`JSON.stringify({
  on: !document.getElementById("tour").hidden,
  count: document.getElementById("tour-count").textContent,
  title: document.getElementById("tour-title").textContent,
  go: document.getElementById("tour-go").textContent,
  goOff: document.getElementById("tour-go").disabled,
  goPrimary: document.getElementById("tour-go").classList.contains("primary"),
  back: !document.getElementById("tour-back").hidden,
  keys: [...document.querySelectorAll("#tour-keys .tour-cap")].map((k) => k.textContent),
  note: document.getElementById("tour-note").textContent,
  praise: document.getElementById("tour-praise").textContent,
  ring: document.getElementById("tour-ring").hidden ? null
        : (({ left, top, width, height }) => ({ left, top, width, height }))(document.getElementById("tour-ring").getBoundingClientRect()),
  shades: [...document.querySelectorAll("#tour .tour-shade")].filter((s) => !s.hidden).length,
  ghost: !document.getElementById("tour-ghost").hidden,
  status: document.getElementById("status").textContent })`).then(JSON.parse);
const step = () => card().then((c) => c.title);
const onStep = (title, ms = 25000) => wait(`document.getElementById("tour-title").textContent === ${JSON.stringify(title)}`, ms);
/* The ring sits over an element of the page, give or take the padding it leaves. */
const over = (ring, box) => ring && Math.abs(ring.left - box.left) < 20 && Math.abs(ring.top - box.top) < 20
  && Math.abs(ring.width - box.width) < 40 && Math.abs(ring.height - box.height) < 40;
/* A step done: it says so, turns Skip into Next, and waits there for it. */
const praised = () => wait(`document.getElementById("tour-praise").textContent !== ""`, 90000);
async function doneThenNext(what) {
  await praised();
  await sleep(1300);
  const c = await card();
  check(what + ", and the step waits for Next", c.go === "Next" && c.goPrimary && c.praise !== "", [c.go, c.praise]);
  await r.click(await r.centre("#tour-go"));
  await sleep(500);
  await r.click(await r.at(300, 700));        // the page again, so keys go to it
}
const boxOf = (selector) => ev(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return JSON.stringify({ left: b.left, top: b.top, width: b.width, height: b.height }); })()`).then(JSON.parse);

// 1. The way in, on the front page -- taken as a new reader would, before the
// page has finished getting ready, which is when the first card has to wait.
check("the front page offers the tour", await ev(`!document.getElementById("tour-start").hidden
  && document.getElementById("tour-start").textContent.trim() === "Show me around"`));
await r.t.send("Page.navigate", { url: `http://localhost:${PORT}/reader.html` });
await wait(`typeof MimickTour !== "undefined" && !!document.getElementById("tour-start")`, 30000);
await r.click(await r.centre("#tour-start"));
await sleep(200);
let c = await card();
check("clicking it opens the card at the first step", c.on && c.count === "Step 1 of 16" && !c.back, [c.count, c.title]);
check("…which says the sample is still opening, and holds Next back", /Opening the sample/.test(c.note) && c.goOff, [c.note, c.goOff]);
await wait(`!document.getElementById("play").disabled`, 90000);
await sleep(600);
c = await card();
check("the sample opens by itself, and Next lights up", !c.goOff && /Raven/.test(await ev(`document.getElementById("title").textContent`)),
      await ev(`document.getElementById("title").textContent`));

// 2. The spotlight lands on what the step is about.
await r.click(await r.centre("#tour-go"));
await sleep(500);
c = await card();
check("Next moves on to reading aloud", c.title === "Read it aloud" && c.count === "Step 2 of 16", [c.title, c.count]);
check("…the Space key is drawn on the card", c.keys.join("+") === "Space", c.keys);
check("…and the spotlight is on Read aloud, with the page shaded round it",
      over(c.ring, await boxOf("#play")) && c.shades === 4, [c.ring, c.shades]);
check("a step to do says Skip, not Next, and does not shout it", c.go === "Skip" && !c.goPrimary, [c.go, c.goPrimary]);

// 3. Doing the thing says so, and then waits for Next.
check("Click to read starts off", (await ev(`localStorage.getItem("mimick-click_read")`)) === null
      && (await ev(`document.getElementById("sw-click_read").getAttribute("aria-pressed")`)) === "false");
await r.click(await r.at(300, 700));          // the page, so the keys go to it
await r.key(" ");
await praised();
check("pressing Space is what ends the step", /reading/i.test((await card()).praise), (await card()).praise);
await sleep(1500);
check("…and the step stays until Next, rather than moving on by itself", (await step()) === "Read it aloud", await step());
await r.click(await r.centre("#tour-go"));
await onStep("It keeps your place");
await wait(`!document.getElementById("tour-ring").hidden`, 15000).catch(() => {});
c = await card();
check("…on to the next step, which lights the sentence being read", c.count === "Step 3 of 16" && c.ring !== null, [c.count, c.ring]);
check("a step with nothing to do says Next, as the way on", c.go === "Next" && c.goPrimary, [c.go, c.goPrimary]);

// 4. Skip and Back.
await r.click(await r.centre("#tour-go"));
await onStep("Faster, slower, another voice");
await sleep(500);
c = await card();
check("the speed step lights the speed box", over(c.ring, await boxOf("#speed")), c.ring);
await r.click(await r.centre("#tour-go"));           // Skip
await sleep(500);
check("Skip in the corner moves on without doing it", (await step()) === "Pause", await step());
await r.click(await r.centre("#tour-back"));
await sleep(500);
check("Back goes to the step before", (await step()) === "Faster, slower, another voice", await step());

// 5. The rest of the steps, each done for real rather than skipped.
await r.click(await r.centre("#tour-go"));                      // Skip the speed step
await onStep("Pause");
await r.click(await r.at(300, 700));
await r.key(" ");
await doneThenNext("Space a second time ends the Pause step");
await onStep("The cursor", 30000);
await r.key("ArrowRight");
await doneThenNext("an arrow key moves the cursor, and ends that step");
await onStep("Read just this bit", 30000);
await r.drag(await r.at(60, 225), await r.at(300, 235));
await doneThenNext("dragging across the text ends the selecting step");
await onStep("Highlight it", 30000);
await r.drag(await r.at(60, 225), await r.at(300, 235));
await sleep(500);
await r.key("h", CTRL);
await doneThenNext("Ctrl+H ends the highlight step");
check("…and the highlight was really made", (await ev(`document.querySelectorAll(".hl.annot").length`)) > 0);
await onStep("Write a note on it", 30000);
await r.click(await r.centre("#tour-go"));                      // Skip writing a note
await onStep("Everything you marked");
await r.key("b", CTRL);
await doneThenNext("Ctrl+B ends the notes-column step");
await r.key("b", CTRL);                                         // the column back as it was
await sleep(300);

// 6. Click to read: off to start with, turned on, used, and turned off again.
await onStep("Click to read: turn it on", 30000);
await sleep(600);
c = await card();
check("the step opens the switches and lights Click to read", over(c.ring, await boxOf("#sw-click_read")), c.ring);
await r.click(await r.centre("#sw-click_read"));
await doneThenNext("clicking the switch ends the step");
await onStep("Start anywhere", 30000);
await sleep(900);
c = await card();
const page = await boxOf(`.page[data-page="0"]`);
check("Start anywhere lights a sentence on the page itself", c.ring !== null
      && c.ring.left > page.left - 20 && c.ring.width < page.width, [c.ring, page]);
check("…and the ghost pointer is shown, since it is a click", c.ghost);
// On the word "Once", the first line -- not the line highlighted a few steps
// back, where a click picks the highlight out instead of reading.
await r.click(await r.at(80, 60));
await doneThenNext("clicking a sentence -- not the reading moving on by itself -- ends the step");
await onStep("And off again", 30000);
await r.click(await r.centre("#sw-click_read"));
await doneThenNext("the same switch turns it off, and ends the step");
check("…and off is remembered", (await ev(`localStorage.getItem("mimick-click_read")`)) === "0");
await r.key(" ");                                               // stop the reading the click started
await sleep(400);
await onStep("Getting around", 30000);
await r.key("ArrowDown", CTRL);
await doneThenNext("Ctrl+↓ turns the page, and ends that step");
check("…to page 2", (await ev(`document.getElementById("page").value`)) === "2",
      await ev(`document.getElementById("page").value`));
await onStep("Take it with you", 30000);

// 7. Esc leaves, but only when nothing on the page wants it.
await r.key("ArrowUp", CTRL);           // back to the first page, so the drag lands on words
await sleep(700);
await r.drag(await r.at(60, 60), await r.at(300, 75));
await sleep(500);
await r.key("Escape"); await sleep(400);
check("Esc with text selected clears the selection, and the tour stays", (await card()).on);
await r.key("Escape"); await sleep(400);
c = await card();
check("Esc again leaves the tour", !c.on && /Tour closed/.test(c.status), c.status);

// 8. Help starts it again, and Exit tutorial closes it.
await r.click(await r.centre("#help-menu")); await sleep(300);
check("Help lists the tour", (await r.menuLabels())?.[0] === "Take the tour", await r.menuLabels());
await r.menu("Take the tour");
await sleep(600);
c = await card();
check("it starts again on the document already open, without opening the sample twice",
      c.on && c.count === "Step 1 of 16" && !/Opening/.test(c.note), [c.count, c.note]);
await r.click(await r.centre("#tour-exit"));
await sleep(400);
c = await card();
check("Exit tutorial closes it, and takes the shades away", !c.on && c.shades === 0, c.shades);

// 9. The last step offers a file of the reader's own.
await ev(`document.getElementById("help-menu").click()`); await sleep(200);
await r.menu("Take the tour");
await sleep(500);
for (let i = 0; i < 15; i++) { await r.click(await r.centre("#tour-go")); await sleep(550); }   // the card slides; let it land
c = await card();
check("skipping to the end reaches the last step", c.count === "Step 16 of 16" && c.go === "Finish", [c.count, c.go]);
check("…which offers to open a file of their own", await ev(`!document.getElementById("tour-open").hidden`));
await r.click(await r.centre("#tour-go"));
await sleep(400);
c = await card();
check("Finish closes it and says how to come back", !c.on && /Tour finished/.test(c.status), c.status);
check("…and it is remembered as taken", (await ev(`localStorage.getItem("mimick-tour")`)) === "done");

r.finish();
