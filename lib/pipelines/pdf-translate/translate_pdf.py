#!/usr/bin/env python3
"""PDF 통번역기 — 레이아웃/그림은 유지하고 텍스트만 교체한다.

DeepL 문서 번역과 같은 방식: 디지털 PDF(텍스트 레이어가 있는 PDF)에서 문단
단위로 텍스트를 추출하고, 같은 위치(bounding box)에 번역문을 다시 끼워넣는다.
그림·도표·벡터 그래픽은 손대지 않으므로 그대로 보존된다.

두 가지 모드로 동작한다 (Node가 두 번 spawn 한다):

  python translate_pdf.py extract <pdf_path>
      → stdout JSON: {"page_count": N, "scanned": bool,
                      "blocks": [{"id": int, "page": int, "text": str}, ...]}
      번역이 필요한 문단만 내보낸다. Node가 이걸 Claude로 번역한다.

  python translate_pdf.py render <pdf_path> <out_path> <font_path>
      ← stdin JSON: {"translations": {"<id>": "<korean text>", ...}}
      → out_path 에 번역된 PDF 저장
      → stdout JSON: {"ok": true, "replaced": int, "shrunk": int}

블록 id는 두 모드에서 동일한 순서로 매겨진다(같은 파일 → 같은 get_text 순서).
그래서 extract가 부여한 id를 render가 그대로 다시 계산해 매칭할 수 있다.
"""

import sys
import json
from collections import defaultdict

import fitz  # PyMuPDF


def iter_text_blocks(doc):
    """type=0(텍스트) 블록을 두 모드에서 동일한 순서/id로 순회한다.

    span 이 없는 빈 블록과 이미지 블록(type=1)은 건너뛰되, id 카운터는
    '텍스트 블록'에 대해서만 증가시켜 extract/render 간 id 가 일치하게 한다.
    """
    bid = 0
    for pno in range(len(doc)):
        page = doc[pno]
        data = page.get_text("dict")
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            lines = block.get("lines") or []
            if not any(ln.get("spans") for ln in lines):
                continue
            yield bid, pno, block
            bid += 1


def block_text(block):
    """블록 안의 줄들을 사람이 읽을 한 문단 문자열로 합친다.

    화면상 줄바꿈(wrap)은 공백으로 이어 붙인다 — 한 문장이 여러 줄에 걸쳐도
    번역은 한 단위로 처리해야 자연스럽기 때문이다.
    """
    lines = []
    for ln in block.get("lines", []):
        s = "".join(sp.get("text", "") for sp in ln.get("spans", []))
        if s.strip():
            lines.append(s.strip())
    return " ".join(lines).strip()


def dominant_size_color(block):
    """글자 수 기준으로 가장 많이 쓰인 폰트 크기와 색을 고른다.

    본문은 보통 단일 크기/색이고, 제목 블록은 그 블록의 크기를 따른다.
    """
    sizes = defaultdict(float)
    colors = defaultdict(float)
    for ln in block.get("lines", []):
        for sp in ln.get("spans", []):
            n = max(1, len(sp.get("text", "")))
            sizes[round(float(sp.get("size", 10.0)), 1)] += n
            colors[int(sp.get("color", 0))] += n
    size = max(sizes, key=sizes.get) if sizes else 10.0
    color = max(colors, key=colors.get) if colors else 0
    return size, color


def has_letters(s):
    """알파벳/한글 등 '글자'가 하나라도 있는지. 순수 숫자·기호 블록은 번역 제외."""
    return any(ch.isalpha() for ch in s)


def cmd_extract(pdf_path):
    doc = fitz.open(pdf_path)
    blocks = []
    total_text_chars = 0
    for bid, pno, block in iter_text_blocks(doc):
        text = block_text(block)
        if not text or not has_letters(text):
            continue
        total_text_chars += len(text)
        blocks.append({"id": bid, "page": pno, "text": text})
    # 텍스트가 거의 없으면 스캔본(글자가 이미지)일 가능성이 높다 → Node가 안내.
    scanned = len(doc) > 0 and total_text_chars < 20 * len(doc)
    out = {"page_count": len(doc), "scanned": scanned, "blocks": blocks}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    doc.close()


def _color01(c):
    if isinstance(c, (list, tuple)):
        return tuple(float(x) for x in c[:3])
    c = int(c)
    return (((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)


def _wrap(font, text, width, fs):
    """폰트 메트릭으로 직접 줄바꿈. 공백(어절) 기준, 한 어절이 줄폭보다 길면 글자 단위로 자른다."""
    lines = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split(" "):
            trial = word if not cur else cur + " " + word
            if font.text_length(trial, fontsize=fs) <= width:
                cur = trial
                continue
            if cur:
                lines.append(cur)
                cur = ""
            if font.text_length(word, fontsize=fs) <= width:
                cur = word
            else:  # 한 어절이 줄폭보다 길다 → 글자 단위 분해
                chunk = ""
                for ch in word:
                    if not chunk or font.text_length(chunk + ch, fontsize=fs) <= width:
                        chunk += ch
                    else:
                        lines.append(chunk)
                        chunk = ch
                cur = chunk
        if cur:
            lines.append(cur)
    return lines or [""]


def _fit(font, text, rect, start_size, min_size=4.0, line_factor=1.3):
    """rect 안에 들어가는 최대 폰트 크기와 줄바꿈 결과를 찾는다(넘치면 축소)."""
    width = max(rect.width - 2.0, 1.0)
    height = rect.height
    fs = max(min_size, min(float(start_size), 200.0))
    while fs >= min_size:
        lines = _wrap(font, text, width, fs)
        if len(lines) * fs * line_factor <= height:
            return fs, lines
        fs -= 0.5
    return min_size, _wrap(font, text, width, min_size)


def cmd_render(pdf_path, out_path, font_path):
    payload = json.loads(sys.stdin.read() or "{}")
    translations = payload.get("translations", {}) or {}

    doc = fitz.open(pdf_path)

    # 번역이 있는 블록만 (페이지별로) 모은다.
    by_page = defaultdict(list)
    for bid, pno, block in iter_text_blocks(doc):
        ko = translations.get(str(bid))
        if ko is None:
            ko = translations.get(bid)
        if not ko or not str(ko).strip():
            continue
        rect = fitz.Rect(block["bbox"])
        size, color = dominant_size_color(block)
        by_page[pno].append((rect, str(ko).strip(), size, color))

    # 측정용 폰트 1개만 로드(insert_htmlbox 는 호출마다 폰트를 Story 에 재적재해
    # 24쪽/수백 블록에서 메모리가 1GB+ 로 치솟아 512MB 서버를 OOM 시켰다).
    measure_font = fitz.Font(fontfile=font_path)
    FONTNAME = "kf"

    replaced = 0
    shrunk = 0
    for pno, items in by_page.items():
        page = doc[pno]
        # 1) 원문 글자만 지운다. images=NONE 으로 그림은 보존.
        for rect, _ko, _sz, _col in items:
            page.add_redact_annot(rect, fill=(1, 1, 1))
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
        # 2) 한글 폰트는 페이지당 한 번만 임베드.
        page.insert_font(fontname=FONTNAME, fontfile=font_path)
        # 3) 폰트 메트릭으로 미리 크기를 맞춰 한 번만 그린다(넘칠 때 다시 그리면
        #    글자가 겹치므로 사전 계산이 필수). 칸을 넘기면 폰트를 줄여 맞춘다.
        for rect, ko, size, color in items:
            fs, lines = _fit(measure_font, ko, rect, size)
            if fs < float(size) - 0.01:
                shrunk += 1
            page.insert_textbox(
                rect,
                "\n".join(lines),
                fontname=FONTNAME,
                fontsize=fs,
                color=_color01(color),
                align=0,
            )
            replaced += 1

    doc.save(out_path, garbage=3, deflate=True)
    doc.close()
    sys.stdout.write(json.dumps({"ok": True, "replaced": replaced, "shrunk": shrunk}))


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: translate_pdf.py extract|render ...\n")
        sys.exit(2)
    mode = sys.argv[1]
    try:
        if mode == "extract":
            cmd_extract(sys.argv[2])
        elif mode == "render":
            cmd_render(sys.argv[2], sys.argv[3], sys.argv[4])
        else:
            sys.stderr.write(f"unknown mode: {mode}\n")
            sys.exit(2)
    except Exception as e:  # noqa: BLE001 — Node 에 stderr 로 원인 전달
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
