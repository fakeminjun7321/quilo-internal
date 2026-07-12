# 한컴 수식 렌더러 특이사항(quirks)과 실측 절차

수식 엔진(빌트인 `LatexToHwpConverter` + vendored hwip)의 자동 검증은
스크립트 문자열까지만 보장한다. "한컴이 실제로 어떻게 그리는가"는 실측만이
답이다 — 이 문서는 실측으로 확정된 렌더러 특이사항과, 남은 미확정 항목을
확인하는 절차를 기록한다. 새 특이사항을 발견하면 여기에 추가하고, 대응
코드는 `lib/equation/hwpx_equation_tool.py`(변환)와
`lib/equation/hwp_script_parser.py`(검증 어휘/동의어 표)에 반영한다.

## 확정된 특이사항 (실측 근거)

- **`tint`/`dint`/`qint` 본문 미렌더** (2026-06-15 실측): 수식 편집기에선
  ∭로 보이지만 한글 '본문' 렌더러는 글자 그대로 노출한다. →
  `normalize_hwp_script()`가 `int` 반복(∫∫∫)으로 치환.
- **`oiint`는 한컴 비키워드**: 글자 노출. → 진입 전 `\oint` 정규화.
- **키워드는 대소문자 구분**: 원소 In(인듐)·Ta(탄탈럼)은 키워드 IN·Tau 와
  충돌하지 않는다. 반대로 같은 글자라도 케이스가 다르면 다른 의미일 수
  있다(delta δ vs DELTA Δ).
- **비인용 다글자 런은 그리디 렉싱으로 쪼개진다**: `I_{pivot}` 처럼 키워드
  (`pi`)를 품은 런은 πvot 로 깨진다. → 텍스트 첨자는 반드시 인용
  (`I_{"pivot"}`). `hwp_script_parser.lint_hancom_lexing()`이 위험을 검출.
- **hwip 의 n제곱근 표기 `^{n} sqrt {x}` 는 선행 항에 결합**:
  `2\sqrt[3]{8}` → `2^{3} sqrt {8}` = 2³√8 로 렌더(구조 동치성 검사로 발견,
  2026-07-12). → `\sqrt[` 포함 식은 hwip 을 우회하고 빌트인(`root n of`) 사용.
- **슬래시 분수화와 구조 키워드의 상호작용**: `X / \left(...\right)` 가
  `{X} over {LEFT}` 로, `X / \int...` 가 적분 기호만 분모로 삼키는 파손
  (퍼저로 발견, 2026-07-12). → LEFT 통짜 factor 인식 + 구조 키워드 피연산자
  차단 + 1인자 키워드(sqrt/vec…) 인자 오분리 방지.

## 미확정(의심) 항목 — 렌더 시트 S1 프로브로 판정

자동 검증은 아래 쌍을 '동치로 추정'하고 통과시키되 suspect 로 표시한다.
실측 후 `lib/equation/hwp_script_parser.py` 의 `_SAFE_SYNONYM_SETS` /
`_SUSPECT_SYNONYM_SETS` 를 갱신할 것. 한쪽 표기가 글자로 노출되면 그 표기를
내는 엔진 쪽을 고쳐야 한다(빌트인=COMMANDS 표, hwip=진입 전 정규화).

| 프로브 | 쌍 | 내는 쪽 | 기대 | 실측 결과 |
|---|---|---|---|---|
| S1-1 | `INF` / `inf` | 빌트인 / hwip | 둘 다 ∞ | (미기록) |
| S1-2 | `IN` / `in` | 빌트인 / hwip | 둘 다 ∈ | (미기록) |
| S1-3 | `=>` / `RARROW` | 구표기 / 현행 | 둘 다 ⇒ | (미기록) |
| S1-4 | `LARROW` / `LRARROW` | 양쪽 공통 | ⇐ / ⇔ | (미기록) |
| S1-5 | `exist` / `exists` | hwip / 빌트인 | 둘 다 ∃ | (미기록) |
| S1-6 | `union` / `cup` | hwip / 빌트인 | 둘 다 ∪ | (미기록) |
| S1-7 | `inter` / `cap` | hwip / 빌트인 | 둘 다 ∩ | (미기록) |
| S1-8 | `DELTA` / `Delta` | 빌트인 / hwip | 둘 다 Δ | (미기록) |
| S1-9 | `Alpha`·`Beta`·`Rho` | hwip | Α·Β·Ρ (글자 노출 금지) | (미기록) |
| S1-10 | `root 3 of` | 양쪽 공통 | ∛8 | (미기록) |
| S1-11 | `VERT` | 양쪽 공통 | ‖x‖ | (미기록) |

## 렌더 시트 실측 절차

1. 시트 생성 (의심 프로브 + 골든셋 전체 + 실전 코퍼스 = 한 문서):
   ```bash
   .venv/bin/python3 scripts/eq_render_sheet.py        # tmp/eq-render-sheet.hwpx
   ```
2. macOS 한글에서 열어 위에서 아래로 훑는다 (5–10분). 확인 포인트:
   - 영단어 글자 노출(`exists`, `lVert`, `intercal` 류)
   - 빈 박스/빈 분수 인자
   - 기호 어긋남(≤ 로 그려진 ⇐, 단줄로 격하된 ⇔ 등)
   - 라벨(전각 원문)과 수식 구조 불일치(분모/분자 뒤바뀜, 첨자 위치)
3. Windows 한컴에서도 릴리스마다 1회 반복(파일 열림 자체도 확인).
4. 발견 항목은 번호(S1-3 등)로 기록 → 위 표에 실측 결과 기입 →
   동의어 표/변환 표를 고치고 아래 게이트를 다시 돌린다.

## 수식 코드를 고친 뒤 돌리는 게이트

```bash
.venv/bin/python3 lib/equation/hwp_script_parser.py   # 파서 셀프테스트
.venv/bin/python3 scripts/eq_engine_diff.py --quiet   # 골든셋+구조 동치성+미러 동기화
.venv/bin/python3 scripts/eq_corpus_mine.py           # 실전 코퍼스 전량
.venv/bin/python3 scripts/eq_fuzz.py                  # 퍼저 400 (시드 고정)
.venv/bin/python3 scripts/eq_render_sheet.py          # 시트 재생성(자동 검증 포함)
node --test tests/pipelines/                          # 파이프라인 회귀 41
```

구조 불일치(struct)가 나오면: 어느 엔진이 틀렸는지 심사 → 엔진/정규화 수정이
원칙. 진짜 의도된 차이만 `scripts/eq_engine_diff.py` 의 `STRUCT_ALLOW` 에
사유와 함께 등록한다.
