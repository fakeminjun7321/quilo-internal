#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""독서활동 기록지(독서록) HWPX 생성기.

학교 양식 템플릿(templates/reading-log-template.hwpx)을 열어, 표의 칸을 주소
(행, 열) 기준으로 찾아 도서 정보·인적사항·세 서술 항목을 채운 뒤 HWPX 로 저장한다.

새 문서를 만들지 않고 항상 템플릿을 기반으로 한다(첫 페이지 양식·표 구조 보존).
공용 헬퍼는 phys-result/hwpx-gen.py(→ chem-pre/hwpx-gen.py)에서 그대로 가져온다.
"""

import importlib.util
import json
import os
import pathlib
import re
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE_HWPX = HERE / "templates" / "reading-log-template.hwpx"

# phys-result 모듈을 로드하면 그 안에서 chem-pre(pre)까지 함께 들어온다.
PHYS_HWPX = HERE.parent / "phys-result" / "hwpx-gen.py"
_spec = importlib.util.spec_from_file_location("phys_result_hwpx_gen", str(PHYS_HWPX))
phys = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(phys)

pre = phys.pre  # chem-pre/hwpx-gen.py 헬퍼
HwpxDocument = phys.HwpxDocument
clear_cell = phys.clear_cell
update_preview_text = phys.update_preview_text


# ── 표/셀 접근 ──────────────────────────────────────────────────────────────
def find_main_table(doc):
    """제목 셀에 '독서활동 기록지' 가 든 표를 찾는다. 없으면 첫 표."""
    first = None
    for para in getattr(doc, "paragraphs", []) or []:
        for tbl in getattr(para, "tables", []) or []:
            if first is None:
                first = tbl
            try:
                if "독서활동 기록지" in (tbl.cell(0, 0).text or ""):
                    return tbl
            except Exception:
                pass
    return first


def cell_at(table, rc):
    """(행, 열) 앵커 주소로 셀을 얻는다. 범위 밖이면 None."""
    r, c = rc
    try:
        return table.cell(r, c)
    except Exception:
        return None


def fill_single(doc, table, rc, text, *, align="CENTER"):
    """짧은 값(도서명·저자·학년 등)을 한 줄로 채운다(셀 가운데 정렬 유지)."""
    cell = cell_at(table, rc)
    if cell is None:
        return
    pre._replace_cell_with_styled(
        doc, cell, str(text), size=pre.SIZE_BODY, align=align
    )


def fill_multi(doc, table, rc, paras, *, align="LEFT", line_spacing=160):
    """여러 문단(서술 항목)을 채운다. 빈 리스트면 셀을 비운다."""
    cell = cell_at(table, rc)
    if cell is None:
        return
    pre.set_cell_margins(cell)
    clear_cell(cell)
    para_pr = pre.make_para_pr(doc, align=align, line_spacing=line_spacing)
    items = [str(p) for p in (paras or []) if str(p).strip()]
    if not items:
        cell.add_paragraph("", para_pr_id_ref=para_pr)
        return
    for txt in items:
        p = cell.add_paragraph("", para_pr_id_ref=para_pr)
        for plain, b, i, sub, sup, hl in pre.tokenize(txt):
            cp = pre.make_char_pr(
                doc, size=pre.SIZE_BODY, bold=b, italic=i, sub=sub, sup=sup, highlight=hl
            )
            p.add_run(plain, char_pr_id_ref=cp)


# ── 학번 파싱 ───────────────────────────────────────────────────────────────
def parse_student_id(sid):
    """학년/반/번호를 '명확히' 분리할 수 있을 때만 (학년, 반, 번호) 반환.
    구분자가 없는 숫자열은 형식을 단정할 수 없어 (None,None,None)로 둔다(날조 방지)."""
    sid = str(sid or "").strip()
    if not sid:
        return (None, None, None)
    m = re.match(
        r"^\s*([1-3])\s*(?:학년)?\s*[-./\s]\s*(\d{1,2})\s*(?:반)?\s*[-./\s]\s*(\d{1,2})\s*(?:번)?\s*$",
        sid,
    )
    if m:
        return (m.group(1), str(int(m.group(2))), str(int(m.group(3))))
    return (None, None, None)


# ── 메인 빌드 ───────────────────────────────────────────────────────────────
def generate_hwpx(content):
    if not TEMPLATE_HWPX.exists():
        raise RuntimeError(f"독서록 템플릿을 찾지 못했습니다: {TEMPLATE_HWPX}")
    doc = HwpxDocument.open(str(TEMPLATE_HWPX))
    pre.apply_body_font(doc, pre.resolve_font_face(content))

    table = find_main_table(doc)
    if table is None:
        raise RuntimeError("독서활동 기록지 템플릿에서 표를 찾지 못했습니다.")

    def g(key):
        return str(content.get(key) or "").strip()

    # 인적사항 — 이름은 프로필에서, 학년/반/번호는 학번을 안전 파싱한 경우만.
    name = g("student_name")
    if name:
        fill_single(doc, table, (1, 10), name)
    grade, cls, num = parse_student_id(content.get("student_id"))
    if grade:
        fill_single(doc, table, (1, 2), grade)
    if cls:
        fill_single(doc, table, (1, 4), cls)
    if num:
        fill_single(doc, table, (1, 8), num)

    # 독서활동 일시
    if g("date_range"):
        fill_single(doc, table, (2, 2), g("date_range"))

    # 독서상황
    book_title = g("book_title") or g("title")
    if book_title:
        fill_single(doc, table, (3, 2), book_title)
    if g("publisher"):
        fill_single(doc, table, (3, 7), g("publisher"))
    if g("author"):
        fill_single(doc, table, (3, 10), g("author"))

    # 학생부 기록영역
    record_area = g("record_area")
    if record_area == "subject":
        if g("subject"):
            fill_single(doc, table, (4, 3), g("subject"))
    elif record_area == "common":
        fill_single(doc, table, (4, 7), "○")

    # 학교 도서관 대출여부
    borrowed = g("borrowed")
    if borrowed == "yes":
        fill_single(doc, table, (4, 10), "○")
    elif borrowed == "no":
        fill_single(doc, table, (4, 10), "×")

    # 영역 — 선택한 분류 칸에 '해당 항목만' 남기고, 다른 분류 칸은 비운다.
    dg, dl = g("domain_group"), g("domain_label")
    if dg == "전공도서" and dl:
        fill_single(doc, table, (5, 3), dl)
        fill_multi(doc, table, (6, 3), [])
    elif dg == "일반도서" and dl:
        fill_single(doc, table, (6, 3), dl)
        fill_multi(doc, table, (5, 3), [])

    # 세 서술 항목
    fill_multi(doc, table, (7, 1), content.get("selection_reason"))
    fill_multi(doc, table, (8, 1), content.get("content_summary"))
    fill_multi(doc, table, (9, 1), content.get("reflection"))

    return doc


def collect_preview_text(content):
    parts = ["<독서활동 기록지>"]
    bt = str(content.get("book_title") or content.get("title") or "").strip()
    if bt:
        parts.append(f"도서명: {bt}")
    au = str(content.get("author") or "").strip()
    if au:
        parts.append(f"저자: {au}")
    for key in ("selection_reason", "content_summary", "reflection"):
        v = content.get(key)
        if isinstance(v, list) and v:
            parts.append(str(v[0]))
    return "\n".join(parts)[:1500]


def main():
    if len(sys.argv) >= 2 and sys.argv[1] != "-":
        content = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        content = json.loads(sys.stdin.read())

    content = pre._deep_clean_xml(content)
    doc = generate_hwpx(content)

    def finalize(target):
        doc.save_to_path(str(target))
        pre.ensure_embedded_bindata_items(target)
        update_preview_text(target, collect_preview_text(content))

    if len(sys.argv) >= 3:
        finalize(pathlib.Path(sys.argv[2]))
    else:
        with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tf:
            tmp_path = pathlib.Path(tf.name)
        try:
            finalize(tmp_path)
            sys.stdout.buffer.write(tmp_path.read_bytes())
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
