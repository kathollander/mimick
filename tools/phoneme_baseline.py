"""What the desktop app's Piper makes of some awkward sentences.

Run from the desktop repo, whose venv has piper-tts:

    .venv/bin/python ../Mimick/tools/phoneme_baseline.py \
        > ../Mimick/sample/expected-phonemes.json

tools/check_voice.mjs compares the browser's phonemizer against this. The two
are separate builds of espeak-ng, and a difference would be heard, not seen.
"""
import json
import sys
from pathlib import Path

from piper import PiperVoice

SENTENCES = [
    "Hello there, reader.",
    "Dr. Osei paid $4.50 for 3 coffees on 12 March 2021.",
    "In 1998, 42% of the 1,204 respondents said no.",
    "The café's naïve résumé was, oddly, three times longer.",
    "“Quoted,” she said; then (in brackets) e.g. an aside.",
    "Self-determination isn't co-operation — it's something else.",
    "Section 5.2 cites pp. 21–34 and Fig. 3b.",
]

MODEL = Path.home() / ".cache/mimick/piper/en_US-lessac-low.onnx"
voice = PiperVoice.load(str(MODEL))
out = []
for text in SENTENCES:
    phonemes = voice.phonemize(text)
    ids = [i for sentence in phonemes for i in voice.phonemes_to_ids(sentence)]
    out.append({"text": text, "phonemes": "".join("".join(s) for s in phonemes), "ids": ids})
json.dump({"voice": MODEL.stem, "sentences": out}, sys.stdout, ensure_ascii=False, indent=1)
