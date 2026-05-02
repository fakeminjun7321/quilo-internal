#!/usr/bin/env python3
"""phys-result HWPX generator.

Builds the same two-section physics result report used by docx-gen.js:

1. 실험 결과
2. 결론

The visual structure follows the supplied HWPX physics-result template: compact
A4 margins, the "실험 주제" header, and the general-physics footer. Tables,
charts, and uploaded photos are embedded directly into the HWPX package.
"""
import base64
import importlib.util
import json
import re
import shutil
import struct
import sys
import tempfile
import zipfile
from pathlib import Path
from lxml import etree

HERE = Path(__file__).resolve().parent
PRE_HWPX = HERE.parent / "chem-pre" / "hwpx-gen.py"
TEMPLATE_HWPX = HERE / "templates" / "result-report-template.hwpx"
spec = importlib.util.spec_from_file_location("chem_pre_hwpx_gen", PRE_HWPX)
pre = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pre)

from hwpx import HwpxDocument


PAGE_WIDTH = 59528
PAGE_HEIGHT = 84188
PAGE_MARGIN_LR = 4252
PAGE_MARGIN_TOP = 2835
PAGE_MARGIN_BOTTOM = 2835
PAGE_HEADER = 3402
PAGE_FOOTER = 3969
PHYS_TABLE_WIDTH = 50500

MAX_IMAGE_WIDTH = 33000
MAX_IMAGE_HEIGHT = 23000
MAX_CHART_WIDTH = 36000
MAX_CHART_HEIGHT = 23000
PX_TO_HWPUNIT = 75


def as_list(value):
    return value if isinstance(value, list) else []


def decode_base64(value):
    if not value:
        return b""
    try:
        return base64.b64decode(value)
    except Exception:
        return b""


def clean_label(text):
    return re.sub(r"^\s*\[(?:그림|그래프)\s*\d+\]\s*", "", str(text or "")).strip()


def image_format(name="", mimetype="", data=b""):
    name_ext = Path(str(name or "")).suffix.lower().lstrip(".")
    if name_ext in ("jpg", "jpeg", "png", "gif", "bmp"):
        return "jpg" if name_ext == "jpeg" else name_ext
    mt = str(mimetype or "").lower()
    if "jpeg" in mt:
        return "jpg"
    if "png" in mt:
        return "png"
    if "gif" in mt:
        return "gif"
    if "bmp" in mt:
        return "bmp"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8"):
        return "jpg"
    if data.startswith(b"GIF8"):
        return "gif"
    if data.startswith(b"BM"):
        return "bmp"
    return "png"


def image_size(data):
    try:
        if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
            return struct.unpack(">II", data[16:24])
        if data.startswith(b"GIF8") and len(data) >= 10:
            return struct.unpack("<HH", data[6:10])
        if data.startswith(b"BM") and len(data) >= 26:
            w = struct.unpack("<I", data[18:22])[0]
            h = abs(struct.unpack("<i", data[22:26])[0])
            return w, h
        if data.startswith(b"\xff\xd8"):
            i = 2
            while i + 9 < len(data):
                while i < len(data) and data[i] == 0xFF:
                    i += 1
                marker = data[i]
                i += 1
                if marker in (0xD8, 0xD9):
                    continue
                if i + 2 > len(data):
                    break
                size = struct.unpack(">H", data[i:i + 2])[0]
                if marker in range(0xC0, 0xC4) and i + 7 < len(data):
                    h, w = struct.unpack(">HH", data[i + 3:i + 7])
                    return w, h
                i += size
    except Exception:
        pass
    return 800, 500


def fit_size(width_px, height_px, max_width, max_height):
    width = max(int(width_px * PX_TO_HWPUNIT), 1)
    height = max(int(height_px * PX_TO_HWPUNIT), 1)
    scale = min(max_width / width, max_height / height, 1)
    return max(int(width * scale), 1), max(int(height * scale), 1), width, height


def load_template_doc():
    if TEMPLATE_HWPX.exists():
        return HwpxDocument.open(TEMPLATE_HWPX)
    return None


def clear_template_body(doc):
    """Keep the template's section/header/footer paragraph and remove only
    the instructional body placeholders.
    """
    paragraphs = list(doc.paragraphs)
    for paragraph in reversed(paragraphs[1:]):
        doc.remove_paragraph(paragraph)


def fill_template_title(doc, content):
    title = content.get("title") or content.get("title_en") or content.get("title_kr") or "물리 결과보고서"
    changed = False
    for sec in getattr(doc.oxml, "sections", []):
        element = getattr(sec, "element", None)
        if element is None:
            continue
        for node in element.iter(f"{pre.NS_HP}t"):
            if node.text and "(반드시 기재)" in node.text:
                node.text = node.text.replace("(반드시 기재)", title)
                changed = True
        if changed and hasattr(sec, "mark_dirty"):
            sec.mark_dirty()


def apply_phys_page_layout(doc):
    changed = False
    for sec in getattr(doc.oxml, "sections", []):
        for page_pr in sec.element.iter(f"{pre.NS_HP}pagePr"):
            page_pr.set("width", str(PAGE_WIDTH))
            page_pr.set("height", str(PAGE_HEIGHT))
            margin = page_pr.find(f"{pre.NS_HP}margin")
            if margin is not None:
                margin.set("left", str(PAGE_MARGIN_LR))
                margin.set("right", str(PAGE_MARGIN_LR))
                margin.set("top", str(PAGE_MARGIN_TOP))
                margin.set("bottom", str(PAGE_MARGIN_BOTTOM))
                margin.set("header", str(PAGE_HEADER))
                margin.set("footer", str(PAGE_FOOTER))
                margin.set("gutter", "0")
                changed = True
    if changed:
        for sec in getattr(doc.oxml, "sections", []):
            if hasattr(sec, "mark_dirty"):
                sec.mark_dirty()


def add_phys_page_number_to_footer(doc):
    try:
        doc.set_footer_text("고 2,3 일반물리학실험  - ")
        sec = doc.oxml.sections[0]
    except Exception:
        return
    sec_elem = getattr(sec, "element", None)
    if sec_elem is None:
        return
    for footer in sec_elem.iter(f"{pre.NS_HP}footer"):
        for run in footer.iter(f"{pre.NS_HP}run"):
            t = run.find(f"{pre.NS_HP}t")
            if t is None or t.text is None:
                continue
            if "일반물리학실험" not in t.text:
                continue
            t.text = "고 2,3 일반물리학실험  - "
            etree.SubElement(
                run,
                f"{pre.NS_HP}pageNum",
                attrib={"pageStartsOn": "BOTH", "pageNumberFormat": "DIGIT"},
            )
            tail = etree.SubElement(run, f"{pre.NS_HP}t")
            tail.text = " -"
            if hasattr(sec, "mark_dirty"):
                sec.mark_dirty()
            return


def add_picture(doc, data, *, fmt="png", caption="", max_width=MAX_IMAGE_WIDTH,
                max_height=MAX_IMAGE_HEIGHT):
    if not data:
        return False
    width_px, height_px = image_size(data)
    width, height, org_width, org_height = fit_size(
        width_px, height_px, max_width, max_height,
    )
    item_id = doc.add_image(data, fmt)

    para_pr = pre.make_para_pr(
        doc,
        align="CENTER",
        line_spacing=pre.LINE_SPACING_PERCENT,
        space_after=180,
    )
    para = doc.add_paragraph(
        "",
        para_pr_id_ref=para_pr,
        inherit_style=False,
        include_run=False,
    )
    pic = para.add_shape(
        "pic",
        attributes={
            "id": str(id(data) & 0x7FFFFFFF),
            "zOrder": "1",
            "numberingType": "PICTURE",
            "textWrap": "TOP_AND_BOTTOM",
            "textFlow": "BOTH_SIDES",
            "lock": "0",
            "dropcapstyle": "None",
            "href": "",
            "groupLevel": "0",
            "instid": str((id(data) + 17) & 0x7FFFFFFF),
            "reverse": "0",
        },
    ).element

    etree.SubElement(pic, f"{pre.NS_HP}offset", x="0", y="0")
    etree.SubElement(pic, f"{pre.NS_HP}orgSz", width=str(org_width), height=str(org_height))
    etree.SubElement(pic, f"{pre.NS_HP}curSz", width=str(width), height=str(height))
    etree.SubElement(pic, f"{pre.NS_HP}flip", horizontal="0", vertical="0")
    etree.SubElement(
        pic,
        f"{pre.NS_HP}rotationInfo",
        angle="0",
        centerX=str(width // 2),
        centerY=str(height // 2),
        rotateimage="1",
    )
    rendering = etree.SubElement(pic, f"{pre.NS_HP}renderingInfo")
    etree.SubElement(rendering, f"{pre.NS_HC}transMatrix", e1="1", e2="0", e3="0", e4="0", e5="1", e6="0")
    etree.SubElement(rendering, f"{pre.NS_HC}scaMatrix", e1="1", e2="0", e3="0", e4="0", e5="1", e6="0")
    etree.SubElement(rendering, f"{pre.NS_HC}rotMatrix", e1="1", e2="0", e3="0", e4="0", e5="1", e6="0")
    etree.SubElement(
        pic,
        f"{pre.NS_HC}img",
        binaryItemIDRef=item_id,
        bright="0",
        contrast="0",
        effect="REAL_PIC",
        alpha="0",
    )
    rect = etree.SubElement(pic, f"{pre.NS_HP}imgRect")
    for name, x, y in (
        ("pt0", 0, 0),
        ("pt1", org_width, 0),
        ("pt2", org_width, org_height),
        ("pt3", 0, org_height),
    ):
        etree.SubElement(rect, f"{pre.NS_HC}{name}", x=str(x), y=str(y))
    etree.SubElement(pic, f"{pre.NS_HP}imgClip", left="0", right=str(org_width), top="0", bottom=str(org_height))
    etree.SubElement(pic, f"{pre.NS_HP}inMargin", left="0", right="0", top="0", bottom="0")
    etree.SubElement(pic, f"{pre.NS_HP}imgDim", dimwidth=str(org_width), dimheight=str(org_height))
    etree.SubElement(pic, f"{pre.NS_HP}effects")
    etree.SubElement(
        pic,
        f"{pre.NS_HP}sz",
        width=str(width),
        widthRelTo="ABSOLUTE",
        height=str(height),
        heightRelTo="ABSOLUTE",
        protect="0",
    )
    etree.SubElement(
        pic,
        f"{pre.NS_HP}pos",
        treatAsChar="1",
        affectLSpacing="0",
        flowWithText="1",
        allowOverlap="1",
        holdAnchorAndSO="0",
        vertRelTo="PARA",
        horzRelTo="COLUMN",
        vertAlign="TOP",
        horzAlign="CENTER",
        vertOffset="0",
        horzOffset="0",
    )
    etree.SubElement(pic, f"{pre.NS_HP}outMargin", left="0", right="0", top="0", bottom="0")
    etree.SubElement(pic, f"{pre.NS_HP}shapeComment").text = caption or "image"

    if caption:
        pre.add_para(
            doc,
            caption,
            base_size=pre.SIZE_CAPTION,
            align="CENTER",
            space_after=pre.SPACE_BODY,
        )
    return True


def add_table(doc, headers, rows, caption=None):
    headers = [str(h or "") for h in headers]
    rows = [[str(c or "") for c in row] for row in rows or []]
    if not headers:
        return

    solid_id = pre.make_solid_border_fill(doc)
    shaded_id = pre.make_shaded_border_fill(doc)
    table = doc.add_table(
        rows=len(rows) + 1,
        cols=len(headers),
        width=PHYS_TABLE_WIDTH,
        border_fill_id_ref=solid_id,
    )
    col_count = max(len(headers), max([len(r) for r in rows] + [len(headers)]), 1)
    col_width = max(int(PHYS_TABLE_WIDTH / col_count), 2200)

    for c in range(len(headers)):
        for r in range(len(rows) + 1):
            try:
                table.cell(r, c).set_size(width=col_width)
            except Exception:
                pass

    for c, text in enumerate(headers):
        cell = table.cell(0, c)
        cell.element.set("borderFillIDRef", str(shaded_id))
        pre._replace_cell_with_styled(
            doc,
            cell,
            text,
            size=pre.SIZE_TABLE_HEADER,
            bold=True,
            align="CENTER",
            line_spacing=pre.TABLE_LINE_SPACING_PERCENT,
        )

    for r_idx, row in enumerate(rows, 1):
        for c_idx in range(len(headers)):
            cell = table.cell(r_idx, c_idx)
            cell.element.set("borderFillIDRef", str(solid_id))
            pre._replace_cell_with_styled(
                doc,
                cell,
                row[c_idx] if c_idx < len(row) else "",
                size=pre.SIZE_TABLE_BODY,
                align="CENTER",
                line_spacing=pre.TABLE_LINE_SPACING_PERCENT,
            )

    if caption:
        pre.add_para(
            doc,
            caption,
            base_size=pre.SIZE_CAPTION,
            align="CENTER",
            space_after=pre.SPACE_BODY,
        )


def build_header(doc, content):
    title = content.get("title") or content.get("title_en") or content.get("title_kr") or "물리 결과보고서"
    pre.add_para(
        doc,
        f"실험 주제 : {title}",
        base_size=pre.SIZE_TITLE,
        bold=True,
        space_after=pre.SPACE_HEADING_LV1,
    )


def add_photo_blocks(doc, photo_indices, photos, fig_counter, caption_prefix):
    for idx in as_list(photo_indices):
        try:
            photo = photos[int(idx)]
        except Exception:
            continue
        blob = decode_base64(photo.get("data_base64"))
        fmt = image_format(photo.get("name"), photo.get("mimetype"), blob)
        fig_counter["value"] += 1
        caption = f"[그림 {fig_counter['value']}] {caption_prefix or '실험 사진'}"
        add_picture(doc, blob, fmt=fmt, caption=caption)


def build_chart(doc, chart, fig_counter):
    if not chart:
        return
    blob = decode_base64(chart.get("png_base64"))
    title = clean_label(chart.get("title") or "그래프")
    caption_text = clean_label(chart.get("caption") or "")
    if not blob:
        pre.add_para(doc, f"[그래프] {title} - 렌더 실패", base_size=pre.SIZE_CAPTION)
        return

    fig_counter["value"] += 1
    caption = f"[그림 {fig_counter['value']}] {title}"
    if caption_text:
        caption += f" - {caption_text}"
    add_picture(
        doc,
        blob,
        fmt="png",
        caption=caption,
        max_width=MAX_CHART_WIDTH,
        max_height=MAX_CHART_HEIGHT,
    )


def build_results(doc, content):
    photos = as_list(content.get("__photos"))
    fig_counter = {"value": 0}
    table_counter = {"value": 0}

    pre.add_heading(
        doc,
        "1. 실험 결과",
        size=pre.SIZE_TITLE,
        space_before=pre.SPACE_HEADING_LV1,
        space_after=pre.SPACE_HEADING_LV2,
    )

    setup = content.get("experiment_setup") or {}
    pre.add_heading(doc, "1.1 실험 장치 및 세팅", size=pre.SIZE_HEADING, space_after=pre.SPACE_BODY)
    if setup.get("description"):
        pre.add_para(doc, setup.get("description"), indent_left=pre.INDENT_5MM)
    add_photo_blocks(doc, setup.get("photo_indices"), photos, fig_counter, "실험 장치")

    for idx, exp in enumerate(as_list(content.get("experiments")), 1):
        subnum = f"1.{idx + 1}"
        title = exp.get("name") or f"실험 {idx}"
        pre.add_heading(
            doc,
            f"{subnum} {title}",
            size=pre.SIZE_HEADING,
            space_before=pre.SPACE_HEADING_LV2,
            space_after=pre.SPACE_BODY,
        )
        if exp.get("method_summary"):
            pre.add_para(doc, f"방법: {exp.get('method_summary')}", indent_left=pre.INDENT_5MM)

        table = exp.get("data_table") or {}
        if table.get("headers") and isinstance(table.get("rows"), list):
            table_counter["value"] += 1
            pre.add_para(
                doc,
                f"[표 {table_counter['value']}] 측정 데이터",
                base_size=pre.SIZE_CAPTION,
                indent_left=pre.INDENT_5MM,
                space_after=220,
            )
            add_table(doc, table.get("headers"), table.get("rows"))

        build_chart(doc, exp.get("chart"), fig_counter)

        if exp.get("analysis"):
            pre.add_para(doc, f"분석: {exp.get('analysis')}", indent_left=pre.INDENT_5MM)

        add_photo_blocks(doc, exp.get("photo_indices"), photos, fig_counter, title)


def add_conclusion_block(doc, label, value):
    if not value:
        return
    pre.add_para(doc, label, base_size=pre.SIZE_HEADING, bold=True, space_after=240)
    if isinstance(value, list):
        for item in value:
            pre.add_para(doc, str(item), space_after=360)
    else:
        pre.add_para(doc, str(value), space_after=360)


def build_conclusion(doc, content):
    pre.add_heading(
        doc,
        "2. 결론",
        size=pre.SIZE_TITLE,
        space_before=pre.SPACE_HEADING_LV1,
        space_after=pre.SPACE_HEADING_LV2,
    )
    conclusion = content.get("conclusion") or {}
    if conclusion.get("objective_recap"):
        pre.add_para(doc, conclusion.get("objective_recap"), space_after=pre.SPACE_BODY)

    add_conclusion_block(doc, "▶ 결과 요약", conclusion.get("result_summary"))
    add_conclusion_block(doc, "▶ 오차 분석", conclusion.get("error_analysis"))
    add_conclusion_block(doc, "▶ 문제 인식 및 해결", conclusion.get("problem_solving"))
    add_conclusion_block(
        doc,
        "▶ 물리적 고찰",
        conclusion.get("physical_meaning") or conclusion.get("theory_connection"),
    )


def collect_preview_text(content):
    lines = [f"실험 주제 : {content.get('title') or '물리 결과보고서'}", "", "1. 실험 결과"]
    setup = content.get("experiment_setup") or {}
    if setup.get("description"):
        lines.append(setup.get("description"))
    for idx, exp in enumerate(as_list(content.get("experiments")), 1):
        lines.append(f"1.{idx + 1} {exp.get('name') or f'실험 {idx}'}")
        if exp.get("method_summary"):
            lines.append(f"방법: {exp.get('method_summary')}")
        table = exp.get("data_table") or {}
        if table.get("headers"):
            lines.append("[표] " + " / ".join(str(x) for x in table.get("headers", [])))
        if exp.get("analysis"):
            lines.append(f"분석: {exp.get('analysis')}")
    lines.extend(["", "2. 결론"])
    conclusion = content.get("conclusion") or {}
    for key in ("objective_recap", "result_summary", "error_analysis", "problem_solving", "physical_meaning", "theory_connection"):
        value = conclusion.get(key)
        if isinstance(value, list):
            lines.extend(str(x) for x in value if x)
        elif value:
            lines.append(str(value))
    return "\r\n".join(lines).strip()[:8000] + "\r\n"


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


def generate_hwpx(content):
    doc = load_template_doc()
    using_template = doc is not None
    if using_template:
        clear_template_body(doc)
        fill_template_title(doc, content)
    else:
        doc = HwpxDocument.new()
        apply_phys_page_layout(doc)
        pre.apply_default_font(
            doc,
            pre.normalize_font_face(content.get("font_face") or content.get("__fontFace")),
        )
        build_header(doc, content)
    build_results(doc, content)
    build_conclusion(doc, content)
    if not using_template:
        add_phys_page_number_to_footer(doc)
    return doc


def main():
    if len(sys.argv) >= 2 and sys.argv[1] != "-":
        content = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        content = json.loads(sys.stdin.read())

    doc = generate_hwpx(content)

    if len(sys.argv) >= 3:
        target = Path(sys.argv[2])
        doc.save_to_path(str(target))
        pre._postprocess_equations(target)
        update_preview_text(target, collect_preview_text(content))
    else:
        import os
        with tempfile.NamedTemporaryFile(suffix=".hwpx", delete=False) as tf:
            tmp_path = Path(tf.name)
        try:
            doc.save_to_path(str(tmp_path))
            pre._postprocess_equations(tmp_path)
            update_preview_text(tmp_path, collect_preview_text(content))
            sys.stdout.buffer.write(tmp_path.read_bytes())
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
