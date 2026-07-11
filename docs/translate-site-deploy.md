# PDF 통번역 독립 사이트 배포 가이드

메인 보고서 사이트(`server.js`)와 **같은 repo·별도 Render 서비스**로 돌아가는
PDF 통번역 전용 사이트다. 메인 사이트 코드는 건드리지 않는다.

- 엔트리: `translate-server.js` (start: `node translate-server.js` 또는 `npm run start:translate`)
- UI: `public/translate-app.html`
- 엔진: `lib/pipelines/pdf-translate/*` 를 메인과 **공유**(단일 소스)
- 접근: 비밀번호/초대코드(`TRANSLATE_ACCESS_CODES`)

## Render에 새 서비스 만들기

1. Render → **New +** → **Web Service** → 이 repo 선택(메인과 같은 repo).
2. 설정:
   - **Build Command**: `npm install`
     (postinstall이 메인과 동일하게 python venv + PyMuPDF + Tectonic + pandoc 설치 — 재조판/OCR에 필요)
   - **Start Command**: `node translate-server.js`
   - **Instance Type**: 메인과 동일 이상(PyMuPDF/Tectonic 메모리 때문에 무료티어는 빠듯할 수 있음)
3. **Environment** 변수:

   | 키 | 값 | 필수 |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Claude 키 | ✅ |
   | `GPT_API_KEY` | OpenAI 키(= GPT 모델 쓸 때) | 선택 |
   | `MISTRAL_API_KEY` | strict OCR source evidence + 최종 의미·시각 독립 검토 키 | 스캔·숨은 OCR·깨진 텍스트 PDF 처리 시 ✅ |
   | `TRANSLATE_ACCESS_CODES` | `code1,code2` (쉼표구분 초대코드) | ✅(프로덕션) |
   | `TRANSLATE_SESSION_SECRET` | 쿠키 서명용 랜덤 문자열 | 권장 |
   | `NODE_ENV` | `production` | 권장 |
   | `PORT` | (Render가 자동 주입) | — |

   > `TRANSLATE_ACCESS_CODES` 미설정 + `NODE_ENV=production` 이면 **모든 접근이 차단**된다(안전 기본값). 로컬도 코드 없이 열려면 `TRANSLATE_ALLOW_OPEN_DEV=1`을 명시해야 한다.

   > strict OCR은 `MISTRAL_API_KEY`가 없을 때 기존 비전 OCR로 조용히 폴백하지 않는다.
   > 저신뢰 숫자·단위·URL·수식은 OCR 원문 확정 전의 별도 visual adjudicator가
   > 확인해야 하며, 현재 독립 배포 서버에는 이 adjudicator가 구성되어 있지
   > 않으므로 해당 문서는 fail-closed로 중단된다. 최종 source/output 시각 검토는
   > 별도로 내장되어 있다.

4. 배포 후 사이트 접속 → 초대코드 입력 → PDF 업로드 → 번역.

## 튜닝 환경변수(선택, 메인과 공유)

`PDF_TRANSLATE_TIMEOUT_MS`(기본 20분), `PDF_TRANSLATE_MAX_PAGES`(80),
`PDF_OCR_MAX_PAGES`(30), `PDF_AUTO_MATH_THRESHOLD`(12),
`PDF_RETYPESET_CHUNK_PAGES`(5), `PDF_TRANSLATE_CONCURRENCY`,
`PDF_RETYPESET_CONCURRENCY`, `PDF_TRANSLATE_MODEL`(기본 모델),
`PDF_TRANSLATE_MIN_FONT_PT`(기본 6pt, `0`이면 최소 글꼴 검증 비활성화),
`PDF_OCR_SEMANTIC_JUDGE_MODEL`, `PDF_OCR_SEMANTIC_BATCH_PAGES`(기본 8),
`PDF_OCR_VISUAL_JUDGE_MODEL`(기본 `mistral-medium-3-5`),
`PDF_OCR_VISUAL_BATCH_PAGES`(기본 1), `PDF_OCR_VISUAL_MAX_IMAGES`(최대 60),
`PDF_OCR_VISUAL_MAX_RAW_IMAGE_BYTES`(하드 상한 32MiB).

## 도메인

Render 서비스에 커스텀 도메인 연결 가능(서비스 → Settings → Custom Domains).

## 로컬 점검

```bash
# 게이트 없이(개발):
TRANSLATE_ALLOW_OPEN_DEV=1 TRANSLATE_PORT=4100 node translate-server.js
# 코드 게이트:
NODE_ENV=production TRANSLATE_ACCESS_CODES=hunter2 TRANSLATE_PORT=4100 node translate-server.js
```

## 메인 사이트 영향

보고서 생성 파이프라인과 기존 `node server.js` 시작 방식은 그대로다. 다만
PDF 통번역 엔진(`lib/pipelines/pdf-translate/`)과 최종 검증 오케스트레이션은
독립 사이트와 메인 사이트가 공유한다. 따라서 OCR·재조판·postflight 정책을
변경하면 `translate-server.js`와 `server.js`의 PDF 통번역 경로에 모두 반영된다.
