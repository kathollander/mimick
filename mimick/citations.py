"""Finding in-text citations, so they are not read out mid-sentence.

"The deal included CAD 92 million [51]" should be heard without the fifty-one.
The same goes for "(Smith et al., 2020, p. 45)" and a bare "(p. 293)".

Only the common shapes are matched, and each needs a positive signal -- a
bracketed number, a year, a page marker, "et al." -- so ordinary parentheses
survive. "(and this matters)" is left alone.
"""

from __future__ import annotations

import re

# A name as it appears in a citation: Smith, O'Brien, van der Berg, Wet'suwet'en.
_NAME = r"[A-ZÀ-Ü][\w'’‐-―-]*"
_JOIN = r"(?:\s+(?:et\s+al\.|and|&|,)\s*)"
_YEAR = r"(?:1[5-9]|20)\d{2}[a-z]?"
_PAGES = r"p{1,2}\.\s*\d+(?:\s*[‐-―-]\s*\d+)?"

PATTERNS = [
    # Vancouver, IEEE, Nature: [12]  [1,2]  [3-5]  [12], [13]
    re.compile(r"\[\s*\d+(?:\s*[,;]\s*\d+|\s*[‐-―-]\s*\d+)*\s*\]"),
    # APA with "et al.": (Smith et al., 2019)  (Smith et al. 2019, p. 4)
    re.compile(rf"\(\s*{_NAME}\s+et\s+al\.?,?\s*{_YEAR}?"
               rf"(?:\s*[,;]\s*{_PAGES})?\s*\)"),
    # APA, Harvard, Chicago author-date: (Smith, 2020)  (Smith & Jones, 2020, p. 45)
    re.compile(rf"\(\s*(?:see\s+|cf\.\s+|e\.g\.,?\s+)?{_NAME}(?:{_JOIN}{_NAME}?)*,?\s*{_YEAR}"
               rf"(?:\s*[,;]\s*{_PAGES})?\s*\)"),
    # Chicago and MLA without a comma: (Smith 2020, 45)  (Smith 45)
    re.compile(rf"\(\s*{_NAME}(?:{_JOIN}{_NAME}?)*\s+(?:{_YEAR}|\d{{1,4}})"
               rf"(?:\s*[,:]\s*\d+(?:\s*[‐-―-]\s*\d+)?)?\s*\)"),
    # A bare page or year reference: (p. 293)  (pp. 12-15)  (2020)
    re.compile(rf"\(\s*(?:{_PAGES}|{_YEAR})\s*\)"),
    # ibid., op. cit., and friends
    re.compile(r"\(\s*(?:ibid\.?|op\.\s*cit\.?|loc\.\s*cit\.?)[^)]{0,20}\)", re.IGNORECASE),
]


def spans(text: str) -> list[tuple[int, int]]:
    """Character ranges of every citation in a piece of text."""
    found: list[tuple[int, int]] = []
    for pattern in PATTERNS:
        for match in pattern.finditer(text):
            found.append((match.start(), match.end()))
    if not found:
        return []
    found.sort()
    merged = [list(found[0])]
    for start, end in found[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def strip(text: str) -> str:
    """The same text with its citations removed and spacing tidied."""
    for start, end in reversed(spans(text)):
        text = text[:start] + text[end:]
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def mark_words(words) -> None:
    """Flag the words of a run that belong to a citation, so they aren't spoken."""
    if not words:
        return
    pieces, offsets, cursor = [], [], 0
    for word in words:
        offsets.append((cursor, cursor + len(word.text)))
        pieces.append(word.text)
        cursor += len(word.text) + 1
    text = " ".join(pieces)

    ranges = spans(text)
    if not ranges:
        return
    for word, (start, end) in zip(words, offsets):
        for low, high in ranges:
            # A word belongs to the citation if it begins inside the match.
            # Containment is not enough: "(p. 21)." is extracted as the words
            # "(p." and "21).", and the second reaches one character past the
            # closing bracket, so requiring the whole word to fit left a bare
            # "21)." to be read aloud.
            if low <= start < high:
                word.spoken = False
                break
