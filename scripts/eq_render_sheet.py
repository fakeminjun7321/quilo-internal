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

# 프로브(2라운드, 2026-07-12 1차 실측 반영) — 이번 수정의 렌더 검증 +
# 아직 미확정인 형태 판정. (라벨, {{EQ:}} 원시 스크립트). '~' 는 일반 공백.
# 1차 실측 확정분(INF/inf·IN/in·exist/exists·union/cup·inter/cap·DELTA/
# Delta 동일, => 는 ⇒ 아님, root…of 파손, sup 증발, lnot 파손, \{ 증발)은
# docs/hwp-equation-quirks.md 의 결과 표에 기록되어 있다.
PROBES = [
    ("n제곱근 정규형 — 2·∛8 로 그려지는가(3 이 2 의 지수로 붙으면 안 됨)",
     "2 {}^{3} sqrt {8}"),
    ("n제곱근 대조군 — 빈 밑 없는 ^{3} 은 2³√8 로 붙는 것이 맞는지 확인",
     "2^{3} sqrt {8}"),
    ("집합 중괄호(인용 리터럴) — {x|x>0} 으로 중괄호가 보이는가",
     '"{" x | x > 0 "}"'),
    ("집합 중괄호(스트레치 대안) — LEFT{ RIGHT} 도 중괄호가 보이는가",
     "LEFT{ x | x > 0 RIGHT}"),
    ("부정 기호 — ¬p 로 그려지는가", "¬ p"),
    ("부정 대조군 — not 키워드는 어떻게 그려지는가", "not p"),
    ("상한/하한 교정형 — 업라이트 sup/inf + 첨자가 정상인가",
     '"sup"_{n >= 1} a_{n} ~ ~ "inf"_{n} b_{n}'),
    ("희귀 함수 키워드 — 글자 노출/증발 없이 나오는가",
     "det A ~ gcd (a,b) ~ arg z ~ deg f"),
    ("겹브레이스 A형(hwip 현행, 1차에서 증발) — 다시 확인",
     "OVERBRACE {n} {a+b} ~ ~ UNDERBRACE {m} {c+d}"),
    ("겹브레이스 B형(빌트인 구형) — 위 라벨 붙은 브레이스가 그려지는가",
     "OVERBRACE {a+b}^{n} ~ ~ UNDERBRACE {c+d}_{m}"),
    ("겹브레이스 C형(단일 인자) — 브레이스만이라도 그려지는가",
     "OVERBRACE {a+b}"),
    # ⇌(U+21CC)는 normalize 가 <-> 로 치환하므로, 치환 표 밖의 자매 글리프
    # ⇋(U+21CB)로 '알몸 하픈 글리프가 렌더되는가'를 판정한다. 되면 ⇌ 를
    # 글리프 그대로 살리는 개선(화학 평형 표기)으로 전환할 수 있다.
    ("평형 화살표 후보 — 하픈 글리프(⇋)가 그대로 보이는가", "A ⇋ B"),
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
