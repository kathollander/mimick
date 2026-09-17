/* The voices the reader offers: desktop's piper.RECOMMENDED, in its order, with
 * the note against each that says how it reads aloud.
 *
 * Shared by the page, which lists them, and js/piper-worker.js, which fetches
 * a model from rhasspy/piper-voices at REVISION and checks it against these
 * hashes before using it. A sample clip of each, the passage every Piper voice
 * is recorded saying, ships in voices/ so a voice can be heard before its
 * model is downloaded. Two files hold many speakers (vctk 109, libritts_r 904);
 * both speak as speaker 0, the one the clip plays.
 */
(function (root) {
  "use strict";

  const REVISION = "1162a9173d0ce503555aed757976b7a9912eae4c";
  const LIST = [
    { key: "en_US-kathleen-low", name: "Kathleen", accent: "US", note: "calm and unhurried", mb: 60,
      path: "en/en_US/kathleen/low/en_US-kathleen-low",
      onnx: "87adf17f5326bc0782282147a8b9788406236245f0f9b0e68dacb651bc1de8b6",
      json: "39ebab88416edce0f63781754651788620cb97b9bb73ddf3c01f28e29a648feb" },
    { key: "en_GB-southern_english_female-low", name: "Southern English", accent: "UK", note: "southern English", mb: 60,
      path: "en/en_GB/southern_english_female/low/en_GB-southern_english_female-low",
      onnx: "f2f37aed1b3a093476f719d1379ba0c0b1b1cf6f1ef99288e2ebf502971a07c3",
      json: "a1af43310f8756161506e849a2863d342a98b0853af9e2437581d39e9922d0e5" },
    { key: "en_US-joe-medium", name: "Joe", accent: "US", note: "older man, warm", mb: 60,
      path: "en/en_US/joe/medium/en_US-joe-medium",
      onnx: "58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06",
      json: "3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33" },
    { key: "en_US-norman-medium", name: "Norman", accent: "US", note: "older man, newsreader", mb: 61,
      path: "en/en_US/norman/medium/en_US-norman-medium",
      onnx: "b9739443232a80a59c7d18810dd856899bf16a7964725f5ab81ea49b1351cb71",
      json: "6c2db7f558a4a8deb9fe822583c1c5105f6c4e834dd0f9de8ad17a888ee9fe1d" },
    { key: "en_US-kusal-medium", name: "Kusal", accent: "US", note: "younger man, brisk", mb: 60,
      path: "en/en_US/kusal/medium/en_US-kusal-medium",
      onnx: "438ae25bb305b2a7f6d632327d6102df25011f793e8222fa9db876e7321df8f3",
      json: "ddd3c4dfd8b4f568150c934fb94912dd788d44db87f4f0a328c469d7a6761f41" },
    { key: "en_GB-vctk-medium", name: "VCTK", accent: "UK", note: "even, little inflection", mb: 73,
      path: "en/en_GB/vctk/medium/en_GB-vctk-medium",
      onnx: "4e9fc85ab9009385319fc6bae7f55577f8a2d7ee77fd9159a5500eb6531f41e6",
      json: "7f85e6391ed0f7f46e4abd19345929a16be931a0c9945086f96692dce2087fa8" },
    { key: "en_US-libritts_r-medium", name: "LibriTTS", accent: "US", note: "flat and level", mb: 75,
      path: "en/en_US/libritts_r/medium/en_US-libritts_r-medium",
      onnx: "10bb85e071d616fcf4071f369f1799d0491492ab3c5d552ec19fb548fac13195",
      json: "b471dc60d2d8335e819c393d196d6fbf792817f40051257b269878505bc9afb3" },
  ];
  const byKey = Object.fromEntries(LIST.map((v) => [v.key, v]));

  root.MimickVoices = {
    REVISION, LIST, byKey,
    DEFAULT: "en_US-norman-medium", // the one public-domain voice; see voices/README.md
    modelUrl: (key, ext) => `https://huggingface.co/rhasspy/piper-voices/resolve/${REVISION}/${byKey[key].path}${ext}`,
    sampleUrl: (key) => `voices/${key}.mp3`,
  };
})(typeof self !== "undefined" ? self : globalThis);
