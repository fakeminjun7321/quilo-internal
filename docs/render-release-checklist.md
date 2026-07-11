# Quilo Render 릴리스 체크리스트

프론트엔드 전면 개편을 운영 환경에 반영하기 전후로 확인할 읽기 전용 기준이다. 운영 사용자·크레딧·파일·토큰을 생성하거나 수정하거나 삭제하는 검증은 하지 않는다.

## 1. Render 설정

- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz`
- Production branch: 배포 직전 확정한 브랜치
- `NODE_ENV=production`

필수 비밀값은 Render Environment에만 저장하고 Git에 넣지 않는다.

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SESSION_SECRET`
- `ADMIN_NAME`
- `ADMIN_PASSWORD`

Quilo Bot 비용 제어 권장값:

- `OPENAI_CHAT_MODEL=gpt-4o-mini`
- `OPENAI_CHAT_MEMO_MODEL=gpt-4o-mini`
- `OPENAI_CHAT_API_BASE=https://api.openai.com/v1`
- `CHAT_MAX_TOKENS=700`
- `CHAT_DAILY_MAX=1500`

## 2. 배포 전 로컬 검증

```bash
node -c server.js
node -c public/app.js
npm run test:qa
```

- 첫 화면과 공통 페이지에서 데스크톱 상단바가 동일한지 확인한다.
- Quilo Bot 텍스트 입력·스트리밍·음성 받아쓰기를 확인한다.
- 제거한 `/tools/word-count.html`, `/tools/regression.html`, `/tools/graph.html`이 더 이상 노출되지 않는지 확인한다.
- 관리자 화면은 fixture 또는 읽기 전용 API로만 렌더링한다.
- Git diff에 `.env`, `.env.local`, 키, 운영 사용자 데이터가 없는지 확인한다.

## 3. 배포 후 읽기 전용 점검

- `GET /healthz`가 `{ "ok": true }`를 반환한다.
- `GET /api/version`에서 서버 버전 응답과 클라우드 설정 boolean만 확인한다.
- `GET /api/chat/status`에서 Quilo Bot이 활성화되고 모델명이 기대값인지 확인한다.
- 로그아웃 홈, 가이드, 개발자 페이지, 앱 소개 페이지, 로그인·회원가입 화면을 연다.
- 관리자 계정으로 로그인할 때는 목록 조회까지만 확인하고 저장·삭제·크레딧·권한 버튼을 누르지 않는다.
- 보고서 생성·결제·이메일·API 토큰 발급은 운영 스모크 테스트에서 호출하지 않는다.

## 4. 롤백 기준

다음 중 하나라도 발생하면 직전 정상 배포로 롤백한다.

- 로그인 또는 세션이 반복 해제된다.
- 보고서 폼이 열리지 않거나 제출 계약의 `id`, `name`, endpoint가 달라졌다.
- 관리자 페이지가 읽기만 해도 사용자 정보를 수정한다.
- Quilo Bot 오류율이나 비용이 급증한다.
- 데스크톱 기본 화면에 가로 스크롤·메뉴 겹침·빈 화면이 발생한다.
