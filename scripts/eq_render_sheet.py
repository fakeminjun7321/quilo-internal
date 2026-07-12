# -*- coding: utf-8 -*-
"""한컴 실측 렌더 시트 생성기 — 수식 검증 체계의 마지막(사람 눈) 단계.

자동 검증(eq_engine_diff·eq_corpus_mine·eq_fuzz)은 스크립트 문자열까지만
보장한다. '한컴이 실제로 어떻게 그리는가'(tint 미렌더 사고류)는 실측만이
답이므로, 골든셋 + 실전 코퍼스 + 의심 키워드 프로브 전체를 번호·원문과
함께 한 HWPX 로 뽑아 macOS 한글/Windows 한컴에서 한 번에 훑게 한다.

확인 절차는 docs/hwp-equation-quirks.md 참고. 실측 결과는
lib/equation/hwp_script_parser.py 의 SAFE/SUSPECT 동의어 표에 반영한다.

실행:
  .venv/bin/python3 scripts/eq_render_sheet.py [출력.hwpx]
  (기본 출력: tmp/eq-render-sheet.hwpx)
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lib", "equation"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hwpx_equation_tool as eq  # noqa: E402
from eq_engine_diff import GOLDEN  # noqa: E402
import eq_corpus_mine  # noqa: E402

from hwpx.document import HwpxDocument  # noqa: E402  (.venv python-hwpx)

# 의심 키워드 프로브 — 두 표기가 같은 글리프로 그려지는지 눈으로 판정한다.
# (라벨, {{EQ:}} 원시 스크립트). '~' 는 한컴 수식의 일반 공백.
PROBES = [
    ("무한대 — INF(빌트인)와 inf(hwip) 둘 다 ∞ 인가", "INF ~ ~ inf"),
    ("원소 — IN(빌트인)과 in(hwip) 둘 다 ∈ 인가", "x IN A ~ ~ x in A"),
    ("겹줄 오른화살표 — =>(구표기)와 RARROW 둘 다 ⇒ 인가", "p => q ~ ~ p RARROW q"),
    ("겹줄 왼/양방향 — LARROW(⇐)·LRARROW(⇔) 정상인가", "p LARROW q ~ ~ p LRARROW q"),
    ("존재 기호 — exist(hwip)와 exists(빌트인) 둘 다 ∃ 인가", "exist x ~ ~ exists x"),
    ("합집합 — union(hwip)과 cup(빌트인) 둘 다 ∪ 인가", "A union B ~ ~ A cup B"),
    ("교집합 — inter(hwip)와 cap(빌트인) 둘 다 ∩ 인가", "A inter B ~ ~ A cap B"),
    ("대문자 그리스 두 표기 — DELTA 와 Delta 둘 다 Δ 인가", "DELTA G ~ ~ Delta G"),
    ("희귀 대문자 그리스(hwip 표기) — 글자 그대로 나오면 안 됨", "Alpha ~ Beta ~ Rho"),
    ("n제곱근 — ∛8 로 그려지는가", "2 root 3 of {8}"),
    ("노름 — ‖x‖ 로 그려지는가", "VERT x VERT"),
]

_LABEL_SWAP = str.maketrans({"\\": "＼", "{": "｛", "}": "｝", "^": "＾", "_": "＿"})


def _safe_label(text: str) -> str:
    """원문 표기를 검증기(raw LaTeX/스크립트 잔재 검출)에 안 걸리는 전각
    문자로 바꿔 평문 라벨로 남긴다 — 시트를 보는 사람이 원문을 알아야
    어긋난 렌더를 신고할 수 있다."""
    return text.translate(_LABEL_SWAP)


def build(out_path: str) -> None:
    doc = HwpxDocument.new()
    doc.add_paragraph("Quilo 수식 렌더 시트 — 한컴(한글) 실측 확인용")
    doc.add_paragraph(
        "각 항목: 회색 라벨(원문, 전각 치환) 다음 줄이 실제 수식 객체다. "
        "글자 그대로 노출·어긋난 기호·빈 박스를 발견하면 번호를 기록할 것."
    )

    doc.add_paragraph("")
    doc.add_paragraph("[S1] 의심 키워드 프로브 — 두 표기가 같은 기호인지 판정")
    for i, (label, script) in enumerate(PROBES, 1):
        doc.add_paragraph(f"S1-{i}. {label}")
        doc.add_paragraph("{{EQ:" + script + "}}")

    doc.add_paragraph("")
    doc.add_paragraph("[S2] 골든셋 — scripts/eq_engine_diff.py 의 전체 케이스")
    for i, tex in enumerate(GOLDEN, 1):
        doc.add_paragraph(f"S2-{i}. {_safe_label(tex)}")
        doc.add_paragraph("{{EQ-LATEX:" + tex + "}}")

    corpus, _n = eq_corpus_mine.collect(
        [os.path.join(ROOT, "tmp", "eval"), os.path.join(ROOT, "tmp", "eval2")], eq
    )
    latex_items = sorted({b for k, b in corpus if k == "EQ-LATEX"})
    raw_items = sorted({b for k, b in corpus if k == "EQ"})
    doc.add_paragraph("")
    doc.add_paragraph("[S3] 실전 코퍼스 — 실제 생성 산출물에서 추출")
    n = 0
    for tex in latex_items:
        n += 1
        doc.add_paragraph(f"S3-{n}. {_safe_label(tex)}")
        doc.add_paragraph("{{EQ-LATEX:" + tex + "}}")
    for body in raw_items:
        n += 1
        doc.add_paragraph(f"S3-{n}. {_safe_label(body)}")
        doc.add_paragraph("{{EQ:" + body + "}}")

    with tempfile.TemporaryDirectory(prefix="quilo-eq-sheet-") as temp:
        marked = Path(temp) / "marked.hwpx"
        doc.save(marked)
        count = eq.replace_equation_placeholders(marked, Path(out_path))
    issues = eq.validate_hwpx_equations(Path(out_path))
    if issues:
        print(f"⚠ 시트 검증 실패 {len(issues)}건:")
        for msg in issues[:10]:
            print("  -", msg)
        raise SystemExit(1)
    total = len(PROBES) + len(GOLDEN) + len(latex_items) + len(raw_items)
    print(f"✓ 렌더 시트 생성: {out_path} (수식 {count}개 / 항목 {total}건, 검증 통과)")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tmp", "eq-render-sheet.hwpx")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(out)
