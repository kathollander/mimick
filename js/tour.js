/* The guided tour: a spotlight over the page, a ghost pointer, and a card that
 * says what to press -- on the sample poem that comes with Mimick, so a new
 * reader can try every key on something before opening a book of their own.
 *
 * Each step says what to light up, what to say, and how to tell the reader has
 * done it: `done(now, was)`, over a snapshot of the reader (`probe`) taken
 * eight times a second. A step with no `done` waits for Next; one with it
 * moves on by itself the moment the reader does the thing, which is the point
 * -- pressing the key *is* the button.
 *
 * Nothing here traps the page. The shades around the spotlight let clicks
 * through, so the reader can wander off, scroll, or open a menu mid-step, and
 * the spotlight follows the page as it scrolls. Every step can be skipped
 * (bottom right), and Exit tutorial -- or Esc, where nothing else wants it --
 * leaves at once.
 *
 *   const tour = MimickTour.create(ctx)    ctx: see reader.js, "the tour"
 *   tour.start()      the sample, or the document already open
 *   tour.stop()
 *   tour.running
 */
(function (root) {
  "use strict";

  const TICK = 120;          // how often the reader is looked at, ms
  const PRAISE_MS = 900;     // how long "that's it" stays before the next step
  const PAD = 8;             // how far the spotlight sits outside what it lights
  const GAP = 14;            // between the spotlight and the card

  function create(ctx) {
    const $ = (id) => document.getElementById(id);
    const layer = $("tour"), card = $("tour-card"), ring = $("tour-ring"), ghost = $("tour-ghost");
    const shades = [...layer.querySelectorAll(".tour-shade")];

    let at = -1;               // which step is showing
    let was = null;            // the reader as that step began
    let spot = null;           // { el } or { page, rect } -- what is lit
    let lastSpot = null;       // where it was last seen, for the moments it is not there
    let gesture = null;        // the ghost pointer's job on this step
    let timer = null, ghostTimer = null, praiseTimer = null;
    let waiting = false;       // the step is done; its praise is showing
    let opening = false;       // the sample is still being opened

    const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const readingNow = (state) => state === "playing" || state === "buffering";

    // --- what the reader looks like just now ---------------------------------
    // Everything a step's `done` may ask about, cheap enough to take eight
    // times a second. Compared against the same thing taken as the step began.

    const probe = () => ({
      ready: ctx.ready(),
      state: ctx.readingState(),
      sentence: ctx.sentence(),
      speed: ctx.speed(),
      voice: ctx.voiceKey(),
      caret: ctx.caret(),
      selection: ctx.selection() ? ctx.selection().join(",") : null,
      notes: ctx.notesCount(),
      panel: ctx.notesPanelOpen(),
      find: ctx.findOpen(),
      page: ctx.page(),
      dialog: ctx.dialogOpen(),
      menu: ctx.menuOpen(),
    });

    // --- the steps -----------------------------------------------------------

    const STEPS = [
      {
        title: "A quick tour",
        text: "A couple of minutes on a sample poem, so you can try everything before you open anything of your own. "
            + "Skip a step from the bottom right, or leave at any time.",
        wait: () => (opening ? "Opening the sample…" : null),
      },
      {
        title: "Read it aloud",
        text: "Press Space, or click Read aloud. The first time only, the voice downloads — about 61 MB — and after that Mimick reads with no internet at all.",
        keys: [["Space"]],
        spotlight: "#play",
        note: (now) => (now.state === "loading" ? ctx.statusText() : null),
        done: (now) => readingNow(now.state),
        praise: "It's reading.",
      },
      {
        title: "It keeps your place",
        text: "The sentence being read is tinted, the word being said is lit, and the page scrolls itself to keep up. Look away and you can find your way back.",
        spotlight: ".page .hl.sentence",
      },
      {
        title: "Start anywhere",
        text: "Click any sentence and it reads from there. If you would rather a click never started the voice, turn it off under Reading ▾ → Click to read.",
        spotlight: "sentence",
        gesture: "tap",
        done: (now, then) => readingNow(now.state) && now.sentence !== null && now.sentence !== then.sentence,
        praise: "That's it — it reads from where you clicked.",
      },
      {
        title: "Faster or slower",
        text: "Any speed from 0.75× to 4×, changed while it reads. Most people end up somewhere around 1.5×.",
        spotlight: "#speed",
        gesture: "tap",
        done: (now, then) => now.speed !== then.speed,
        praise: "Better?",
      },
      {
        title: "Pause",
        text: "Space again pauses, and again starts it up. The play and pause keys on a keyboard or headset work too — even while you are in another tab.",
        keys: [["Space"]],
        spotlight: "#play",
        done: (now, then) => now.state !== then.state && (now.state === "paused" || now.state === "stopped"),
        praise: "Paused.",
      },
      {
        title: "The cursor",
        text: "Paused, a thin blue cursor sits where the voice stopped, and the arrow keys move it: a word at a time, or a whole sentence with Ctrl. "
            + "Hold Shift as you go to select what you pass.",
        keys: [["←"], ["→"], ["Ctrl", "→"]],
        spotlight: ".page .caret",
        done: (now, then) => now.caret >= 0 && now.caret !== then.caret,
        praise: "There it goes.",
      },
      {
        title: "Read just this bit",
        text: "Drag across a few lines — or double-click one sentence — then press Enter. It reads only what you picked, and stops.",
        spotlight: "sentence",
        gesture: "drag",
        done: (now) => now.selection !== null,
        praise: "Selected. Enter reads it.",
      },
      {
        title: "Highlight it",
        text: "With something selected, Ctrl+H highlights it. The colour comes from the Highlight button, where there are four to choose from.",
        keys: [["Ctrl", "H"]],
        spotlight: "#markup-highlight",
        done: (now, then) => now.notes > then.notes,
        praise: "Highlighted.",
      },
      {
        title: "Write a note on it",
        text: "Select something again and press Ctrl+M: it highlights and opens a note. Type, then Ctrl+Enter saves it and hands the keyboard back to the page.",
        keys: [["Ctrl", "M"], ["Ctrl", "Enter"]],
        spotlight: "#markup-note",
        done: (now, then) => now.notes > then.notes && !now.dialog,
        praise: "Saved — and it is in the PDF you save later.",
      },
      {
        title: "Everything you marked",
        text: "Ctrl+B shows and hides the column beside the page. Ctrl+J and Ctrl+K jump from one note to the next; Ctrl+Z takes one back and Ctrl+Y puts it again.",
        keys: [["Ctrl", "B"]],
        spotlight: "#notes",
        done: (now, then) => now.panel !== then.panel,
        praise: "There they are.",
      },
      {
        title: "Getting around",
        text: "Ctrl+↑ and Ctrl+↓ turn the page, and so do Page Up and Page Down. Ctrl+F finds any word in the whole document; F9 opens its contents down the side.",
        keys: [["Ctrl", "↓"], ["Ctrl", "↑"]],
        done: (now, then) => now.page !== then.page,
        praise: "Page turned.",
      },
      {
        title: "Take it with you",
        text: "File ▾ → Convert to MP3 turns the document, some pages of it or one passage into an audio file for a phone. "
            + "Ctrl+S saves a copy of the PDF with your highlights and notes inside it, for any reader to see.",
        spotlight: "#file-menu",
        gesture: "tap",
      },
      {
        title: "That's the tour",
        text: "Every key is listed under Help ▾ → Keyboard shortcuts, or press ? at any time. Open anything of your own next — it stays on this computer, as this did.",
        last: true,
      },
    ];

    // --- the card ------------------------------------------------------------

    function keysHtml(keys) {
      return keys.map((combo) => combo.map((k) => `<kbd class="tour-cap">${k}</kbd>`).join('<span class="tour-plus">+</span>'))
        .join('<span class="tour-or">or</span>');
    }

    function draw() {
      const step = STEPS[at];
      $("tour-count").textContent = `Step ${at + 1} of ${STEPS.length}`;
      $("tour-bar-fill").style.width = `${((at + 1) / STEPS.length) * 100}%`;
      $("tour-title").textContent = step.title;
      $("tour-text").textContent = step.text;
      $("tour-keys").innerHTML = step.keys ? keysHtml(step.keys) : "";
      $("tour-keys").hidden = !step.keys;
      $("tour-back").hidden = at === 0;
      $("tour-open").hidden = !step.last;
      const go = $("tour-go");
      go.textContent = step.last ? "Finish" : step.done ? "Skip" : "Next";
      // Skip is never the loud one: on a step to do, doing it is the way on.
      go.classList.toggle("primary", !step.done || step.last === true);
      go.disabled = false;
      card.classList.remove("done");
      $("tour-praise").textContent = "";
      showNote();
    }

    /* The live line under the text: what the reader is waiting on (the sample
     * opening, the voice downloading), so a step that cannot be done yet says
     * why rather than sitting there. */
    function showNote(now) {
      const step = STEPS[at];
      const line = (step.wait?.() ?? null) || (now && step.note ? step.note(now) : null);
      $("tour-note").textContent = line ?? "";
      $("tour-note").hidden = !line;
      if (step.wait) $("tour-go").disabled = !!step.wait();
    }

    // --- the spotlight, the ring and the ghost pointer ------------------------

    /* Where the spotlight is on the screen just now, or null. A selector is
     * looked up fresh every tick: the element it names may be redrawn (the
     * page's own highlights are) or not be there at all. */
    function spotRect() {
      const found = measureSpot();
      // What a step lights can come and go -- the reading highlight is torn
      // down and drawn again for every sentence -- so the spotlight stays
      // where it was rather than blinking out between them.
      if (found) lastSpot = found;
      return found ?? lastSpot;
    }

    function measureSpot() {
      if (!spot) return null;
      if (spot.el) {
        const el = document.querySelector(spot.el);
        if (!el || el.hidden || !el.getClientRects().length) return null;
        return el.getBoundingClientRect();
      }
      const box = ctx.pageRectToClient(spot.page, spot.rect);
      if (!box) return null;
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
               width: box.right - box.left, height: box.bottom - box.top };
    }

    /* The sentence a "sentence" step lights: the first one on the page being
     * looked at, in page points, so it stays put as the page scrolls or zooms. */
    async function findSentence() {
      try {
        const found = await ctx.sentenceBox(ctx.page());
        return found ? { page: found[0], rect: found[1] } : null;
      } catch {
        return null;
      }
    }

    function place() {
      const box = spotRect();
      const w = innerWidth, h = innerHeight;
      if (!box || box.width <= 0 || box.height <= 0) {
        for (const shade of shades) shade.hidden = true;
        ring.hidden = true;
        ghost.hidden = true;
        placeCard(null);
        return;
      }
      const hole = { left: Math.max(0, box.left - PAD), top: Math.max(0, box.top - PAD),
                     right: Math.min(w, box.right + PAD), bottom: Math.min(h, box.bottom + PAD) };
      const set = (el, left, top, width, height) => {
        el.hidden = false;
        el.style.left = `${left}px`; el.style.top = `${top}px`;
        el.style.width = `${Math.max(0, width)}px`; el.style.height = `${Math.max(0, height)}px`;
      };
      // Four shades around the hole, rather than one box with a hole cut in it:
      // every browser draws it the same, and the hole stays crisp as it moves.
      set(shades[0], 0, 0, w, hole.top);
      set(shades[1], 0, hole.bottom, w, h - hole.bottom);
      set(shades[2], 0, hole.top, hole.left, hole.bottom - hole.top);
      set(shades[3], hole.right, hole.top, w - hole.right, hole.bottom - hole.top);
      set(ring, hole.left, hole.top, hole.right - hole.left, hole.bottom - hole.top);
      placeGhost(box);
      placeCard(hole);
    }

    /* The ghost pointer: it taps in the middle of what is lit, or runs across
     * it for a drag. Only where a pointer is what the step is about -- a step
     * about a key shows the key instead. */
    function placeGhost(box) {
      if (!gesture || reduced()) { ghost.hidden = true; return; }
      ghost.hidden = false;
      const y = box.top + box.height / 2;
      if (gesture === "tap") {
        ghost.style.transform = `translate(${box.left + Math.min(box.width / 2, 120)}px, ${y}px)`;
        return;
      }
      const from = box.left + box.width * 0.06, to = box.left + box.width * 0.72;
      ghost.style.transform = `translate(${ghost.dataset.end === "1" ? to : from}px, ${y}px)`;
    }

    /* The card: under what is lit if it fits, over it if not, and against the
     * bottom of the window when nothing is lit. */
    function placeCard(hole) {
      const w = innerWidth, h = innerHeight;
      const width = card.offsetWidth, height = card.offsetHeight;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      let left, top;
      if (!hole) {
        left = (w - width) / 2;
        top = h - height - 28;
      } else if (hole.bottom + GAP + height < h - 8) {
        left = clamp(hole.left + (hole.right - hole.left - width) / 2, 12, w - width - 12);
        top = hole.bottom + GAP;
      } else if (hole.top - GAP - height > 8) {
        left = clamp(hole.left + (hole.right - hole.left - width) / 2, 12, w - width - 12);
        top = hole.top - GAP - height;
      } else if (hole.right + GAP + width < w - 8) {
        left = hole.right + GAP;
        top = clamp(hole.top, 12, h - height - 12);
      } else {
        left = clamp(hole.left - GAP - width, 12, w - width - 12);
        top = clamp(hole.top, 12, h - height - 12);
      }
      card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    // --- running -------------------------------------------------------------

    async function show(index) {
      clearTimeout(praiseTimer);
      clearInterval(ghostTimer);
      waiting = false;
      at = index;
      const step = STEPS[at];
      spot = lastSpot = null;
      gesture = step.gesture ?? null;
      ghost.dataset.end = "0";
      ghost.classList.toggle("tapping", gesture === "tap");
      draw();
      was = probe();
      place();
      if (step.spotlight === "sentence") {
        const found = await findSentence();
        if (at !== index) return;                 // moved on while asking
        spot = found;
      } else if (step.spotlight) {
        spot = { el: step.spotlight };
      }
      // A drag is shown by running the pointer from one end to the other and back.
      if (gesture === "drag" && !reduced()) {
        ghostTimer = setInterval(() => {
          const going = ghost.dataset.end !== "1";
          ghost.dataset.end = going ? "1" : "0";
          ghost.classList.toggle("pressing", going);
          place();
        }, 1500);
      }
      place();
      // Almost every step is a key, so the page keeps the keyboard, never the card.
      ctx.focusPage();
    }

    function next() {
      if (at + 1 >= STEPS.length) { stop({ finished: true }); return; }
      show(at + 1);
    }

    function back() {
      if (at > 0) show(at - 1);
    }

    /* Eight times a second: has the reader done it, has the page moved, and is
     * there anything new to say. */
    function tick() {
      if (at < 0) return;
      const step = STEPS[at], now = probe();
      if (opening && now.ready) opening = false;
      showNote(now);
      place();
      if (waiting || !step.done || !step.done(now, was)) return;
      waiting = true;
      card.classList.add("done");
      $("tour-praise").textContent = step.praise ?? "That's it.";
      praiseTimer = setTimeout(next, PRAISE_MS);
    }

    async function start() {
      if (at >= 0) return;
      layer.hidden = false;
      document.body.classList.add("touring");
      // Their own document if there is one -- every step works on any document
      // -- and otherwise the sample, which is what the front page's button means.
      opening = !ctx.ready();
      if (!ctx.hasDocument()) {
        ctx.openSample().catch((err) => { opening = false; ctx.status("The sample could not be opened: " + err.message); });
      }
      await show(0);
      clearInterval(timer);
      timer = setInterval(tick, TICK);
    }

    function stop({ finished = false } = {}) {
      if (at < 0) return;
      clearInterval(timer); clearInterval(ghostTimer); clearTimeout(praiseTimer);
      timer = ghostTimer = praiseTimer = null;
      at = -1;
      spot = null;
      layer.hidden = true;
      document.body.classList.remove("touring");
      ctx.remember("mimick-tour", "done");
      ctx.focusPage();
      ctx.status(finished ? "Tour finished — Help ▾ → Take the tour runs it again"
                          : "Tour closed — Help ▾ → Take the tour starts it again");
    }

    // --- its own buttons and keys --------------------------------------------

    $("tour-go").onclick = () => (STEPS[at]?.last ? stop({ finished: true }) : next());
    $("tour-back").onclick = back;
    $("tour-exit").onclick = () => stop();
    $("tour-open").onclick = () => { stop({ finished: true }); ctx.chooseFile(); };
    addEventListener("resize", () => { if (at >= 0) place(); });
    // Esc leaves the tour, but only when nothing on the page wants it first --
    // a dialog, the find box, a menu, or a selection to clear.
    addEventListener("keydown", (e) => {
      if (at < 0 || e.key !== "Escape") return;
      if (ctx.dialogOpen() || ctx.menuOpen() || ctx.findOpen() || ctx.selection()) return;
      e.preventDefault();
      stop();
    });

    return {
      start, stop,
      get running() { return at >= 0; },
      /* Whether the reader has ever been through it, for the front page. */
      get taken() { return ctx.recall("mimick-tour") === "done"; },
    };
  }

  root.MimickTour = { create };
})(typeof self !== "undefined" ? self : globalThis);
