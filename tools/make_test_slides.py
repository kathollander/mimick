#!/usr/bin/env python3
"""The slide deck tools/check_documents.mjs opens, written as a real .pptx.

    python3 tools/make_test_slides.py

LibreOffice is not used here, as it is for the Word and OpenDocument samples:
asked to write a .pptx it turns every frame into a plain text box, and a deck
with no title placeholder would not test the one thing worth testing -- that a
slide's title becomes a contents entry. So the parts are written out directly,
with a master and a layout for the title and body placeholders to inherit their
geometry and their text sizes from, which is the path slides.py takes.

Every word in it is ours: the browser repository is public.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

SLIDES = [
    ("Reading a Deck Aloud",
     ["A slide deck for Mimick's checks", "Every word of it is ours"]),
    ("What a slide becomes",
     ["Each slide is drawn as one page.",
      "The words land where the slide put them.",
      "The title of a slide becomes a contents entry."]),
    ("What is left behind",
     ["Backgrounds and colours are dropped.",
      "Drawn shapes and arrows are dropped.",
      "Speaker notes are not read."]),
]

A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
# A .rels part lives in the package namespace; what each relationship *is* is
# named in the officeDocument one. They differ by one word and mixing them up
# leaves a deck that opens and has no slides in it.
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# A 16:9 slide, in English Metric Units: 12192000 x 6858000 is PowerPoint's own.
TITLE_AT = (838200, 761999, 10515600, 1470025)
BODY_AT = (838200, 2367279, 10515600, 3449319)


def shape(ident: str, name: str, kind: str, at, paragraphs, size: int) -> str:
    """One placeholder shape: where it sits, what it holds, how big its words are."""
    x, y, cx, cy = at
    body = "".join(
        f'<a:p><a:r><a:rPr lang="en-CA" sz="{size}" dirty="0"/>'
        f"<a:t>{text}</a:t></a:r></a:p>" for text in paragraphs)
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{ident}" name="{name}"/>'
            f'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            f'<p:nvPr><p:ph type="{kind}"{"" if kind == "title" else ' idx="1"'}/></p:nvPr></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
            f"<p:txBody><a:bodyPr/><a:lstStyle/>{body}</p:txBody></p:sp>")


def slide(title: str, bullets: list[str]) -> str:
    shapes = (shape("2", "Title 1", "title", TITLE_AT, [title], 4400)
              + shape("3", "Content Placeholder 2", "body", BODY_AT, bullets, 2800))
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f"<p:sld {A} {P} {R}><p:cSld><p:spTree>"
            f'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            f'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
            f'<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            f"{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")


def placeholder_in(kind: str, at, size: int, ident: str, name: str) -> str:
    """The same shape on the layout and the master, with no words of its own:
    what a slide inherits when it does not say where its title goes."""
    x, y, cx, cy = at
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{ident}" name="{name}"/>'
            f'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            f'<p:nvPr><p:ph type="{kind}"{"" if kind == "title" else ' idx="1"'}/></p:nvPr></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
            f'<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="{size}"/></a:lvl1pPr>'
            f"</a:lstStyle><a:p><a:endParaRPr lang=\"en-CA\"/></a:p></p:txBody></p:sp>")


LAYOUT = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          f'<p:sldLayout {A} {P} {R} type="obj" preserve="1"><p:cSld name="Title and Content">'
          f"<p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
          f'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
          f'<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
          + placeholder_in("title", TITLE_AT, 4400, "2", "Title 1")
          + placeholder_in("body", BODY_AT, 2800, "3", "Content Placeholder 2")
          + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>")

MASTER = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          f"<p:sldMaster {A} {P} {R}><p:cSld><p:spTree>"
          f'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
          f'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
          f'<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
          + placeholder_in("title", TITLE_AT, 4400, "2", "Title Placeholder 1")
          + placeholder_in("body", BODY_AT, 2800, "3", "Text Placeholder 2")
          + '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"'
          ' accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5"'
          ' accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
          '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
          "</p:sldMaster>")

PRESENTATION = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f"<p:presentation {A} {P} {R}>"
                '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
                "<p:sldIdLst>"
                + "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 2}"/>' for i in range(len(SLIDES)))
                + "</p:sldIdLst>"
                '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
                "</p:presentation>")


def relationships(pairs: list[tuple[str, str, str]]) -> str:
    items = "".join(f'<Relationship Id="{i}" Type="{REL}/{kind}" Target="{target}"/>'
                    for i, kind, target in pairs)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{PACKAGE_REL}">{items}</Relationships>')


def content_types() -> str:
    slides = "".join(
        f'<Override PartName="/ppt/slides/slide{i + 1}.xml" ContentType='
        f'"application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for i in range(len(SLIDES)))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType='
            '"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType='
            '"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType='
            '"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
            '<Override PartName="/ppt/theme/theme1.xml" ContentType='
            f'"application/vnd.openxmlformats-officedocument.theme+xml"/>{slides}</Types>')


THEME = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         f'<a:theme {A} name="Mimick"><a:themeElements>'
         '<a:clrScheme name="Mimick"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
         '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
         '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>'
         + "".join(f'<a:accent{i}><a:srgbClr val="4472C4"/></a:accent{i}>' for i in range(1, 7))
         + '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
         '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
         '<a:fontScheme name="Mimick">'
         '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
         '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
         "</a:fontScheme>"
         '<a:fmtScheme name="Mimick">'
         '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
         '<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
         '<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
         '<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
         "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>"
         "<a:effectStyle><a:effectLst/></a:effectStyle>"
         "<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"
         '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
         "</a:fmtScheme></a:themeElements></a:theme>")


def build(out: Path) -> None:
    parts = {
        "[Content_Types].xml": content_types(),
        "_rels/.rels": relationships([("rId1", "officeDocument", "ppt/presentation.xml")]),
        "ppt/presentation.xml": PRESENTATION,
        "ppt/_rels/presentation.xml.rels": relationships(
            [("rId1", "slideMaster", "slideMasters/slideMaster1.xml")]
            + [(f"rId{i + 2}", "slide", f"slides/slide{i + 1}.xml") for i in range(len(SLIDES))]),
        "ppt/slideMasters/slideMaster1.xml": MASTER,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships(
            [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
             ("rId2", "theme", "../theme/theme1.xml")]),
        "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships(
            [("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]),
        "ppt/theme/theme1.xml": THEME,
    }
    for i, (title, bullets) in enumerate(SLIDES):
        parts[f"ppt/slides/slide{i + 1}.xml"] = slide(title, bullets)
        parts[f"ppt/slides/_rels/slide{i + 1}.xml.rels"] = relationships(
            [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")])
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as deck:
        for name, text in parts.items():
            deck.writestr(name, text)


if __name__ == "__main__":
    where = Path(__file__).resolve().parent.parent / "sample" / "test-slides.pptx"
    build(where)
    print(f"{where.relative_to(where.parent.parent)}: {where.stat().st_size:,} bytes, "
          f"{len(SLIDES)} slides")
