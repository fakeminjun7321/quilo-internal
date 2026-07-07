#!/usr/bin/env python3
"""PDF 통번역 출력 정밀 검증기.

번역/재조판 출력 PDF 를 페이지별로 훑어 '이상한 곳'을 체계적으로 찾아낸다.
표본 육안 확인이 아니라 전 페이지를 기계로 스캔한다. 비용 0(로컬 PyMuPDF)인 결정적
검사가 1차이고, 플래그된(의심) 페이지만 골라 비전으로 원문 대조하면 된다.

⚠재조판(LaTeX/Tectonic) 출력 전용으로 조율됨. LaTeX PDF 는 텍스트추출 시 위첨자가
납작해지고(16t^2 -> 16t2) 큰 괄호·적분 글리프가 PUA 로 빠진다 — 그건 '정상 렌더'이지
깨짐이 아니므로 오탐하지 않는다. 여기서 잡는 건 '출력에 실제로 남은 결함'뿐:

  1) raw 마커/명령 누출: %%FIG%%, \\includegraphics, ```, {{EQ...}}, 'Table N:' 자동라벨
  2) 깨진 수식 고유 서명: 대괄호가 숫자로 변한 구간표기([a,b]->3a, b4), ft>sec, x S 1 등
  3) 미번역 영어 산문: 괄호 밖(용어병기 아님) 영어 '문장'이 한국어 페이지에 통째로 남음
  4) 그림: 출력 임베드 이미지 수, 중복 이미지(같은 그림 반복 삽입)
  5) (원문 제공 시) 그림 수 참고치

사용:
  python3 verify_translation.py <translated.pdf> [--original <source.pdf>] [--json out.json]
"""
import sys
import os
import re
import json
import argparse
import hashlib

import fitz  # PyMuPDF


RAW_MARKERS = [
    (r"%%FIG:?\d*%%", "raw 그림 마커(%%FIG%%)"),
    (r"\\includegraphics", "raw \\includegraphics"),
    (r"\\begin\{|\\end\{", "raw LaTeX 환경"),
    (r"```", "코드펜스 ```"),
    (r"\{\{EQ[-:]|\{\{MATH:|\{\{FORMULA:", "raw 수식 마커 {{EQ}}"),
    (r"\bTable\s+\d+:", "표 자동라벨 'Table N:'"),
    (r"\bFigure\s+\d+:", "그림 자동라벨 'Figure N:'"),
]

# 깨진 수식 '고유 서명'만 — 정상형(16t2=16t^2)과 겹치지 않게 구간괄호 3..4 쌍을 요구.
GARBLED_MATH = [
    (r"\b3[A-Za-z]\d?\s*,\s*[A-Za-z0-9+\-\s]{1,14}\d4\b", "구간 괄호 깨짐([a,b]->3a, b4)"),
    (r"\bft>sec\b|\bft>s\b", "단위 슬래시 깨짐(ft>sec = ft/sec)"),
    (r"[A-Za-z]\s+S\s+\d(?![.)])", "화살표 깨짐(x S 1 = x arrow 1)"),
    (r"[0-9A-Za-z]\s?Ú\b", "부등호 깨짐(U-accent = >=)"),
]

ENGLISH_RUN = re.compile(r"(?:\b[A-Za-z][A-Za-z'’\-]+\b[ ,;:]+){5,}\b[A-Za-z][A-Za-z'’\-]+\b")
HANGUL = re.compile(r"[가-힣]")
ENGLISH_ALLOW = re.compile(
    r"https?://|www\.|goo\.gl|CC BY|LibreTexts|creativecommons|Copyright|ISBN"
    r"|Drosophila|Galileo|Fermat|Newton|Riemann|Coulomb|Theorem|Function|Value",
    re.I,
)


def _ctx(s, m, span=22):
    a = max(0, m.start() - span)
    b = min(len(s), m.end() + span)
    return s[a:b].replace("\n", " ")


def _in_parens(oneline, start):
    """이 영어가 '한국어(English)' 용어병기처럼 괄호 안이면 정상 → 미번역 아님."""
    lp = oneline.rfind("(", 0, start)
    rp = oneline.find(")", start)
    return lp != -1 and rp != -1 and (start - lp) < 90


def scan_page_text(text):
    issues = []
    oneline = " ".join(text.split())

    for pat, label in RAW_MARKERS:
        m = re.search(pat, text)
        if m:
            issues.append(("raw_marker", f"{label}: ...{_ctx(text, m)}..."))

    for pat, label in GARBLED_MATH:
        m = re.search(pat, oneline)
        if m:
            issues.append(("garbled", f"{label}: ...{_ctx(oneline, m)}..."))

    hg = len(HANGUL.findall(text))
    en = len(re.findall(r"[A-Za-z]", text))
    hits = []
    for m in ENGLISH_RUN.finditer(oneline):
        seg = m.group(0)
        if ENGLISH_ALLOW.search(seg) or _in_parens(oneline, m.start()):
            continue
        hits.append(seg)
    if hits and hg >= 40:
        issues.append(
            ("untranslated", f"영어 문장 {len(hits)}개 잔존(한글 {hg}/영문자 {en}): [{hits[0][:80]}]")
        )
    return issues


def image_hashes(page):
    out = []
    try:
        for im in page.get_images(full=True):
            xref = im[0]
            try:
                d = page.parent.extract_image(xref)
                out.append((xref, hashlib.md5(d["image"]).hexdigest()))
            except Exception:
                out.append((xref, None))
    except Exception:
        pass
    return out


def verify(translated_path, original_path=None):
    doc = fitz.open(translated_path)
    report = {
        "file": os.path.basename(translated_path),
        "pages": len(doc),
        "page_issues": [],
        "figures": {},
        "numbers": {},
        "summary": {},
    }
    counts = {"raw_marker": 0, "garbled": 0, "untranslated": 0}
    all_hashes = {}

    for pno in range(len(doc)):
        page = doc[pno]
        text = page.get_text("text") or ""
        issues = scan_page_text(text)
        for kind, _ in issues:
            counts[kind] = counts.get(kind, 0) + 1
        if issues:
            report["page_issues"].append({"page": pno + 1, "issues": issues})
        for xref, h in image_hashes(page):
            if h:
                all_hashes.setdefault(h, []).append(pno + 1)

    dups = {h: pgs for h, pgs in all_hashes.items() if len(pgs) >= 2}
    report["figures"]["embedded_unique_images"] = len(all_hashes)
    report["figures"]["duplicate_images"] = [
        {"pages": pgs, "count": len(pgs)} for pgs in dups.values()
    ]

    if original_path and os.path.exists(original_path):
        src = fitz.open(original_path)
        src_imgs = sum(len(p.get_images()) for p in src)
        report["figures"]["original_raw_image_count"] = src_imgs

    report["summary"] = {
        "pages_with_issues": len(report["page_issues"]),
        "raw_marker_pages": counts.get("raw_marker", 0),
        "garbled_pages": counts.get("garbled", 0),
        "untranslated_pages": counts.get("untranslated", 0),
        "duplicate_image_groups": len(dups),
    }
    doc.close()
    return report


def print_report(r):
    s = r["summary"]
    print(f"\n=== 검증: {r['file']} ({r['pages']}쪽) ===")
    print(
        f"  이슈 페이지: {s['pages_with_issues']} "
        f"(raw마커 {s['raw_marker_pages']} / 깨짐 {s['garbled_pages']} / "
        f"미번역 {s['untranslated_pages']})"
    )
    fg = r["figures"]
    line = f"  이미지: 임베드 고유 {fg.get('embedded_unique_images', 0)}개"
    if "original_raw_image_count" in fg:
        line += f" / 원문 래스터 {fg['original_raw_image_count']}개(참고)"
    line += f" / 중복그룹 {s['duplicate_image_groups']}개"
    print(line)
    for pi in r["page_issues"][:60]:
        print(f"  - p{pi['page']}:")
        for kind, detail in pi["issues"]:
            print(f"      [{kind}] {detail}")
    if len(r["page_issues"]) > 60:
        print(f"  ... 외 {len(r['page_issues']) - 60}개 페이지 더")
    flagged = sorted({pi["page"] for pi in r["page_issues"]})
    print(f"  * 비전 재검 후보 페이지: {flagged if flagged else '없음(깨끗)'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("translated")
    ap.add_argument("--original", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    r = verify(args.translated, args.original)
    print_report(r)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(r, f, ensure_ascii=False, indent=2)
        print(f"\nJSON 저장: {args.json}")
    sys.exit(1 if r["summary"]["pages_with_issues"] else 0)


if __name__ == "__main__":
    main()
