# 보고서 작성 툴 (웹)

대구과학고 학생용 자동 보고서 생성 사이트. 보고서 종류별로 입력 폼이 다름.

**지원 보고서:**
- 🧪 **화학 사전보고서** — 매뉴얼 PDF만 올리면 사전보고서 .docx 자동 생성
- 🔬 **화학 결과보고서** — 사전보고서 + 엑셀 데이터 + 사진 → 표/차트/사진이 들어간 결과보고서
- ⚛️ 물리 결과보고서 — 준비 중

**스택:**
- 백엔드: Node.js + Express
- AI: Claude API (Sonnet 4.6 또는 Opus 4.7 선택) + 웹 검색
- 데이터: xlsx (엑셀 파싱), chartjs-node-canvas (차트 PNG)
- 출력: HWP 호환 .docx
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

## 3. 무료 플랜 한계 (알아둘 것)

- **15분 비활성 후 sleep** — 첫 요청에 30초~1분 걸림. 이후엔 즉시 응답.
- **750 시간/월** — 한 달 풀로 켜둬도 가능 (한 달=720h).
- **메모리 512MB** — 충분.
- **Anthropic API 비용은 별도** — 본인이 결제.

---

## 4. 비용 감 잡기

Opus는 보고서 1개당 대략:
- 입력: PDF 5~15페이지 ≈ 5,000~15,000 토큰
- 출력: 8,000~16,000 토큰
- **건당 약 $0.5 ~ $2** (모델·길이에 따라 변동)

---

## 5. 결과가 마음에 안 들 때

GitHub repo에서 `skills/chem-pre-lab-report.md` 파일을 직접 수정하고 push하면 Render가 자동으로 다시 빌드해서 적용함. 이 파일이 Claude에게 주는 시스템 프롬프트라서, 더 구체적인 지시를 추가하면 즉시 반영됨.

예: "이론 섹션은 매 키워드마다 최소 5문단" / "수식은 별도 줄에 표기" 같은 규칙 추가.

---

## 6. 폴더 구조

```
chem-pre-lab-web/
├── server.js                    # Express + PIPELINES 레지스트리
├── lib/
│   ├── parser.js                # 화학식 마커 (_{}, ^{}, *italic*) 공통
│   ├── pricing.js, supabase.js, rate-limit.js, exchange-rate.js, auth.js
│   ├── json-sanitize.js         # JSON 응답 안의 raw 제어문자 자동 escape
│   └── pipelines/
│       ├── chem-pre/            # 화학 사전보고서
│       │   ├── prompt.md, generate.js, docx-gen.js
│       │   └── image-pipeline.js, image-search.js, nano-banana.js (미사용)
│       ├── chem-result/         # 화학 결과보고서
│       │   ├── prompt.md, generate.js, docx-gen.js
│       │   ├── excel-parser.js  # xlsx/csv → markdown table
│       │   └── chart-gen.js     # chart spec → PNG (chartjs-node-canvas)
│       └── phys-result/         # 준비 중
├── public/
│   ├── login.html, index.html, admin.html, style.css
├── package.json
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
