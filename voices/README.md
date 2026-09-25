# Voice samples

One clip per voice in `js/voices.js`: the passage every Piper voice is recorded
saying, as published in `rhasspy/piper-voices` at the revision pinned there.
The voice picker (voice box → *Select a new voice…*, `js/voice-picker.js`)
plays them, so a voice can be heard before its model (60–75 MB) is downloaded.

Each voice, from its model card. A Piper voice is usually trained on top of an
older voice, so the licence of the voice it was built on can reach it as well as
its own recordings'.

| Voice | Its recordings | Built on | Standing |
| --- | --- | --- | --- |
| Norman | Public domain | -- | Clean. The default voice for that reason. |
| Kathleen | CC0 | Ryan (CC BY-NC-SA 4.0) | Non-commercial, share-alike, credit Ryan. Fine for Mimick, which is free. |
| Southern English | CC BY-SA 4.0 | Ryan (CC BY-NC-SA 4.0) | The same as Kathleen, and credit the recordings too. |
| Joe | CC0 | Lessac (research only) | Lessac's terms may carry into it. Kept -- see below. |
| Kusal | "See URL": MycroftAI/mimic2 | Lessac (research only) | The same as Joe. |
| VCTK | CC BY 4.0 | Lessac (research only) | The same as Joe, and credit the recordings. |
| LibriTTS | CC BY 4.0 | Lessac (research only) | The same as Joe, and credit the recordings. |

**Checked 17 September.** Lessac itself was taken out: its recordings (Blizzard
2013) are licensed for research only, and cannot be passed on. Kat keeps Joe,
Kusal, VCTK and LibriTTS, accepting the risk that Lessac's terms reach them, for
a free tool for students and accessibility. The credits the CC BY, BY-SA and
BY-NC-SA licences ask for are in the reader's **About** window (`reader.html`,
*Voices*), with a link to each dataset and licence; change both together.

**Convert to MP3 offers only Norman** (Kat, 17 September): the one voice with no
question over its licence, marked `mp3: true` in `js/voices.js`. The others read
aloud in Mimick, but an MP3 is a copy of the voice's output that people keep and
pass on, which is where non-commercial, share-alike and research-only terms
bite. Norman is also the default, and the one voice downloaded without being
asked for.
