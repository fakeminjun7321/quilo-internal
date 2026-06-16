#!/usr/bin/env python3
"""form-maker HWPX generator — 한글 양식 생성 / 종이 문서 복원.

고정 양식이 아니라 모델이 정한 범용 문서 블록(blocks[])을 그대로 렌더한다.
블록 type: heading | paragraph | table | figure | summary_box | spacer | pagebreak

문단/제목/표/사진 임베드/한컴 수식 후처리는 phys-result/hwpx-gen.py(및 그것이
재사용하는 chem-pre/hwpx-gen.py = pre)의 공통 헬퍼를 import 해서 쓴다.
"""
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PHYS_HWPX = HERE.parent / "phys-result" / "hwpx-gen.py"

# phys-result 모듈을 통째로 로드 — 그 안에서 chem-pre(pre) 도 함께 로드된다.
_spec = importlib.util.spec_from_file_location("phys_result_hwpx_gen", PHYS_HWPX)
phys = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(phys)

pre = phys.pre  # chem-pre/hwpx-gen.py 공통 헬퍼
HwpxDocument = phys.HwpxDocument

TABLE_WIDTH = pre.TABLE_WIDTH  # 47600 — pre.apply_page_layout 의 본문 너비에 맞춤

# heading level → (글자크기, 굵게, 들여쓰기, 위여백, 아래여백)
HEADING_STYLE = {
    1: dict(size=pre.SIZE_TITLE, bold=True, indent=0,
            sb=pre.SPACE_HEADING_LV1, sa=pre.SPACE_HEADING_LV2),
    2: dict(size=pre.SIZE_HEADING, bold=True, indent=0, sb=400, sa=200),
    3: dict(size=pre.SIZE_BODY, bold=True, indent=pre.INDENT_5MM, sb=200, sa=150),
    4: dict(size=pre.SIZE_BODY, bold=False, indent=pre.INDENT_10MM, sb=120, sa=120),
}

_NUM_RE = re.compile(r"^\s*[-+]?[\d,]+(\.\d+)?\s*%?\s*$")


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _align(value, default="LEFT"):
    a = str(value or "").strip().upper()
    if a in ("LEFT", "CENTER", "RIGHT", "JUSTIFY", "DISTRIBUTE"):
        return a
    return default


def _is_number(text):
    return bool(_NUM_RE.match(str(text or "")))


def _clamp_int(value, lo, hi, default):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def _blank(target):
    """빈 문단 한 줄 — doc 본문 또는 셀(target) 어디에든."""
    try:
        phys.add_paragraph_to(target, "")
    except Exception:
        pass


def _make_no_border_fill(doc):
    """4면 테두리 없는 borderFill(컬럼 레이아웃용). doc 에 캐시."""
    cached = getattr(doc, "_fm_no_border_bf", None)
    if cached is not None:
        return cached

    def mut(bf):
        for tag in ("leftBorder", "rightBorder", "topBorder", "bottomBorder"):
            el = bf.find(f"{pre.NS_HH}{tag}")
            if el is not None:
                el.set("type", "NONE")
                el.set("width", "0.1 mm")
    nb = pre._new_border_fill(doc, mut)
    setattr(doc, "_fm_no_border_bf", nb)
    return nb


# ── 블록 렌더 ──────────────────────────────────────────────────────────────────

def add_page_break(doc):
    """빈 문단을 추가하고 <hp:p pageBreak="1"> 로 쪽 나눔."""
    para = doc.add_paragraph("")
    try:
        para.element.set("pageBreak", "1")
    except Exception:
        pass


def render_heading(doc, blk, target):
    text = str(blk.get("text") or "").strip()
    if not text:
        return
    level = _clamp_int(blk.get("level"), 1, 4, 1)
    st = HEADING_STYLE[level]
    phys.add_para_to(
        doc, target, text,
        base_size=st["size"], bold=st["bold"], align="LEFT",
        indent_left=st["indent"], keep_with_next=True,
        space_before=st["sb"], space_after=st["sa"],
    )


def render_table(doc, blk, ctx, target=None, width=TABLE_WIDTH):
    target = target or doc
    headers = blk.get("headers") if isinstance(blk.get("headers"), list) else []
    rows = blk.get("rows") if isinstance(blk.get("rows"), list) else []
    caption = str(blk.get("caption") or "").strip()
    header_fill = str(blk.get("header_fill") or pre.TABLE_HEADER_FILL)
    col_aligns = blk.get("col_aligns") if isinstance(blk.get("col_aligns"), list) else []

    norm_rows = [r if isinstance(r, list) else ([] if r is None else [r]) for r in rows]
    has_header = bool(headers)
    n_cols = max([len(headers)] + [len(r) for r in norm_rows] + [1])
    n_rows = len(norm_rows) + (1 if has_header else 0)
    if n_rows == 0 or n_cols == 0:
        return

    # 캡션은 표 위(한국어 표 캡션 관례)
    if caption:
        phys.add_para_to(
            doc, target, caption,
            base_size=pre.SIZE_CAPTION, align="LEFT", space_after=80,
        )

    solid_id = pre.make_solid_border_fill(doc)
    table = target.add_table(
        rows=n_rows, cols=n_cols, width=width, border_fill_id_ref=solid_id,
    )
    col_width = max(int(width / n_cols), 900)
    for c in range(n_cols):
        for r in range(n_rows):
            try:
                table.cell(r, c).set_size(width=col_width, height=2000)
            except Exception:
                pass

    r0 = 0
    if has_header:
        shaded_id = pre.make_shaded_border_fill(doc, fill_color=header_fill)
        for c in range(n_cols):
            cell = table.cell(0, c)
            cell.element.set("borderFillIDRef", str(shaded_id))
            pre._replace_cell_with_styled(
                doc, cell, str(headers[c]) if c < len(headers) else "",
                size=pre.SIZE_TABLE_HEADER, bold=True, align="CENTER",
                line_spacing=pre.TABLE_LINE_SPACING_PERCENT,
            )
        r0 = 1

    covered = set()
    anchors = []  # (cell, colspan, rowspan) — span 은 모든 셀 배치 후 일괄 설정
    for ri, row in enumerate(norm_rows):
        rr = ri + r0
        for ci in range(n_cols):
            if (rr, ci) in covered:
                continue
            raw = row[ci] if ci < len(row) else ""
            if isinstance(raw, dict):
                text = str(raw.get("text", ""))
                align = raw.get("align")
                bold = bool(raw.get("bold"))
                fill = raw.get("fill")
                colspan = _clamp_int(raw.get("colspan"), 1, n_cols, 1)
                rowspan = _clamp_int(raw.get("rowspan"), 1, n_rows, 1)
            else:
                text, align, bold, fill, colspan, rowspan = str(raw), None, False, None, 1, 1

            colspan = min(colspan, n_cols - ci)
            rowspan = min(rowspan, n_rows - rr)
            # span 은 아직 설정하지 않는다(설정하면 다음 table.cell() 의 grid 빌드가
            # 겹침으로 실패). 앵커만 기록하고, 루프 종료 후 일괄 설정한다.
            cell = table.cell(rr, ci)
            if colspan > 1 or rowspan > 1:
                anchors.append((cell, colspan, rowspan))
                for dr in range(rowspan):
                    for dc in range(colspan):
                        if dr or dc:
                            covered.add((rr + dr, ci + dc))

            if not align:
                if ci < len(col_aligns) and col_aligns[ci]:
                    align = col_aligns[ci]
                elif _is_number(text):
                    align = "RIGHT"
                else:
                    align = "LEFT"

            border_id = solid_id
            if fill:
                border_id = pre.make_shaded_border_fill(doc, fill_color=str(fill))
            cell.element.set("borderFillIDRef", str(border_id))
            pre._replace_cell_with_styled(
                doc, cell, text,
                size=pre.SIZE_TABLE_BODY, bold=bold, align=_align(align),
                line_spacing=pre.TABLE_LINE_SPACING_PERCENT,
            )

    # 모든 셀 배치가 끝난 뒤: 앵커에 span 설정 → 가려진 <hp:tc> 제거.
    # (순서 중요: span 먼저 설정하면 위에서 table.cell() 이 겹침으로 실패한다.)
    for cell, colspan, rowspan in anchors:
        span = cell.element.find(f"{pre.NS_HP}cellSpan")
        if span is not None:
            span.set("colSpan", str(colspan))
            span.set("rowSpan", str(rowspan))
    if covered:
        covered_str = {(str(r), str(c)) for (r, c) in covered}
        for tr in table.element.findall(f"{pre.NS_HP}tr"):
            for tc in list(tr.findall(f"{pre.NS_HP}tc")):
                ca = tc.find(f"{pre.NS_HP}cellAddr")
                if ca is not None and (ca.get("rowAddr"), ca.get("colAddr")) in covered_str:
                    tr.remove(tc)

    _blank(target)


def render_figure(doc, blk, ctx, target=None, width=TABLE_WIDTH):
    target = target or doc
    photos = ctx["photos"]
    fig_counter = ctx["fig_counter"]
    caption = str(blk.get("caption") or "").strip()
    idxs = blk.get("photo_indices")

    if isinstance(idxs, list) and idxs and photos:
        phys.add_photo_blocks(
            doc, idxs, photos, fig_counter, caption,
            target=target, photo_captions=blk.get("photo_captions"),
        )
        return

    # 사진 없음 → 점선 빈 상자(placeholder)
    dashed_id = pre.make_dashed_border_fill(doc)
    table = target.add_table(rows=1, cols=1, width=width, border_fill_id_ref=dashed_id)
    cell = table.cell(0, 0)
    cell.element.set("borderFillIDRef", str(dashed_id))
    try:
        cell.set_size(width=width, height=7000)
    except Exception:
        pass
    note = str(blk.get("note") or "").strip()
    pre._replace_cell_with_styled(
        doc, cell, note or "［ 그림 · 사진 넣는 자리 ］",
        size=pre.SIZE_BODY, align="CENTER",
        color="#FF0000" if note else None,
        line_spacing=pre.LINE_SPACING_PERCENT,
    )
    if caption:
        fig_counter["value"] += 1
        cap = caption if caption.lstrip().startswith("그림") else f"[그림 {fig_counter['value']}] {caption}"
        phys.add_para_to(
            doc, target, cap,
            base_size=pre.SIZE_CAPTION, align="CENTER", space_after=pre.SPACE_BODY,
        )


def render_summary_box(doc, blk, ctx, target=None, width=TABLE_WIDTH):
    target = target or doc
    solid_id = pre.make_solid_border_fill(doc)
    table = target.add_table(rows=1, cols=1, width=width, border_fill_id_ref=solid_id)
    cell = table.cell(0, 0)
    cell.element.set("borderFillIDRef", str(solid_id))
    phys.clear_cell(cell)
    pre.set_cell_margins(cell)
    label = str(blk.get("label") or "").strip()
    if label:
        phys.add_para_to(
            doc, cell, label,
            base_size=pre.SIZE_HEADING, bold=True, align="CENTER", space_after=120,
        )
    for line in as_list(blk.get("body")):
        if line is None or str(line).strip() == "":
            continue
        phys.add_para_to(
            doc, cell, str(line),
            base_size=pre.SIZE_BODY, align="JUSTIFY", space_after=pre.SPACE_BODY,
        )
    _blank(target)


def render_columns(doc, blk, ctx, target=None, width=TABLE_WIDTH):
    """여러 단(컬럼) 레이아웃 — 무테두리 1행 N열 표의 각 칸에 하위 블록을 렌더.
    ⚠ 표의 한 행은 페이지를 넘어 쪼개지지 않으므로, 한 단의 내용이 한 페이지를
    넘으면 잘리거나 빈 페이지가 생긴다. 짧은 좌우 분할에만 쓴다(긴 내용은 linearize)."""
    target = target or doc
    cols = blk.get("columns")
    if not isinstance(cols, list) or not cols:
        return
    cols = [c if isinstance(c, list) else [] if c is None else [c] for c in cols]
    n = max(1, min(len(cols), 4))
    cols = cols[:n]
    nb = _make_no_border_fill(doc)
    tbl = target.add_table(rows=1, cols=n, width=width, border_fill_id_ref=nb)
    col_width = max(int(width / n), 1200)
    inner_width = max(col_width - 360, 800)  # 셀 좌우 여백만큼 줄여 안쪽 표/박스가 안 잘리게
    for c in range(n):
        cell = tbl.cell(0, c)
        cell.element.set("borderFillIDRef", str(nb))
        try:
            cell.set_size(width=col_width)
        except Exception:
            pass
        phys.clear_cell(cell)
        pre.set_cell_margins(cell, left=160, right=160)
        render_blocks(doc, cols[c], ctx, target=cell, width=inner_width)
    _blank(target)


def render_blocks(doc, blocks, ctx, target=None, width=TABLE_WIDTH):
    target = target or doc
    for blk in as_list(blocks):
        if isinstance(blk, str):
            if blk.strip():
                phys.add_para_to(doc, target, blk, align="JUSTIFY", space_after=pre.SPACE_BODY)
            continue
        if not isinstance(blk, dict):
            continue
        # type 은 데이터 — 혹시 표기 정리로 `summary_{box}` 처럼 첨자 마커가 끼어도 무시.
        bt = re.sub(r"[{}*]", "", str(blk.get("type") or "")).strip().lower()
        if bt == "heading":
            render_heading(doc, blk, target)
        elif bt == "paragraph":
            text = str(blk.get("text") or "")
            if text.strip():
                phys.add_para_to(
                    doc, target, text,
                    align=_align(blk.get("align"), "JUSTIFY"),
                    indent_left=pre.INDENT_5MM if blk.get("hanging") else 0,
                    space_after=pre.SPACE_BODY,
                )
        elif bt == "table":
            render_table(doc, blk, ctx, target, width=width)
        elif bt == "figure":
            render_figure(doc, blk, ctx, target, width=width)
        elif bt == "summary_box":
            render_summary_box(doc, blk, ctx, target, width=width)
        elif bt == "columns":
            render_columns(doc, blk, ctx, target, width=width)
        elif bt == "spacer":
            for _ in range(_clamp_int(blk.get("lines"), 1, 6, 1)):
                _blank(target)
        elif bt == "pagebreak":
            add_page_break(doc)
        else:
            text = str(blk.get("text") or "")
            if text.strip():
                phys.add_para_to(doc, target, text, align="JUSTIFY", space_after=pre.SPACE_BODY)


# ── 표지 / 머리말 ──────────────────────────────────────────────────────────────

def build_title(doc, content):
    title = str(content.get("title") or "문서").strip()
    size = content.get("title_size")
    try:
        size_pt = _clamp_int(float(size) * 100, 800, 4000, pre.SIZE_TITLE_BIG) if size else pre.SIZE_TITLE_BIG
    except (TypeError, ValueError):
        size_pt = pre.SIZE_TITLE_BIG
    phys.add_para_to(
        doc, doc, title,
        base_size=size_pt, bold=True, align="CENTER",
        space_before=200, space_after=pre.SPACE_HEADING_LV1,
    )


def build_meta(doc, content):
    meta = content.get("meta")
    if not isinstance(meta, dict):
        return
    field = str(meta.get("field") or "").strip()
    if field:
        phys.add_para_to(doc, doc, field, base_size=pre.SIZE_BODY, align="RIGHT", space_after=80)
    for author in as_list(meta.get("authors")):
        if str(author).strip():
            phys.add_para_to(doc, doc, str(author), base_size=pre.SIZE_BODY, align="RIGHT", space_after=60)
    advisor = str(meta.get("advisor") or "").strip()
    if advisor:
        phys.add_para_to(doc, doc, advisor, base_size=pre.SIZE_BODY, align="RIGHT", space_after=pre.SPACE_HEADING_LV1)
    keywords = meta.get("keywords")
    if isinstance(keywords, list) and keywords:
        line = "연구 핵심 키워드: " + ", ".join(str(k) for k in keywords if str(k).strip())
        phys.add_para_to(doc, doc, line, base_size=pre.SIZE_BODY, align="LEFT", space_after=pre.SPACE_BODY)


# ── 문서 빌드 ─────────────────────────────────────────────────────────────────

def generate_hwpx(content):
    doc = HwpxDocument.new()
    doc._v5_allow_highlights = bool(content.get("__allowHighlights", True))
    pre.apply_page_layout(doc)
    pre.apply_default_font(doc, pre.resolve_font_face(content))
    ctx = {
        "photos": as_list(content.get("__photos")),
        "fig_counter": {"value": 0},
    }
    build_title(doc, content)
    build_meta(doc, content)
    render_blocks(doc, content.get("blocks"), ctx)
    return doc


# ── 미리보기 텍스트 ────────────────────────────────────────────────────────────

_EQ_MARKER_RE = re.compile(r"\{\{EQN?(?:-LATEX)?:\s*(.*?)\}\}", re.S)


def _clean_preview(text):
    s = str(text or "")
    s = _EQ_MARKER_RE.sub(lambda m: m.group(1), s)
    s = s.replace("_{", "").replace("^{", "").replace("{", "").replace("}", "")
    s = s.replace("**", "").replace("*", "")
    return s.strip()


def _preview_blocks(blocks, lines):
    for blk in as_list(blocks):
        if isinstance(blk, str):
            if blk.strip():
                lines.append(_clean_preview(blk))
        elif isinstance(blk, dict):
            bt = re.sub(r"[{}*]", "", str(blk.get("type") or "")).lower()
            if bt in ("heading", "paragraph"):
                if blk.get("text"):
                    lines.append(_clean_preview(blk["text"]))
            elif bt == "summary_box":
                if blk.get("label"):
                    lines.append(_clean_preview(blk["label"]))
                for b in as_list(blk.get("body")):
                    if str(b).strip():
                        lines.append(_clean_preview(b))
            elif bt in ("table", "figure"):
                if blk.get("caption"):
                    lines.append(_clean_preview(blk["caption"]))
            elif bt == "columns":
                for col in as_list(blk.get("columns")):
                    _preview_blocks(col, lines)


def collect_preview_text(content):
    lines = [str(content.get("title") or "문서"), ""]
    meta = content.get("meta")
    if isinstance(meta, dict):
        if meta.get("field"):
            lines.append(_clean_preview(meta["field"]))
        for author in as_list(meta.get("authors")):
            if str(author).strip():
                lines.append(_clean_preview(author))
        if meta.get("advisor"):
            lines.append(_clean_preview(meta["advisor"]))
        lines.append("")
    _preview_blocks(content.get("blocks"), lines)
    return "\r\n".join(str(x) for x in lines).strip()[:8000] + "\r\n"


def update_preview_text(hwpx_path, text):
    src = Path(hwpx_path)
    with tempfile.NamedTemporaryFile(suffix=".hwpx", dir=src.parent, delete=False) as tf:
        tmp = Path(tf.name)
    try:
        with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            replaced = False
            for item in zin.infolist():
                if item.filename == "Preview/PrvText.txt":
                    zout.writestr(item, text.encode("utf-8"))
                    replaced = True
                else:
                    zout.writestr(item, zin.read(item.filename))
            if not replaced:
                zout.writestr("Preview/PrvText.txt", text.encode("utf-8"))
        shutil.move(str(tmp), str(src))
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def main():
    if len(sys.argv) >= 2 and sys.argv[1] != "-":
        content = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        content = json.loads(sys.stdin.read())

    content = pre._deep_clean_xml(content)
    doc = generate_hwpx(content)

    if len(sys.argv) >= 3:
        target = Path(sys.argv[2])
        doc.save_to_path(str(target))
        pre._postprocess_equations(target)
        pre.ensure_embedded_bindata_items(target)
        update_preview_text(target, collect_preview_text(content))
    else:
        import os
        with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tf:
            tmp_path = Path(tf.name)
        try:
            doc.save_to_path(str(tmp_path))
            pre._postprocess_equations(tmp_path)
            pre.ensure_embedded_bindata_items(tmp_path)
            update_preview_text(tmp_path, collect_preview_text(content))
            sys.stdout.buffer.write(tmp_path.read_bytes())
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
