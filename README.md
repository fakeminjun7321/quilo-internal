# 보고서 작성 툴 (웹)

대구과학고 학생용 자동 보고서 생성 사이트. 보고서 종류별로 입력 폼이 다름.

**지원 보고서:**
- 🧪 **화학 사전보고서** — 매뉴얼 PDF만 올리면 사전보고서 `.docx` / `.hwpx` 자동 생성
- 🔬 **화학 결과보고서** — 사전보고서 + 엑셀 데이터 + 사진 → 표/차트/사진이 들어간 `.docx` / `.hwpx` 결과보고서
- ⚛️ **물리 결과보고서** — PASCO `.cap` 또는 엑셀/CSV + 사진 → 학교 양식 기반 `.docx` / `.hwpx` 결과보고서

**스택:**
- 백엔드: Node.js + Express
- AI: Claude API (Sonnet 4.6 또는 Opus 4.7 선택) + 웹 검색
- 데이터: xlsx (엑셀 파싱), chartjs-node-canvas (차트 PNG)
- 출력: HWP 호환 `.docx`, 한글오피스용 `.hwpx`
- HWPX: `python-hwpx` + `lxml` + 자체 수식/이미지 후처리 도구
- DB·인증: Supabase + 사용자별 비밀번호·예산

---

## 1. Render.com 배포 (무료)

### 1-1. GitHub에 코드 올리기

GitHub 가입 → 새 repo 생성 (예: `chem-pre-lab-web`, Private 권장).

이 폴더에서:

```bash
cd chem-pre-lab-web
git init
git add .
git commit -m "init"
git remote add origin https://github.com/<사용자명>/chem-pre-lab-web.git
git branch -M main
git push -u origin main
```

`.env` 파일은 `.gitignore`에 들어 있어서 자동으로 제외됨 (API 키 안전).

### 1-2. Render에서 Web Service 생성

1. https://render.com 가입 (GitHub 로그인 추천)
2. 대시보드 → **"New +"** → **"Web Service"**
3. GitHub 연동 → 위에서 만든 repo 선택
4. 설정 값:
   - **Name**: `chem-pre-lab` (URL이 `https://chem-pre-lab.onrender.com` 형태가 됨)
   - **Region**: Singapore (한국에서 가장 가까움)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. 같은 페이지 아래쪽 **Environment Variables** 항목에 다음 4개 추가:

   | Key | Value | 필수? |
   |-----|-------|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` (Anthropic 콘솔) | ✅ |
   | `SHARED_PASSWORD` | 친구들에게 알려줄 공용 비밀번호 | ✅ |
   | `SESSION_SECRET` | 32자 이상 랜덤 문자열 | ✅ |
   | `NODE_ENV` | `production` | ✅ |
   | `GEMINI_API_KEY` | Google AI Studio 키 (이미지 생성용, 아래 설명) | 🎨 그림 옵션 쓰려면 |
   | `GOOGLE_CSE_API_KEY` | Google Cloud Custom Search 키 | 🔎 이미지 검색 쓰려면 |
   | `GOOGLE_CSE_CX` | Custom Search Engine ID | 🔎 이미지 검색 쓰려면 |
   | `JOB_TIMEOUT_MS` | 작업 타임아웃 (기본 480000 = 8분) | 선택 |
   | `MAX_TOKENS` | 출력 토큰 상한 (기본 16000) | 선택 |

6. **Create Web Service** 클릭 → 첫 빌드 5분 정도

빌드 끝나면 화면 상단에 `https://chem-pre-lab.onrender.com` 링크가 보임. 그게 사이트 URL.

`npm install` 후 `postinstall`이 `.venv`를 만들고 HWPX 생성용 Python 패키지(`python-hwpx`, `lxml`)를 설치합니다. 이 단계가 실패해도 `.docx` 생성은 계속 동작하지만, `.hwpx` 출력은 비활성 또는 실패할 수 있습니다.

### 1-3. 친구들에게 공유

URL + 공용 비밀번호 알려주면 끝.

---

## 2. Anthropic API 키 발급

1. https://console.anthropic.com 가입
2. 좌측 메뉴 **"API Keys"** → **"Create Key"**
3. 키 이름 적당히 (예: `chem-pre-lab`) → 생성된 `sk-ant-...` 복사
4. 결제 수단 등록 (Settings → Billing) — 키만 발급해서는 호출 못 함, 크레딧 충전 필요

월 사용량 제한 두려면 콘솔의 **Limits** 메뉴에서 spend limit 설정.

---

## 2-1. (선택) 그림 자동 처리 옵션

체크박스 켜면 보고서에 필요한 그림을 **Google 이미지 검색 → 못 찾으면 Google AI Studio (Nano Banana)** 순서로 자동 처리합니다. 화학 그래프·구조도는 부정확할 수 있으니 실험적 기능으로 봐주세요.

### Gemini API 키 (Google AI Studio)

1. https://aistudio.google.com/apikey 접속 (Google 계정 로그인)
2. **Create API key** 클릭 → 프로젝트 선택/생성 → 키 발급
3. `GEMINI_API_KEY` 환경변수에 입력

비용: 이미지 1장당 약 **$0.04** (≈56원)

### Google Custom Search 설정 (이미지 검색용)

1. **Custom Search Engine 만들기**
   - https://programmablesearchengine.google.com/controlpanel/create 접속
   - **Sites to search**: `*.com` (또는 비워두고 "Search the entire web" 토글 ON)
   - **Search settings → Image search**: **ON**
   - 만들기 → 다음 화면에서 **Search engine ID** 복사 → `GOOGLE_CSE_CX`에 입력
2. **API 키 발급**
   - https://console.cloud.google.com/apis/credentials 접속
   - **+ Create Credentials → API key** → 키 복사 → `GOOGLE_CSE_API_KEY`에 입력
   - 같은 페이지의 **API 라이브러리**에서 "Custom Search API" 검색 → **Enable** 클릭

비용: 무료 100회/일, 이후 $5/1000회 (≈ 6.7원/회)

### 환경변수 조합별 동작

| GOOGLE_CSE_* | GEMINI_API_KEY | 동작 |
|---|---|---|
| ⭕ | ⭕ | 검색 → 못찾으면 AI 생성 |
| ❌ | ⭕ | 항상 AI 생성 |
| ⭕ | ❌ | 검색만, 못찾으면 placeholder |
| ❌ | ❌ | 항상 placeholder (체크박스 의미 없음) |

---

## 2-2. HWPX 한글파일 출력

각 보고서 폼에서 출력 형식을 `.docx` 또는 `.hwpx`로 선택할 수 있습니다. `.hwpx`를 선택하면 서버가 같은 보고서 JSON을 Python HWPX 생성기로 넘겨 한글오피스에서 바로 열 수 있는 파일을 만듭니다.

현재 구현 범위:

- 화학 사전보고서: 표지, 제목/본문 계층, 기구·시약 표, 그림 placeholder, 링크, 위첨자/아래첨자, 실제 HWPX 수식 개체 변환
- 화학 결과보고서: 실험 데이터 표, 차트 PNG, 업로드 사진, 참고문헌, 학생 정보 포함
- 물리 결과보고서: 학교 HWPX 템플릿 박스 안에 실험 결과/결론을 삽입하고 표·차트·사진 포함
- 글꼴: 맑은 고딕, 나눔명조, `.hwpx` 전용 함초롬바탕 선택 가능

상세 구현 정리는 [`docs/hwpx-output.md`](docs/hwpx-output.md)를 참고하세요.

---

## 3. 무료 플랜 한계 + Keepalive

### Render 무료
- **15분 비활성 후 sleep** — 첫 요청에 30초~1분 걸림
- **750 시간/월** — 한 달 풀로 켜둬도 가능 (한 달=720h)
- **메모리 512MB** — 충분
- **Anthropic API 비용은 별도** — 본인이 결제

### Supabase 무료
- **7일 무활동 시 자동 pause** — DB 죽으면 로그인 불가

### 해결: UptimeRobot keepalive (권장)
1. https://uptimerobot.com 무료 가입
2. **+ Add New Monitor** → HTTP(s)
3. URL: `https://chem-pre-lab-web.onrender.com/api/keepalive`
4. Interval: **5 minutes** (무료 최소)

→ Render sleep + Supabase pause 모두 방지.

---

## 4. 비용 감 잡기 (모델별·종류별)

| 모델 | 화학 사전 | 화학 결과 | 물리 결과 |
|------|---------|---------|---------|
| Sonnet 4.6 | ~$0.05 (₩70) | ~$0.10 (₩140) | ~$0.08 (₩110) |
| Opus 4.7 | ~$0.25 (₩350) | ~$0.50 (₩700) | ~$0.40 (₩560) |

대략적 추정. 정확한 값은 폼 제출 시 confirm dialog에 표시. 결과보고서가 더 비싼 이유는 사진(1500토큰/장) + 데이터 + 더 긴 출력.

---

## 5. 결과 스타일이나 한글파일이 마음에 안 들 때

각 보고서 종류의 시스템 프롬프트 파일을 GitHub repo에서 직접 수정 → push → Render가 자동 재빌드:

- 화학 사전: `lib/pipelines/chem-pre/prompt.md`
- 화학 결과: `lib/pipelines/chem-result/prompt.md`
- 물리 결과: `lib/pipelines/phys-result/prompt.md`

더 구체적인 지시 추가하면 즉시 반영. 예: "이론 섹션은 매 키워드마다 최소 5문단" / "수식은 별도 줄에 표기".

`.hwpx` 레이아웃 자체를 조정하려면 각 파이프라인의 HWPX 생성기를 수정합니다.

- 화학 사전: `lib/pipelines/chem-pre/hwpx-gen.py`
- 화학 결과: `lib/pipelines/chem-result/hwpx-gen.py`
- 물리 결과: `lib/pipelines/phys-result/hwpx-gen.py`
- 공통 수식 변환: `lib/equation/hwpx_equation_tool.py`

---

## 6. 폴더 구조

```
chem-pre-lab-web/
├── server.js                    # Express + PIPELINES 레지스트리
├── lib/
│   ├── parser.js                # 화학식 마커 (_{}, ^{}, *italic*) 공통
│   ├── pricing.js, supabase.js, rate-limit.js, exchange-rate.js, auth.js
│   ├── json-sanitize.js         # JSON 응답 안의 raw 제어문자 자동 escape
│   ├── output-sanitize.js       # 출력 전 텍스트/수식 placeholder 정리
│   ├── document-fonts.js        # docx/hwpx 글꼴 정규화
│   ├── equation/
│   │   └── hwpx_equation_tool.py # {{EQ:...}} → 실제 HWPX 수식 개체
│   └── pipelines/
│       ├── chem-pre/            # 화학 사전보고서
│       │   ├── prompt.md, generate.js
│       │   ├── docx-gen.js
│       │   └── hwpx-gen.js, hwpx-gen.py
│       ├── chem-result/         # 화학 결과보고서
│       │   ├── prompt.md, generate.js, docx-gen.js
│       │   ├── hwpx-gen.js, hwpx-gen.py
│       │   ├── excel-parser.js  # xlsx/csv → markdown table
│       │   └── chart-gen.js     # chart spec → PNG (chartjs-node-canvas)
│       └── phys-result/         # 물리 결과보고서
│           ├── prompt.md, generate.js, docx-gen.js
│           ├── hwpx-gen.js, hwpx-gen.py
│           ├── cap-parser.js
│           └── templates/result-report-template.hwpx
├── public/
│   ├── login.html, index.html, admin.html, style.css
├── docs/
│   └── hwpx-output.md
├── package.json
├── requirements.txt             # Render postinstall에서 설치되는 Python 의존성
├── .env.example                 # (배포 시에는 Render 환경변수 사용)
├── .gitignore
└── README.md
```

새 보고서 종류 추가하려면: `lib/pipelines/<type>/` 폴더에 `prompt.md`, `generate.js`, `docx-gen.js` 작성 + `server.js`의 `PIPELINES` 객체에 한 줄 등록.

---

## 7. 보안 메모

- 공용 비밀번호 1개로만 보호되니 외부에 절대 공개 X
- API 키는 Render 환경변수에만 — 절대 git에 올리지 말 것
- 세션 쿠키는 12시간 유지
