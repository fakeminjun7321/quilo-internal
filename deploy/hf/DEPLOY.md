# Hugging Face Spaces (Docker) 배포

PDF 통번역 전용 독립 사이트를 HF Space(무료 Docker)로 올린다. 번역 엔진만 담은
경량 패키지(보고서 생성·예시·PII 제외)라 빌드가 가볍다.

## 1) 스테이징 생성
```bash
bash deploy/hf/build-staging.sh
# → tmp/hf-translate-staging/  (Dockerfile + 최소 런타임 파일)
```

## 2) HF Space 생성 (로그인 필요 — 본인이)
huggingface.co 로그인 → **New → Space** → SDK **Docker**, 이름 `pdf-translate`.
(Space 자체가 git repo다.)

## 3) 코드 push
```bash
cd tmp/hf-translate-staging
git init -b main && git add -A && git commit -m "deploy pdf-translate"
git remote add space https://huggingface.co/spaces/<USER>/pdf-translate
git push space main        # HF 토큰 인증(huggingface-cli login 또는 토큰)
```
> 폰트(.ttf)는 모두 10MB 미만이라 git-lfs 없이 그대로 push 된다.

## 4) Secrets (Space → Settings → Variables and secrets)
| 키 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude 키 (필수) |
| `MISTRAL_API_KEY` | Mistral OCR 4 키 (스캔·이미지 PDF strict OCR에 필수) |
| `GPT_API_KEY` | OpenAI 키 (GPT 모델용, 선택) |
| `TRANSLATE_ACCESS_CODES` | 초대코드 `code1,code2` (필수) |
| `TRANSLATE_SESSION_SECRET` | 랜덤 문자열 (권장) |

`PDF_TRANSLATE_LIBREOFFICE_ENABLED`는 기본적으로 설정하지 않는다. 현재 운영 검증 계약은
Tectonic/PyMuPDF 출력을 기준으로 하므로, LibreOffice reflow 전용 postflight가 배포된 뒤에만
Space 변수로 `1`을 설정한다.

## 5) 빌드 → 구동
HF 가 Dockerfile 로 빌드(첫 빌드 수 분) → 7860 포트로 구동. Space URL 접속 →
초대코드 입력 → PDF 번역. `NODE_ENV/PORT` 는 Dockerfile 에 이미 박혀 있음.

## 참고
- 무료 CPU Space: 2 vCPU·16GB RAM. 48시간 무접속 시 sleep(다음 접속 시 깨어남).
- 재조판(Tectonic)은 첫 컴파일 때 TeX 패키지를 받아 캐시(첫 실행 느릴 수 있음).
- 선택형 LibreOffice Writer 렌더러와 `pdf2docx`/`python-docx`는 Docker 이미지에 포함된다.
- LibreOffice 경로도 Tectonic 중간본을 사용하므로 Tectonic 설치·실행 확인 실패는 Docker 빌드 실패로 처리한다.
- 엔진(lib/pipelines/pdf-translate)은 메인 repo 와 동일 — 고치면 다시 build-staging→push.
