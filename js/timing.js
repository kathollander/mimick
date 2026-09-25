/* When each word is spoken, from the voice model itself.
 *
 * The desktop app guesses: it spreads a sentence's duration over its words by
 * their length in letters (engines/base.py, estimate_marks). A Piper model
 * already knows better -- it decides how many audio frames every phoneme
 * lasts, and only throws that away because nobody marked it as an output.
 * Piper 1.8 ships a patch that does (piper/patch_voice_with_alignment.py);
 * `patchForAlignment` is the same patch, made to the model's bytes in memory,
 * after its hash has been checked, so the file on disk is never altered.
 *
 * From there it is bookkeeping: phoneme ids to sample counts, phonemes to the
 * spoken groups espeak separates with spaces, and groups to the words of the
 * text -- which is the one part that takes judgement, because espeak runs
 * "of the" together and spreads "1,204" over four groups. See `alignWords`.
 *
 * Shared by the browser worker and tools/check_timing.mjs.
 */
(function (root) {
  "use strict";

  // Every Piper voice to date; the config may say otherwise.
  const DEFAULT_HOP_LENGTH = 256;

  // --- the model patch ------------------------------------------------------

  // Just enough protobuf to find one field and append to another. ONNX model
  // files are protobuf: ModelProto.graph is field 7; in the graph, nodes are
  // field 1 and outputs field 12; in a node, outputs are field 2 and the
  // operator field 4; a ValueInfoProto's name is field 1.
  function readVarint(bytes, at) {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return [value, at];
  }

  function varint(value) {
    const out = [];
    do {
      let byte = value % 128;
      value = Math.floor(value / 128);
      if (value > 0) byte |= 0x80;
      out.push(byte);
    } while (value > 0);
    return out;
  }

  // Calls visit(field, start, end) for each length-delimited field in
  // bytes[from, to), skipping everything else.
  function eachField(bytes, from, to, visit) {
    let at = from;
    while (at < to) {
      let tag;
      [tag, at] = readVarint(bytes, at);
      const field = Math.floor(tag / 8), wire = tag % 8;
      if (wire === 0) [, at] = readVarint(bytes, at);
      else if (wire === 1) at += 8;
      else if (wire === 5) at += 4;
      else if (wire === 2) {
        let length;
        [length, at] = readVarint(bytes, at);
        if (visit(field, at, at + length, tag) === false) return;
        at += length;
      } else throw new Error(`unexpected protobuf wire type ${wire}`);
    }
  }

  const utf8 = (bytes, start, end) => new TextDecoder().decode(bytes.subarray(start, end));

  /* The model with its phoneme durations exposed as a second output, and the
   * name of that output. Returns the model unchanged, with `name` null, if it
   * has no single Ceil node to expose -- timing then falls back to estimates. */
  function patchForAlignment(model) {
    let graphTagAt = -1, graphStart = -1, graphEnd = -1;
    {
      let at = 0;
      while (at < model.length) {
        const tagAt = at;
        let tag;
        [tag, at] = readVarint(model, at);
        const field = Math.floor(tag / 8), wire = tag % 8;
        if (wire === 0) { [, at] = readVarint(model, at); continue; }
        if (wire === 1) { at += 8; continue; }
        if (wire === 5) { at += 4; continue; }
        if (wire !== 2) throw new Error(`unexpected protobuf wire type ${wire}`);
        let length;
        [length, at] = readVarint(model, at);
        if (field === 7) { graphTagAt = tagAt; graphStart = at; graphEnd = at + length; }
        at += length;
      }
    }
    if (graphStart < 0) return { model, name: null };

    const ceil = new Set(), outputs = new Set();
    eachField(model, graphStart, graphEnd, (field, start, end) => {
      if (field === 1) {
        let op = "", produced = [];
        eachField(model, start, end, (f, s, e) => {
          if (f === 2) produced.push(utf8(model, s, e));
          else if (f === 4) op = utf8(model, s, e);
        });
        if (op === "Ceil") produced.forEach((name) => ceil.add(name));
      } else if (field === 12) {
        eachField(model, start, end, (f, s, e) => { if (f === 1) outputs.add(utf8(model, s, e)); });
      }
    });
    if (ceil.size !== 1) return { model, name: null };
    const name = [...ceil][0];
    if (outputs.has(name)) return { model, name };        // already patched

    const nameBytes = new TextEncoder().encode(name);
    const valueInfo = [0x0a, ...varint(nameBytes.length), ...nameBytes];
    const addition = Uint8Array.from([0x62, ...varint(valueInfo.length), ...valueInfo]);
    const graphHeader = Uint8Array.from([0x3a, ...varint(graphEnd - graphStart + addition.length)]);

    const out = new Uint8Array(graphTagAt + graphHeader.length + (graphEnd - graphStart)
                               + addition.length + (model.length - graphEnd));
    let at = 0;
    const put = (part) => { out.set(part, at); at += part.length; };
    put(model.subarray(0, graphTagAt));
    put(graphHeader);
    put(model.subarray(graphStart, graphEnd));
    put(addition);
    put(model.subarray(graphEnd));
    return { model: out, name };
  }

  // --- phonemes to spoken groups --------------------------------------------

  /* The phonemizer gives phonemes and ids; the model gives frames per id. Lay
   * them side by side and cut at every space and sentence break.
   *
   * Ids run: ^ _ (p _)* $ per espeak sentence, where _ is padding. A phoneme
   * missing from the voice's map has no id, so ids are matched to phonemes by
   * looking each phoneme up rather than by counting.
   *
   * Returns groups of { start, end, phonemes } in samples, or null when the
   * ids do not line up with the phonemes -- never a guess dressed as a fact. */
  function spokenGroups({ ids, phonemes, samplesPerId, idMap }) {
    if (!samplesPerId || samplesPerId.length !== ids.length) return null;
    const PAD = idMap._?.[0] ?? 0, BOS = idMap["^"]?.[0] ?? 1, EOS = idMap["$"]?.[0] ?? 2,
          SPACE = idMap[" "]?.[0] ?? 3;

    const offsets = new Array(ids.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < ids.length; i++) offsets[i + 1] = offsets[i] + samplesPerId[i];

    const groups = [];
    let current = null, next = 0;
    const close = () => { if (current && current.phonemes) groups.push(current); current = null; };
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === PAD) {
        if (current) current.end = offsets[i + 1];
        continue;
      }
      if (id === BOS || id === EOS || id === SPACE) {
        if (id === SPACE) {
          // The space is itself a phoneme; step past it, and past anything
          // unmapped before it.
          while (next < phonemes.length && phonemes[next] !== " ") next++;
          if (next >= phonemes.length) return null;
          next++;
        }
        close();
        continue;
      }
      // A spoken phoneme: find it in the phoneme list, skipping any the map
      // had no id for.
      while (next < phonemes.length && !(idMap[phonemes[next]] || []).includes(id)) {
        if (phonemes[next] === " ") return null;
        next++;
      }
      if (next >= phonemes.length) return null;
      next++;
      current ??= { start: offsets[i], end: offsets[i + 1], phonemes: 0 };
      current.end = offsets[i + 1];
      // Stress marks and punctuation take ids but are not sounds to count.
      if (!/^[ˈˌ.,;:!?¡¿—…"«»“”()\-]$/.test(phonemes[next - 1])) current.phonemes++;
    }
    close();
    return groups;
  }

  // --- groups to the words of the text --------------------------------------

  const soundCount = (phonemes) => phonemes.filter((p) => !/^[ˈˌ.,;:!?¡¿—…"«»“”()\- ]$/.test(p)).length;
  const groupCount = (phonemes) => {
    const s = phonemes.join("").trim();
    return s && soundCount(phonemes) ? s.split(/ +/).length : 0;
  };

  /* Match the words of the text, in order, to the spoken groups.
   *
   * `alone` is each word phonemized on its own: how many sounds it has, and
   * how many groups it makes by itself ("1,204" makes four). In the sentence,
   * espeak may still join two words into one group ("of the"), so this is a
   * shortest-path over (words used, groups used), where a step is one word
   * taking one or more groups, several words sharing one group, or a word with
   * no sound (a dash) taking none. A step costs how far its sound counts
   * disagree, and extra when it goes against what the word did alone.
   *
   * Returns [{ word, index, start }] in samples, one per word of the text. */
  function alignWords(words, alone, groups) {
    const W = words.length, G = groups.length;
    const INF = Infinity;
    const cost = Array.from({ length: W + 1 }, () => new Float64Array(G + 1).fill(INF));
    const step = Array.from({ length: W + 1 }, () => new Array(G + 1).fill(null));
    cost[0][0] = 0;
    const sounds = alone.map((p) => Math.max(soundCount(p), 0));
    const expect = alone.map(groupCount);
    const mismatch = (a, b) => Math.abs(Math.log((a + 1) / (b + 1)));

    for (let w = 0; w <= W; w++) {
      for (let g = 0; g <= G; g++) {
        const here = cost[w][g];
        if (here === INF) continue;
        const relax = (w2, g2, c, kind) => {
          if (here + c < cost[w2][g2]) { cost[w2][g2] = here + c; step[w2][g2] = { w, g, kind }; }
        };
        if (w < W && expect[w] === 0) relax(w + 1, g, 0, "silent");
        if (w < W && expect[w] > 0) {
          let have = 0;
          for (let m = 1; m <= 6 && g + m <= G; m++) {
            have += groups[g + m - 1].phonemes;
            relax(w + 1, g + m, mismatch(sounds[w], have) + 0.7 * Math.abs(m - expect[w]), "word");
          }
        }
        if (g < G) {
          let want = 0, count = 0;
          for (let n = 1; n <= 4 && w + n <= W; n++) {
            if (expect[w + n - 1] === 0) break;
            want += sounds[w + n - 1];
            count += expect[w + n - 1];
            if (n >= 2) relax(w + n, g + 1, mismatch(want, groups[g].phonemes) + 0.5 * (count - 1), "shared");
          }
        }
      }
    }
    if (cost[W][G] === INF) return null;

    const marks = new Array(W);
    let w = W, g = G;
    while (w > 0 || g > 0) {
      const s = step[w][g];
      if (s.kind === "word") {
        marks[s.w] = { word: words[s.w], index: s.w, start: groups[s.g].start };
      } else if (s.kind === "shared") {
        // Several words in one group: split its sound by their sound counts.
        const group = groups[s.g];
        const total = sounds.slice(s.w, w).reduce((a, b) => a + b, 0) || 1;
        let done = 0;
        for (let i = s.w; i < w; i++) {
          marks[i] = { word: words[i], index: i,
                       start: Math.round(group.start + (group.end - group.start) * done / total) };
          done += sounds[i];
        }
      } else {
        marks[s.w] = { word: words[s.w], index: s.w, start: null };   // filled below
      }
      w = s.w; g = s.g;
    }
    // A word with no sound starts where the next sounded word does.
    let following = groups.length ? groups[groups.length - 1].end : 0;
    for (let i = W - 1; i >= 0; i--) {
      if (marks[i].start === null) marks[i].start = following;
      else following = marks[i].start;
    }
    return marks;
  }

  // The desktop's estimate, kept for comparison and as the fallback.
  function estimateMarks(words, totalSamples) {
    const weights = words.map((word) => word.length + 1);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let elapsed = 0;
    return words.map((word, index) => {
      const mark = { word, index, start: Math.round(elapsed) };
      elapsed += totalSamples * weights[index] / total;
      return mark;
    });
  }

  const api = { DEFAULT_HOP_LENGTH, patchForAlignment, spokenGroups, alignWords, estimateMarks };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickTiming = api;
})(typeof self !== "undefined" ? self : globalThis);
