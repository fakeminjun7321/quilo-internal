# 화학실험 사전보고서 자동 생성 (웹)

대구과학고 화학실험 사전보고서를 PDF 매뉴얼만 올리면 Claude Opus가 자동으로 .docx로 만들어주는 웹사이트.

- 백엔드: Node.js + Express
- AI: Claude Opus API + 웹 검색
- 출력: HWP 호환 .docx
- 인증: 공용 비밀번호

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

   | Key | Value |
   |-----|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` (Anthropic 콘솔에서 발급한 본인 키) |
   | `SHARED_PASSWORD` | 친구들에게 알려줄 공용 비밀번호 |
   | `SESSION_SECRET` | 32자 이상 랜덤 문자열 (예: 키보드 마구 두드린 거 아무거나) |
   | `NODE_ENV` | `production` |

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
├── server.js              # Express 서버 (라우트, SSE, 인증)
├── lib/
│   ├── claude.js          # Anthropic API 호출
│   ├── docx-generator.js  # JSON → .docx 빌드
│   └── parser.js          # 화학식 마커 파서
├── skills/
│   └── chem-pre-lab-report.md  # 시스템 프롬프트
├── public/
│   ├── login.html
│   └── index.html
├── package.json
├── .env.example           # (배포 시에는 Render 환경변수 사용)
├── .gitignore
└── README.md
```

---

## 7. 보안 메모

- 공용 비밀번호 1개로만 보호되니 외부에 절대 공개 X
- API 키는 Render 환경변수에만 — 절대 git에 올리지 말 것
- 세션 쿠키는 12시간 유지
