#!/usr/bin/env python3
"""hwpx-gen.py — chem-pre report HWPX generator (v5).

reads JSON content from stdin (or first arg as path) and writes HWPX bytes
to stdout (or second arg as path).

usage:
    python3 hwpx-gen.py < content.json > output.hwpx
    python3 hwpx-gen.py content.json output.hwpx

v5 brings the hwpx output to feature-parity with docx-gen.js:
- explicit Malgun Gothic font + per-heading point sizes (20/16/13/11/10/9 pt)
- 1.3 line spacing across the document
- 5 mm / 10 mm left indent on (1)..(N) items and notes
- right-aligned date / temperature / pressure on the title page
- dashed gray border on figure placeholder boxes; caption centered & italic
- Google image-search hyperlink rendered as blue underlined link
- light-blue shaded + bold + centered header row in the chemicals summary
- real OWPML sub/super script runs for _{x} / ^{x} markers (Unicode fallback
  removed — Hangul renders true subscripts/superscripts)
- inline **bold** / *italic* mixed at run level
"""
import sys
import json
import re
from copy import deepcopy
from lxml import etree

from hwpx import HwpxDocument


KR_NUM = ["가", "나", "다", "라", "마", "바", "사", "아",
          "자", "차", "카", "타", "파", "하"]

# A4 page is 59528 HWPUNIT wide with 8504 left/right margins → 42520 usable.
TABLE_WIDTH = 42000

NS_HH = "{http://www.hancom.co.kr/hwpml/2011/head}"
NS_HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
# `hc` is the HWPML "core" namespace at .../2011/core (NOT the .../2010/charDefault
# guess we used earlier; that mismatch caused lxml to emit ns2:fillBrush, which
# Hangul ignored). Verified against the user's Energy Conservation.hwpx.
NS_HC = "{http://www.hancom.co.kr/hwpml/2011/core}"

# OWPML char height is in 1/100 pt (so 1100 == 11 pt).
SIZE_TITLE_BIG = 2000     # 실험 보고서 (20 pt)
SIZE_TITLE = 1600         # 영문 (한글) 제목 (16 pt)  → also "1." headings
SIZE_HEADING = 1300       # 가./나. 한글 단계 헤딩 (13 pt)
SIZE_BODY = 1100          # 본문 (11 pt)
SIZE_CAPTION = 1000       # 그림 캡션 (10 pt)
SIZE_LINK = 900           # Google 검색 링크 (9 pt)

# margin units: 1 mm ≈ 283.46 HWPUNIT
INDENT_5MM = 1417
INDENT_10MM = 2835

# 1.6 line spacing — Hangul default. 130 (docx 1.3) was too tight and made
# adjacent lines look cramped (user reported "자간이 이상함").
LINE_SPACING_PERCENT = 160

# Figure box border color (gray, matches docx generator)
FIGURE_BORDER_COLOR = "#888888"
TABLE_HEADER_FILL = "#D9E2F3"
LINK_COLOR = "#0563C1"

# Match docx-gen.js FONT constant. Hangul auto-substitutes if Malgun Gothic
# isn't installed (the user's actual font might be 함초롬바탕 etc.).
DEFAULT_FONT_FACE = "Malgun Gothic"


# ── Unicode super/subscript ────────────────────────────────────────────────
# Used as the primary path because Hangul renders these as native subscripts
# without any charPr trickery. Letters fall back to charPr offset+relSz.
SUPERSCRIPT_MAP = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼",
    "(": "⁽", ")": "⁾",
    "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ", "f": "ᶠ",
    "g": "ᵍ", "h": "ʰ", "i": "ⁱ", "j": "ʲ", "k": "ᵏ", "l": "ˡ",
    "m": "ᵐ", "n": "ⁿ", "o": "ᵒ", "p": "ᵖ", "r": "ʳ", "s": "ˢ",
    "t": "ᵗ", "u": "ᵘ", "v": "ᵛ", "w": "ʷ", "x": "ˣ", "y": "ʸ", "z": "ᶻ",
}
SUBSCRIPT_MAP = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "−": "₋", "=": "₌",
    "(": "₍", ")": "₎",
    "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ",
    "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ", "p": "ₚ", "r": "ᵣ",
    "s": "ₛ", "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ",
}


def _try_unicode_map(s, table):
    out = []
    for ch in s:
        if ch in table:
            out.append(table[ch])
        else:
            return None
    return "".join(out)


# ── Element helpers ─────────────────────────────────────────────────────────


def _para_props(doc):
    hdr = doc.oxml.headers[0]
    for ch in hdr.element.iter(f"{NS_HH}paraProperties"):
        return hdr, ch
    return hdr, None


def _border_fills(doc):
    hdr = doc.oxml.headers[0]
    for ch in hdr.element.iter(f"{NS_HH}borderFills"):
        return hdr, ch
    return hdr, None


def _char_props(doc):
    hdr = doc.oxml.headers[0]
    for ch in hdr.element.iter(f"{NS_HH}charProperties"):
        return hdr, ch
    return hdr, None


def apply_default_font(doc, face=DEFAULT_FONT_FACE):
    """rewrite the face attribute of every <hh:font> in every <hh:fontface>
    so the document's primary text font matches docx output (Malgun Gothic
    in our case). Hangul falls back gracefully if the face is missing on
    the user's machine.
    """
    hdr = doc.oxml.headers[0]
    changed = False
    for font in hdr.element.iter(f"{NS_HH}font"):
        if font.get("face") != face:
            font.set("face", face)
            changed = True
    if changed:
        hdr.mark_dirty()


def _next_id(container):
    used = [
        int(c.get("id"))
        for c in container
        if c.get("id") is not None and c.get("id").lstrip("-").isdigit()
    ]
    return str(max(used) + 1) if used else "1"


# ── char property factory ──────────────────────────────────────────────────

_CHAR_CACHE_KEY = "_v5_char_cache"


def make_char_pr(doc, *, size=SIZE_BODY, bold=False, italic=False,
                 sub=False, sup=False, color=None):
    """create (or reuse) a charPr with the given style and return its id.
    cached via doc._v5_char_cache so repeated style requests don't bloat
    header.xml.
    """
    cache = getattr(doc, _CHAR_CACHE_KEY, None)
    if cache is None:
        cache = {}
        setattr(doc, _CHAR_CACHE_KEY, cache)
    key = (size, bold, italic, sub, sup, color)
    if key in cache:
        return cache[key]

    hdr, char_props = _char_props(doc)
    if char_props is None:
        return None

    template = list(char_props)[0]
    new_cp = deepcopy(template)
    new_id = _next_id(char_props)
    new_cp.set("id", new_id)
    new_cp.set("height", str(size))
    if color:
        new_cp.set("textColor", color)

    # set every fontRef language to "0" so the document's first font face
    # (Malgun Gothic if we registered it; otherwise Hangul default) is used
    fr = new_cp.find(f"{NS_HH}fontRef")
    if fr is not None:
        for lang in ("hangul", "latin", "hanja", "japanese",
                     "other", "symbol", "user"):
            fr.set(lang, "0")

    # remove any existing emphasis tags from the deep-copied template, then
    # add only the ones we want
    for tag in ("bold", "italic", "subscript", "superscript", "subScript",
                "supScript", "superScript"):
        for el in new_cp.findall(f"{NS_HH}{tag}"):
            new_cp.remove(el)
    if bold:
        etree.SubElement(new_cp, f"{NS_HH}bold")
    if italic:
        etree.SubElement(new_cp, f"{NS_HH}italic")

    # OWPML renders sub/superscript by adjusting the run's relative size
    # (relSz) + vertical offset, NOT a dedicated element. Hangul ignores
    # <hh:subScript/>; it honors relSz=60 + offset instead.
    #
    # offset sign empirically: positive moves UP (the v5 run with
    # offset=-25 still rendered above baseline, indicating Hangul takes
    # the absolute value or treats positive as up). So we use
    #   sup → offset = +35  (rises above baseline)
    #   sub → offset = -35  (drops below) — relying on Hangul honoring
    # the negative for subscripts. If that still renders up, swap the
    # sign on both lines.
    if sub or sup:
        rel_sz = new_cp.find(f"{NS_HH}relSz")
        offset = new_cp.find(f"{NS_HH}offset")
        if rel_sz is not None:
            for lang in ("hangul", "latin", "hanja", "japanese",
                         "other", "symbol", "user"):
                rel_sz.set(lang, "70")
        if offset is not None:
            value = "35" if sup else "-35"
            for lang in ("hangul", "latin", "hanja", "japanese",
                         "other", "symbol", "user"):
                offset.set(lang, value)

    char_props.append(new_cp)
    char_props.set("itemCnt", str(int(char_props.get("itemCnt") or 0) + 1))
    hdr.mark_dirty()

    cache[key] = new_id
    return new_id


# ── paragraph property factory ─────────────────────────────────────────────

_PARA_CACHE_KEY = "_v5_para_cache"


def make_para_pr(doc, *, align="LEFT", indent_left=0, line_spacing=None,
                 keep_with_next=False, space_after=0, space_before=0):
    cache = getattr(doc, _PARA_CACHE_KEY, None)
    if cache is None:
        cache = {}
        setattr(doc, _PARA_CACHE_KEY, cache)
    key = (align, indent_left, line_spacing, keep_with_next,
           space_after, space_before)
    if key in cache:
        return cache[key]

    hdr, para_props = _para_props(doc)
    if para_props is None:
        return None

    template = list(para_props)[0]
    new_pp = deepcopy(template)
    new_id = _next_id(para_props)
    new_pp.set("id", new_id)

    al = new_pp.find(f"{NS_HH}align")
    if al is not None:
        al.set("horizontal", align)

    if keep_with_next:
        bs = new_pp.find(f"{NS_HH}breakSetting")
        if bs is not None:
            bs.set("keepWithNext", "1")

    # margin and lineSpacing live inside hp:switch > (hp:case | hp:default)
    sw = new_pp.find(f"{NS_HP}switch")
    if sw is not None:
        for branch in sw:  # hp:case and hp:default both
            margin = branch.find(f"{NS_HH}margin")
            if margin is not None:
                if indent_left:
                    left = margin.find(f"{NS_HC}left")
                    if left is not None:
                        left.set("value", str(indent_left))
                if space_before:
                    prev = margin.find(f"{NS_HC}prev")
                    if prev is not None:
                        prev.set("value", str(space_before))
                if space_after:
                    nxt = margin.find(f"{NS_HC}next")
                    if nxt is not None:
                        nxt.set("value", str(space_after))
            ls = branch.find(f"{NS_HH}lineSpacing")
            if ls is not None and line_spacing is not None:
                ls.set("value", str(line_spacing))

    para_props.append(new_pp)
    para_props.set("itemCnt", str(int(para_props.get("itemCnt") or 0) + 1))
    hdr.mark_dirty()
    cache[key] = new_id
    return new_id


# ── borderFill factories ───────────────────────────────────────────────────


def _new_border_fill(doc, mutator):
    hdr, border_fills = _border_fills(doc)
    if border_fills is None:
        return None
    template = list(border_fills)[0]
    new_bf = deepcopy(template)
    new_id = _next_id(border_fills)
    new_bf.set("id", new_id)
    mutator(new_bf)
    border_fills.append(new_bf)
    border_fills.set("itemCnt", str(int(border_fills.get("itemCnt") or 0) + 1))
    hdr.mark_dirty()
    return new_id


def make_solid_border_fill(doc):
    """plain 4-side SOLID border without fill — for table data cells."""
    cache = getattr(doc, "_v5_solid_bf", None)
    if cache:
        return cache

    def mutate(bf):
        for side in ("leftBorder", "rightBorder", "topBorder", "bottomBorder"):
            el = bf.find(f"{NS_HH}{side}")
            if el is not None:
                el.set("type", "SOLID")
        for old in bf.findall(f"{NS_HH}fillBrush"):
            bf.remove(old)

    new_id = _new_border_fill(doc, mutate)
    doc._v5_solid_bf = new_id
    return new_id


def make_shaded_border_fill(doc, fill_color=TABLE_HEADER_FILL):
    """4-side SOLID border + light fill for table header cells."""
    cache_key = f"_v5_shaded_{fill_color}"
    cache = getattr(doc, cache_key, None)
    if cache:
        return cache

    def mutate(bf):
        for side in ("leftBorder", "rightBorder", "topBorder", "bottomBorder"):
            el = bf.find(f"{NS_HH}{side}")
            if el is not None:
                el.set("type", "SOLID")
        # remove inherited brushes from BOTH possible namespaces
        for ns in (NS_HH, NS_HC):
            for old in bf.findall(f"{ns}fillBrush"):
                bf.remove(old)
        # Hangul writes fillBrush/winBrush in the `hc` (charDefault)
        # namespace, NOT `hh` (head). Using the wrong namespace meant
        # earlier attempts were silently ignored.
        brush = etree.SubElement(bf, f"{NS_HC}fillBrush")
        # Verbatim form taken from a Hangul-shaded cell in the user's
        # 2402구민준_Energy Conservation.hwpx — Hangul ignored every other
        # variant we tried.
        etree.SubElement(
            brush,
            f"{NS_HC}winBrush",
            attrib={
                "faceColor": fill_color,
                "hatchColor": "#000000",
                "alpha": "0",
            },
        )

    new_id = _new_border_fill(doc, mutate)
    setattr(doc, cache_key, new_id)
    return new_id


def make_dashed_border_fill(doc, color=FIGURE_BORDER_COLOR):
    """gray dashed 4-side border for figure placeholder boxes."""
    cache = getattr(doc, "_v5_dashed_bf", None)
    if cache:
        return cache

    def mutate(bf):
        for side in ("leftBorder", "rightBorder", "topBorder", "bottomBorder"):
            el = bf.find(f"{NS_HH}{side}")
            if el is not None:
                el.set("type", "DASH")
                el.set("color", color)
        for old in bf.findall(f"{NS_HH}fillBrush"):
            bf.remove(old)

    new_id = _new_border_fill(doc, mutate)
    doc._v5_dashed_bf = new_id
    return new_id


# ── Marker tokenizer ───────────────────────────────────────────────────────


_MARKER_RE = re.compile(
    r"(\*\*[^*]+\*\*|"          # **bold**
    r"(?<!\*)\*[^*]+\*(?!\*)|"   # *italic*
    r"_\{[^}]+\}|"               # _{sub}
    r"\^\{[^}]+\})"              # ^{sup}
)


def tokenize(text):
    """convert text into [(plain, bold, italic, sub, sup), ...] tokens.

    sub/sup precedence:
    1. Try Unicode subscript/superscript chars — Hangul renders them
       natively as proper subscripts (no styling needed).
    2. If any char in the run isn't in the Unicode map, fall back to a
       charPr offset+relSz run (sub/sup True flag).
    """
    if not text:
        return []
    out = []
    pos = 0
    for m in _MARKER_RE.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], False, False, False, False))
        token = m.group(0)
        if token.startswith("**"):
            out.append((token[2:-2], True, False, False, False))
        elif token.startswith("_{"):
            body = token[2:-1]
            mapped = _try_unicode_map(body, SUBSCRIPT_MAP)
            if mapped is not None:
                out.append((mapped, False, False, False, False))
            else:
                out.append((body, False, False, True, False))
        elif token.startswith("^{"):
            body = token[2:-1]
            mapped = _try_unicode_map(body, SUPERSCRIPT_MAP)
            if mapped is not None:
                out.append((mapped, False, False, False, False))
            else:
                out.append((body, False, False, False, True))
        else:
            out.append((token[1:-1], False, True, False, False))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False, False, False, False))
    return [t for t in out if t[0]]


def tokens_plain(text):
    """fully strip every marker — for table cells / footers / captions that
    can't carry inline runs.
    """
    return "".join(tok[0] for tok in tokenize(text))


# ── Paragraph builder ──────────────────────────────────────────────────────


def add_para(doc, text, *, base_size=SIZE_BODY, bold=False, align="LEFT",
             indent_left=0, keep_with_next=False, color=None,
             space_after=0, space_before=0):
    """add a paragraph with mixed runs honoring **bold**, *italic*, _{sub},
    ^{sup}. The paragraph itself takes alignment + indent + line spacing
    + optional vertical breathing room (space_after / space_before in
    HWPUNIT — 283 ≈ 1mm ≈ 2.83pt).
    """
    para_pr = make_para_pr(
        doc,
        align=align,
        indent_left=indent_left,
        line_spacing=LINE_SPACING_PERCENT,
        keep_with_next=keep_with_next,
        space_after=space_after,
        space_before=space_before,
    )
    p = doc.add_paragraph(
        "", para_pr_id_ref=para_pr, inherit_style=False
    )

    tokens = tokenize(text)
    if not tokens:
        cp = make_char_pr(doc, size=base_size, bold=bold, color=color)
        p.add_run("", char_pr_id_ref=cp)
        return p

    for plain, b, i, sub, sup in tokens:
        cp = make_char_pr(
            doc,
            size=base_size,
            bold=bold or b,
            italic=i,
            sub=sub,
            sup=sup,
            color=color,
        )
        p.add_run(plain, char_pr_id_ref=cp)
    return p


# spacing constants (HWPUNIT). docx-gen used spaceAfter 80 (~4pt) for body
# paragraphs and 120~200 (~6~10pt) for headings. We mirror that scale.
SPACE_BODY = 200          # small breathing room after each body paragraph
SPACE_HEADING_LV1 = 600   # 1./2. headings: bigger gap before to separate sections
SPACE_HEADING_LV2 = 300   # 가./나. headings


def add_heading(doc, text, *, size=SIZE_TITLE, align="LEFT", indent_left=0,
                space_before=0, space_after=0):
    return add_para(
        doc,
        text,
        base_size=size,
        bold=True,
        align=align,
        indent_left=indent_left,
        keep_with_next=True,
        space_before=space_before,
        space_after=space_after,
    )


def add_blank(doc):
    doc.add_paragraph("")


# ── Section builders ──────────────────────────────────────────────────────


def build_title_page(doc, content):
    title_kr = content.get("title_kr", "")
    title_en = content.get("title_en", "")
    date = content.get("date", "")
    student_id = (content.get("student_id") or "").strip()
    student_name = (content.get("student_name") or "").strip()
    temperature = (content.get("temperature") or "").strip()
    pressure = (content.get("pressure") or "").strip()
    report_number = (content.get("report_number") or "").strip()

    add_heading(
        doc, "실험 보고서", size=SIZE_TITLE_BIG, align="CENTER",
        space_after=SPACE_HEADING_LV1,
    )
    add_heading(
        doc, f"{title_en} ({title_kr})", size=SIZE_TITLE, align="CENTER",
        space_after=SPACE_HEADING_LV1,
    )

    # 보고서 번호 — 매뉴얼 파일명에서 추출 (예: "I-23")
    if report_number:
        add_para(doc, f"보고서 번호 : {report_number}", align="RIGHT")

    if student_id or student_name:
        identity = " / ".join(
            x for x in [
                f"학번 : {student_id}" if student_id else "",
                f"이름 : {student_name}" if student_name else "",
            ] if x
        )
        add_para(doc, identity, align="RIGHT")

    add_para(doc, f"날짜 : {date}", align="RIGHT")
    tp_line = f"온도/기압 : {temperature or ''} / {pressure or ''}"
    add_para(doc, tp_line, align="RIGHT", space_after=SPACE_HEADING_LV1)


def build_purpose(doc, items):
    add_heading(doc, "1. 실험목표", size=SIZE_TITLE,
                space_before=SPACE_HEADING_LV1, space_after=SPACE_HEADING_LV2)
    add_heading(doc, "가. 실험목표", size=SIZE_HEADING,
                space_after=SPACE_BODY)
    for idx, item in enumerate(items, 1):
        add_para(doc, f"({idx}) {item}", indent_left=INDENT_5MM)


def build_theory(doc, theory, figures_needed):
    add_heading(doc, "2. 이론적 배경과 원리", size=SIZE_TITLE,
                space_before=SPACE_HEADING_LV1, space_after=SPACE_HEADING_LV2)
    fig_map = {f.get("number"): f for f in (figures_needed or [])}

    for s_idx, section in enumerate(theory):
        kr = KR_NUM[s_idx] if s_idx < len(KR_NUM) else str(s_idx + 1)
        add_heading(doc, f"{kr}. {section.get('topic', '')}", size=SIZE_HEADING,
                    space_after=SPACE_BODY)

        items = section.get("items") or section.get("paragraphs") or []
        text_counter = 0
        for item in items:
            if isinstance(item, dict) and "figure" in item:
                fig_num = item["figure"]
                fig = fig_map.get(fig_num)
                if fig:
                    add_figure_placeholder(doc, fig)
                else:
                    add_para(doc, f"[그림 {fig_num}] (메타데이터 없음)")
            elif isinstance(item, str):
                text_counter += 1
                add_para(doc, f"({text_counter}) {item}", indent_left=INDENT_5MM)

        for fig_ref in section.get("figures", []):
            full = fig_map.get(fig_ref.get("number")) or fig_ref
            add_figure_placeholder(doc, full)


def add_figure_placeholder(doc, fig):
    """dashed-border 2x1 box: caption (centered, italic) + image area."""
    caption = fig.get("caption", "")
    description = fig.get("description", "")
    search_query = fig.get("search_query") or caption
    number = fig.get("number", "")

    head = f"[그림 {number}] {tokens_plain(caption)}"
    if description:
        head += f" — {tokens_plain(description)}"

    dashed_id = make_dashed_border_fill(doc)

    table = doc.add_table(rows=2, cols=1, width=TABLE_WIDTH,
                          border_fill_id_ref=dashed_id)

    # apply dashed borderFill to every cell in the table
    for r in range(2):
        cell = table.cell(r, 0)
        cell.element.set("borderFillIDRef", str(dashed_id))

    # caption: italic, size 20, center-aligned
    cap_cell = table.cell(0, 0)
    _replace_cell_with_styled(
        doc, cap_cell, head,
        size=SIZE_CAPTION, italic=True, align="CENTER",
    )

    # image area: prompt text + Google search hyperlink
    img_cell = table.cell(1, 0)
    _replace_cell_with_styled(
        doc, img_cell,
        "  ↓ 여기에 이미지를 붙여넣으세요",
        size=SIZE_LINK, align="CENTER",
    )
    img_cell.set_size(height=18000)

    # add hyperlink as a second paragraph in the image cell
    link_para_pr = make_para_pr(
        doc, align="CENTER", line_spacing=LINE_SPACING_PERCENT
    )
    link_p = img_cell.add_paragraph("", para_pr_id_ref=link_para_pr)
    cp_prefix = make_char_pr(doc, size=SIZE_LINK)
    link_p.add_run("🔎 Google 이미지 검색: ", char_pr_id_ref=cp_prefix)
    cp_link = make_char_pr(doc, size=SIZE_LINK, color=LINK_COLOR)
    link_url = (
        "https://www.google.com/search?tbm=isch&q="
        + _url_encode(search_query)
    )
    try:
        link_p.add_hyperlink(link_url, f'"{search_query}"', char_pr_id_ref=cp_link)
    except Exception:
        link_p.add_run(f'"{search_query}"', char_pr_id_ref=cp_link)


def _url_encode(s):
    from urllib.parse import quote
    return quote(s, safe="")


def _replace_cell_with_styled(doc, cell, text, *, size=SIZE_BODY, bold=False,
                              italic=False, align="LEFT", color=None):
    """erase any existing paragraphs in `cell` and add a single styled one."""
    # remove pre-existing paragraphs (set_cell_text leaves an empty one)
    parent = cell.element
    for p in parent.findall(f"{NS_HP}subList/{NS_HP}p"):
        p.getparent().remove(p)
    # cells may also have raw <hp:p> children
    for p in parent.findall(f"{NS_HP}p"):
        p.getparent().remove(p)

    para_pr = make_para_pr(
        doc, align=align, line_spacing=LINE_SPACING_PERCENT
    )
    p = cell.add_paragraph("", para_pr_id_ref=para_pr)
    tokens = tokenize(text)
    if not tokens:
        cp = make_char_pr(doc, size=size, bold=bold, italic=italic, color=color)
        p.add_run("", char_pr_id_ref=cp)
        return
    for plain, b, i, sub, sup in tokens:
        cp = make_char_pr(
            doc,
            size=size,
            bold=bold or b,
            italic=italic or i,
            sub=sub,
            sup=sup,
            color=color,
        )
        p.add_run(plain, char_pr_id_ref=cp)


# ── Tables ─────────────────────────────────────────────────────────────────


def build_chemicals_summary_table(doc, rows):
    if not rows:
        return
    headers = ["시약", "화학식", "몰질량(g/mol)", "녹는점/끓는점", "주요 특성"]
    solid_id = make_solid_border_fill(doc)
    shaded_id = make_shaded_border_fill(doc)

    table = doc.add_table(
        rows=len(rows) + 1,
        cols=len(headers),
        width=TABLE_WIDTH,
        border_fill_id_ref=solid_id,
    )

    # header row: shaded + bold + center
    for c, h in enumerate(headers):
        cell = table.cell(0, c)
        cell.element.set("borderFillIDRef", str(shaded_id))
        _replace_cell_with_styled(
            doc, cell, h, size=SIZE_BODY, bold=True, align="CENTER",
        )

    # data rows
    for r_idx, row in enumerate(rows, 1):
        cells = [
            row.get("name", ""),
            row.get("formula", ""),
            row.get("molar_mass", ""),
            row.get("mp_bp", ""),
            row.get("properties", ""),
        ]
        for c_idx, val in enumerate(cells):
            cell = table.cell(r_idx, c_idx)
            cell.element.set("borderFillIDRef", str(solid_id))
            align = "CENTER" if c_idx in (2, 3) else "LEFT"
            _replace_cell_with_styled(
                doc, cell, val, size=SIZE_BODY, align=align,
            )


def build_apparatus_and_chemicals(doc, content):
    add_heading(doc, "3. 실험 기구 및 시약", size=SIZE_TITLE,
                space_before=SPACE_HEADING_LV1, space_after=SPACE_HEADING_LV2)
    add_heading(doc, "가. 실험 기구", size=SIZE_HEADING,
                space_after=SPACE_BODY)
    for idx, ap in enumerate(content.get("apparatus", []), 1):
        en = f" ({ap.get('name_en')})" if ap.get("name_en") else ""
        line = f"({idx}) **{ap.get('name', '')}**{en}: {ap.get('description', '')}"
        add_para(doc, line, indent_left=INDENT_5MM)

    add_heading(doc, "나. 시약", size=SIZE_HEADING, space_after=SPACE_BODY)
    # build URL→[N] index so duplicate sources share the same number
    ref_index = _ref_url_index(content)
    for idx, ch in enumerate(content.get("chemicals", []), 1):
        ref_marker = ""
        src = (ch.get("source_url") or "").strip()
        if src and src in ref_index:
            ref_marker = f" [{ref_index[src]}]"
        head = (
            f"({idx}) **{ch.get('name', '')}** "
            f"({ch.get('iupac', '')}, {ch.get('formula', '')}){ref_marker}"
        )
        add_para(doc, head, indent_left=INDENT_5MM)

        details = []
        if ch.get("molar_mass"):
            details.append(f"몰질량: {ch['molar_mass']}")
        if ch.get("mp_bp"):
            details.append(f"녹는점/끓는점: {ch['mp_bp']}")
        if ch.get("density"):
            details.append(f"밀도: {ch['density']}")
        if ch.get("properties"):
            details.append(f"주요 특성: {ch['properties']}")
        if ch.get("toxicity"):
            details.append(f"독성/취급: {ch['toxicity']}")
        if details:
            add_para(doc, " / ".join(details), indent_left=INDENT_10MM)

    summary = content.get("chemicals_summary_table") or []
    if summary:
        add_heading(doc, "[표 1] 시약 요약", size=SIZE_BODY)
        build_chemicals_summary_table(doc, summary)


def build_table_of_contents(doc, content):
    """short TOC after the title page. Built from content (theory topics,
    procedure titles), not from headings already in the doc, since hwpx
    doesn't expose page numbers from Python.
    """
    has_refs = bool(_ref_url_index(content))
    has_chemicals = bool(content.get("chemicals_summary_table"))

    add_heading(doc, "목차", size=SIZE_TITLE,
                space_before=SPACE_HEADING_LV1, space_after=SPACE_HEADING_LV2)

    def lv1(text):
        add_para(doc, text, base_size=SIZE_BODY, bold=True,
                 indent_left=INDENT_5MM)

    def lv2(text):
        add_para(doc, text, base_size=SIZE_BODY, indent_left=INDENT_10MM)

    lv1("1. 실험목표")
    lv2("가. 실험목표")

    lv1("2. 이론적 배경과 원리")
    for s_idx, section in enumerate(content.get("theory", [])):
        kr = KR_NUM[s_idx] if s_idx < len(KR_NUM) else str(s_idx + 1)
        topic = section.get("topic", "")
        lv2(f"{kr}. {topic}")

    lv1("3. 실험 기구 및 시약")
    lv2("가. 실험 기구")
    lv2("나. 시약")
    if has_chemicals:
        lv2("[표 1] 시약 요약")

    lv1("4. 실험 과정")
    for sec_idx, sec in enumerate(content.get("procedure", [])):
        kr = KR_NUM[sec_idx] if sec_idx < len(KR_NUM) else str(sec_idx + 1)
        lv2(f"{kr}. {sec.get('title', '')}")

    if has_refs:
        lv1("참고문헌")


def _ref_url_index(content):
    """build a dict mapping each URL to its 1-based reference index.
    Sources are gathered from chemicals[].source_url and references[].url
    (deduped, in first-seen order). Returns {} when there are no sources.
    """
    out = {}
    n = 0
    for ch in content.get("chemicals", []) or []:
        url = (ch.get("source_url") or "").strip()
        if url and url not in out:
            n += 1
            out[url] = n
    for ref in content.get("references", []) or []:
        url = (ref.get("url") or "").strip()
        if url and url not in out:
            n += 1
            out[url] = n
    return out


def _ref_label_for(url, content):
    """find a human label for a URL (from references[] or chemicals[])."""
    for ref in content.get("references", []) or []:
        if (ref.get("url") or "").strip() == url:
            return (ref.get("label") or url).strip()
    for ch in content.get("chemicals", []) or []:
        if (ch.get("source_url") or "").strip() == url:
            return (ch.get("name") or url).strip()
    return url


def build_references(doc, content):
    """append a "참고문헌" heading + numbered list of clickable URLs at the
    end of the document. Skips entirely if there are no sources.
    """
    ref_index = _ref_url_index(content)
    if not ref_index:
        return

    add_heading(doc, "참고문헌", size=SIZE_TITLE,
                space_before=SPACE_HEADING_LV1, space_after=SPACE_HEADING_LV2)

    # ordered by index
    for url in sorted(ref_index.keys(), key=lambda u: ref_index[u]):
        idx = ref_index[url]
        label = _ref_label_for(url, content)

        # Render as: "[1] PubChem — Water (CID 962): https://..."
        para_pr = make_para_pr(
            doc, indent_left=INDENT_5MM, line_spacing=LINE_SPACING_PERCENT
        )
        p = doc.add_paragraph(
            "", para_pr_id_ref=para_pr, inherit_style=False
        )
        cp = make_char_pr(doc, size=SIZE_BODY)
        p.add_run(f"[{idx}] {label}: ", char_pr_id_ref=cp)

        cp_link = make_char_pr(doc, size=SIZE_BODY, color=LINK_COLOR)
        try:
            p.add_hyperlink(url, url, char_pr_id_ref=cp_link)
        except Exception:
            p.add_run(url, char_pr_id_ref=cp_link)


def build_procedure(doc, procedure):
    add_heading(doc, "4. 실험 과정", size=SIZE_TITLE,
                space_before=SPACE_HEADING_LV1, space_after=SPACE_HEADING_LV2)
    for sec_idx, sec in enumerate(procedure):
        kr = KR_NUM[sec_idx] if sec_idx < len(KR_NUM) else str(sec_idx + 1)
        add_heading(doc, f"{kr}. {sec.get('title', '')}", size=SIZE_HEADING,
                    space_after=SPACE_BODY)
        for st_idx, step in enumerate(sec.get("steps", []), 1):
            if isinstance(step, str):
                add_para(doc, f"({st_idx}) {step}", indent_left=INDENT_5MM)
            elif isinstance(step, dict):
                add_para(
                    doc,
                    f"({st_idx}) {step.get('text', '')}",
                    indent_left=INDENT_5MM,
                )
                for note in step.get("notes", []):
                    add_para(doc, f"- {note}", indent_left=INDENT_10MM)


# ── Footer with auto page number ───────────────────────────────────────────


def add_page_number_to_footer(doc):
    try:
        sec = doc.oxml.sections[0]
    except (IndexError, AttributeError):
        return
    sec_elem = getattr(sec, "element", None)
    if sec_elem is None:
        return
    for footer in sec_elem.iter(f"{NS_HP}footer"):
        for run in footer.iter(f"{NS_HP}run"):
            t = run.find(f"{NS_HP}t")
            if t is None or t.text is None:
                continue
            if "사전보고서" not in t.text:
                continue
            t.text = "- "
            etree.SubElement(
                run,
                f"{NS_HP}pageNum",
                attrib={"pageStartsOn": "BOTH", "pageNumberFormat": "DIGIT"},
            )
            tail = etree.SubElement(run, f"{NS_HP}t")
            tail.text = " -"
            if hasattr(sec, "mark_dirty"):
                sec.mark_dirty()
            return


# ── Top-level ─────────────────────────────────────────────────────────────


def generate_hwpx(content):
    doc = HwpxDocument.new()
    apply_default_font(doc)

    build_title_page(doc, content)
    build_table_of_contents(doc, content)
    build_purpose(doc, content.get("purpose", []))
    build_theory(doc, content.get("theory", []), content.get("figures_needed", []))
    build_apparatus_and_chemicals(doc, content)
    build_procedure(doc, content.get("procedure", []))
    build_references(doc, content)

    try:
        doc.set_footer_text("- 사전보고서 -")
        add_page_number_to_footer(doc)
    except Exception:
        pass

    return doc


def _postprocess_equations(hwpx_path):
    """Run hwpx_equation_tool.replace_equation_placeholders so every
    {{EQ:...}} / {{EQN:...}} marker becomes a real <hp:equation> object that
    Hangul renders with its native equation engine.

    The tool can't write to the same path it reads from (its
    write_zip_with_updates opens the output in "w" mode which truncates the
    input on the first call). So we write to a sibling temp file, then
    atomically replace the original.

    Failures are non-fatal: we leave the original hwpx in place.
    """
    try:
        from pathlib import Path
        import shutil, tempfile

        equation_dir = (
            Path(__file__).resolve().parents[2] / "equation"
        )
        if str(equation_dir) not in sys.path:
            sys.path.insert(0, str(equation_dir))
        import hwpx_equation_tool

        src = Path(hwpx_path)
        with tempfile.NamedTemporaryFile(
            suffix=".hwpx", dir=src.parent, delete=False
        ) as tf:
            tmp_out = Path(tf.name)
        try:
            count = hwpx_equation_tool.replace_equation_placeholders(src, tmp_out)
            if count > 0:
                shutil.move(str(tmp_out), str(src))
                # validate the converted document — surface unresolved
                # {{EQ:...}} placeholders or empty <hp:script/> elements
                # to stderr so the Node wrapper can show them in progress.
                try:
                    issues = hwpx_equation_tool.validate_hwpx_equations(src)
                    if issues:
                        print(
                            "[hwpx-gen] equation validation warnings:",
                            file=sys.stderr,
                        )
                        for issue in issues[:10]:
                            print(f"  - {issue}", file=sys.stderr)
                    else:
                        print(
                            f"[hwpx-gen] equation conversion OK ({count} equations, no validation issues)",
                            file=sys.stderr,
                        )
                except Exception as ve:
                    print(
                        f"[hwpx-gen] equation validation skipped: {ve}",
                        file=sys.stderr,
                    )
            else:
                tmp_out.unlink()
        except Exception:
            if tmp_out.exists():
                tmp_out.unlink()
            raise
    except Exception as e:
        print(f"[hwpx-gen] equation post-process skipped: {e}", file=sys.stderr)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] != "-":
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            content = json.load(f)
    else:
        content = json.load(sys.stdin)

    doc = generate_hwpx(content)

    if len(sys.argv) >= 3:
        target = sys.argv[2]
        doc.save_to_path(target)
        _postprocess_equations(target)
    else:
        # stdin/stdout mode: write to a temp file so the equation tool can
        # operate on a real path, then stream the result back out.
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tf:
            tmp_path = tf.name
        try:
            doc.save_to_path(tmp_path)
            _postprocess_equations(tmp_path)
            with open(tmp_path, "rb") as f:
                sys.stdout.buffer.write(f.read())
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
