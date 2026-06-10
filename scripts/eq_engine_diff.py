# -*- coding: utf-8 -*-
"""
수식 엔진 골든셋 비교 도구 — builtin(LatexToHwpConverter) vs hwip(vendor).

보고서 도메인(화학/물리/수학 급수)의 대표 LaTeX 들을 **실제 파이프라인 경로**
(placeholder_to_script = 엔진 변환 + normalize_hwp_script)로 두 번 돌려 비교한다.
hwip 통합의 회귀 검증용. 출력 끝에 요약(변환 성공률/금지 패턴 검사)을 찍는다.

실행:
  .venv/bin/python3 scripts/eq_engine_diff.py          # 비교표 + 검사
  .venv/bin/python3 scripts/eq_engine_diff.py --quiet  # 검사 결과만
"""
import os
import sys
import importlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lib", "equation"))

# 도메인별 골든셋 — 실제 보고서(화학 사전/결과, 물리 결과/수행, 수학 급수)에서
# 나오는 형태를 대표한다. 새 유형의 수식 문제가 발견되면 여기에 추가할 것.
GOLDEN = [
    # ── 물리 ──
    r"I_{pivot} = \frac{mgdT^2}{4\pi^2}",
    r"T = 2\pi\sqrt{\frac{L}{g}}",
    r"\omega = \sqrt{\frac{k}{m}}",
    r"\vec{F} = m\vec{a}",
    r"\vec{A} \cdot \vec{B} = AB\cos\theta",
    r"\vec{A} \times \vec{B}",
    r"E = \frac{1}{2}mv^2 + \frac{1}{2}I\omega^2",
    r"\sum_{i=1}^{N} m_i r_i^2",
    r"v = v_0 + at, \quad x = x_0 + v_0 t + \frac{1}{2}at^2",
    r"\left( \frac{\partial V}{\partial T} \right)_P",
    r"\sin^2\theta + \cos^2\theta = 1",
    r"\Delta x = \frac{\lambda L}{d}",
    r"F = G\frac{m_1 m_2}{r^2}",
    r"\eta = \frac{W_{out}}{Q_{in}} \times 100\%",
    # ── 화학 ──
    r"\Delta G = \Delta H - T\Delta S",
    r"K_a = \frac{[H^+][A^-]}{[HA]}",
    r"pH = -\log[H^+]",
    r"[H^+] = \sqrt{K_a C}",
    r"k = A e^{-\frac{E_a}{RT}}",
    r"\ln \frac{P_2}{P_1} = -\frac{\Delta H_{vap}}{R} \left( \frac{1}{T_2} - \frac{1}{T_1} \right)",
    r"PV = nRT",
    r"M = \frac{w}{V} \times \frac{1000}{M_w}",
    r"\text{수득률} = \frac{\text{실제 수득량}}{\text{이론 수득량}} \times 100\%",
    r"q = mc\Delta T",
    r"\Delta T_b = K_b \cdot m",
    # ── 수학(급수 탐구) ──
    r"\sum_{n=1}^{\infty} ar^{n-1} = \frac{a}{1-r} \quad (|r| < 1)",
    r"\lim_{n \to \infty} \left| \frac{a_{n+1}}{a_n} \right| = L",
    r"S_n = \frac{a(1-r^n)}{1-r}",
    r"\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}",
    r"e = \sum_{n=0}^{\infty} \frac{1}{n!}",
    r"\int_0^1 x^2 \, dx = \frac{1}{3}",
    r"\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e",
    r"a_n = a_1 + (n-1)d",
    # ── 까다로운 케이스 ──
    r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}",
    r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
    r"f(x) = \begin{cases} x^2 & (x \ge 0) \\ -x & (x < 0) \end{cases}",
    r"\frac{\frac{1}{a} + \frac{1}{b}}{\frac{1}{c}}",
    r"\hat{x} + \tilde{y} + \bar{z} + \dot{q}",
    r"90\% \pm 0.5\%",
    r"\text{평균속도} = \frac{\Delta x}{\Delta t}",
]

# 최종 스크립트에 절대 남으면 안 되는 패턴(원시 LaTeX 잔재/마커 잔재 신호).
# 중첩 중괄호 {{ }} 는 정상 스크립트(sqrt {{L} over {g}})에 나오므로 검사하지 않는다.
FORBIDDEN = [
    r"\frac", r"\sqrt", r"\left", r"\right", r"\begin", r"\end",
    r"\sum", r"\lim", r"\int", r"\text", "{{EQ", "{{EQN",
]
# 키워드가 화학식 압축에 붙어 파손된 신호(예: TDELTAS, TDelta, HLEFT)
GLUED_KEYWORD = [
    "DELTA", "Delta", "SIGMA", "Sigma", "Omega", "Theta", "Lambda", "LEFT", "RIGHT",
]


def run(quiet=False):
    import hwpx_equation_tool as eq

    def convert_with(engine):
        os.environ["EQUATION_ENGINE"] = engine
        importlib.reload(eq)
        out = []
        if engine == "hwip":
            eq.hwip_convert_batch(GOLDEN)  # 프리워밍 경로도 함께 검증
        for tex in GOLDEN:
            try:
                out.append(eq.placeholder_to_script("EQ-LATEX", tex))
            except Exception as exc:
                out.append(f"(ERROR {exc})")
        return out, eq

    builtin_out, _ = convert_with("builtin")
    hwip_out, eq_mod = convert_with("hwip")
    hwip_used = eq_mod.hwip_engine_enabled() and len(eq_mod._hwip_cache) > 0

    diff_count = 0
    problems = []
    for i, tex in enumerate(GOLDEN):
        b, h = builtin_out[i], hwip_out[i]
        differs = b != h
        diff_count += differs
        for bad in FORBIDDEN:
            if bad in h:
                problems.append(f"#{i+1} hwip 출력에 금지 패턴 {bad!r}: {h[:120]}")
            if bad in b:
                problems.append(f"#{i+1} builtin 출력에 금지 패턴 {bad!r}: {b[:120]}")
        for kw in GLUED_KEYWORD:
            import re as _re
            if _re.search(rf"[A-Za-z0-9\}}]{kw}\b", h):
                problems.append(f"#{i+1} hwip 출력에 키워드 붙음({kw}): {h[:120]}")
        if not quiet:
            mark = "≠" if differs else "="
            print(f"── {i+1}. {tex}")
            print(f"   [builtin] {b}")
            if differs:
                print(f"   [hwip   ] {h}")
            else:
                print(f"   [hwip   ] (동일)")
            print()

    fell_back = sum(1 for t in GOLDEN if t.strip() in eq_mod._hwip_failed)
    print("──── 요약 ────")
    print(f"골든셋 {len(GOLDEN)}개 | hwip 엔진 사용: {hwip_used} | builtin과 다른 출력: {diff_count}개 | hwip 변환실패→폴백: {fell_back}개")
    if problems:
        print(f"⚠ 검사 실패 {len(problems)}건:")
        for p in problems:
            print("  -", p)
        return 1
    print("✓ 금지 패턴/키워드 파손 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(run(quiet="--quiet" in sys.argv))
