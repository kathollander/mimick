/* A pronunciation list: a word, and how the voice should say it. Names and
 * jargon are where voices stumble ("Foucault", "SQL", "Nietzsche").
 *
 * Kept in this browser (localStorage, "mimick-pronunciations"). The page hands
 * the list to the voice worker with each sentence, and the worker says the
 * sentence with each listed word -- whole words, any capitals -- swapped for its
 * sound-alike, then gives the swapped words' timings back under the words as
 * printed, so the right word on the page is still lit.
 *
 * A sound-alike of several words is joined with hyphens ("sequel" is one word;
 * "nee cha" becomes "nee-cha"), so it stays one word to the timing.
 *
 *   MimickPronounce.list()              [[word, sayAs]], from storage (page only)
 *   MimickPronounce.save(list)          (page only)
 *   MimickPronounce.apply(text, list)   { text, back: Map(spoken key -> printed word) }
 *   MimickPronounce.unswap(marks, back) marks with their words put back as printed
 */
(function (root) {
  "use strict";

  const KEY = "mimick-pronunciations";
  const letters = (word) => String(word).replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function clean(list) {
    const seen = new Set();
    const out = [];
    for (const pair of Array.isArray(list) ? list : []) {
      const word = String(pair?.[0] ?? "").trim(), say = String(pair?.[1] ?? "").trim().split(/\s+/).join("-");
      if (!word || !say || /\s/.test(word) || seen.has(word.toLowerCase())) continue;
      seen.add(word.toLowerCase());
      out.push([word, say]);
    }
    return out;
  }

  function list() {
    try { return clean(JSON.parse(root.localStorage?.getItem(KEY) || "[]")); } catch { return []; }
  }
  function save(pairs) {
    const tidy = clean(pairs);
    try { root.localStorage?.setItem(KEY, JSON.stringify(tidy)); } catch { /* not kept */ }
    return tidy;
  }

  function apply(text, pairs) {
    const back = new Map();
    if (!pairs?.length) return { text, back };
    // Longest first, so "New York" style entries -- one word each here -- never
    // lose to a shorter one inside them.
    const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.map(([w]) => escape(w)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
    const by = new Map(sorted.map(([w, s]) => [w.toLowerCase(), s]));
    const swapped = text.replace(pattern, (found) => {
      const say = by.get(found.toLowerCase());
      if (!say) return found;
      back.set(letters(say), found);
      return say;
    });
    return { text: swapped, back };
  }

  function unswap(marks, back) {
    if (!back?.size || !marks) return marks;
    return marks.map((m) => {
      const key = letters(m.word);
      if (back.has(key)) return { ...m, word: back.get(key) };
      // "foo-koh's" is "Foucault's": the swapped word with an ending of its own.
      for (const [said, printed] of back) {
        if (key.startsWith(said)) return { ...m, word: printed + key.slice(said.length) };
      }
      return m;
    });
  }

  root.MimickPronounce = { KEY, list, save, clean, apply, unswap };
})(typeof self !== "undefined" ? self : globalThis);
