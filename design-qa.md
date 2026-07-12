# Quilo 관리자 사용자 관리 화면 Design QA

- Source visual truth: `/Users/minjun/.codex/generated_images/019f4f80-a1c0-7af3-a195-67252e1f1d24/exec-320513de-8328-4419-b113-0ade09933eda.png`
- User-reported previous state: `/tmp/codex-remote-attachments/019f4f80-a1c0-7af3-a195-67252e1f1d24/D085E722-50AF-4C24-A0BF-F59EAF9665A5/1-붙여넣은-이미지-1.jpg`
- Implementation screenshots: `/tmp/quilo-admin-users-console.png`, `/tmp/quilo-admin-users-1206.png`
- Viewports: `1440 × 1000`, `1206 × 850`
- State: light theme, 사용자 탭, QA 사용자 선택, 새 사용자 폼 닫힘

## Full-view comparison evidence

목표 화면과 구현 화면을 같은 비교 입력에서 원본 해상도로 확인했다. 구현은 목표의 핵심 구조인 어두운 운영 사이드바, 상단 요약 스트립, 검색·필터 작업 바, 밀도 높은 사용자 표, 파란 선택 행, 우측 고정 인스펙터를 모두 갖춘다. 기존 화면의 단일 표와 반복적인 `관리` 버튼은 기본 시야에서 제거됐다.

## Focused region comparison evidence

별도 크롭 없이 원본 1440px 캡처에서 표의 상태 배지, 선택선, 사용량 막대, 인스펙터의 필드와 빠른 작업 레이블을 판독할 수 있어 같은 전체 화면을 확대해 확인했다.

## Required fidelity surfaces

- Fonts and typography: 기존 Quilo sans-serif 스택을 유지했다. 24px 요약 숫자, 12px 사용자명, 10px 보조 텍스트로 위계가 분리되고 표의 숫자는 tabular numbers를 사용한다. 작은 상태 텍스트도 겹치거나 잘리지 않는다.
- Spacing and layout rhythm: 232px 사이드바, 가변 목록, 390px 고정 인스펙터의 3영역 구조다. 요약 스트립은 카드가 아니라 세로 구분선으로 연결되며, 행 높이는 55px로 한 화면에서 비교 가능한 밀도를 유지한다.
- Colors and tokens: 기존 navy/white/Quilo blue 토큰을 재사용했다. 선택 행과 활성 요약 항목은 파란색, 승인·대기·위험은 의미색으로만 구분한다. 그림자와 둥근 카드 사용을 최소화했다.
- Image quality and asset fidelity: 이 화면에는 별도 사진이나 일러스트가 없다. 기존 Quilo 브랜드 마크 외에 가짜 이미지, CSS 일러스트, 임시 아바타를 추가하지 않았다.
- Copy and content: API에 없는 Pro/Max 등급을 추정하지 않았다. 실제 응답으로 계산 가능한 전체·승인 대기·미인증·사용 잠김·관리자만 요약하고, `이번 시간 사용량`, `누적 사용`, `모델 접근`, `보고서 접근`처럼 단위를 명확히 적었다.

## Interaction and accessibility evidence

- 이름·아이디·학번·이메일 검색, 상태 필터, 정렬, 요약 지표 필터가 동작한다.
- 선택 행은 `aria-selected`와 왼쪽 파란 선으로 표시되며 Enter/Space로 선택할 수 있다.
- 인스펙터의 작업은 기존 확인 절차를 그대로 사용하고, 삭제·초기화는 위험 영역에 분리했다.
- 새 사용자 폼은 기본적으로 닫혀 있고 사용자 추가 버튼으로 열리며, 비밀번호 필드는 password 타입이다.
- CodeMirror 리소스는 코드 에디터 탭 진입 전에는 로드되지 않는다.
- 브라우저 QA에서 가로 overflow, console error, 예기치 않은 write request가 없었다.

## Comparison history

### Iteration 1 — blocked

- P1: 사용자 상태를 요약하거나 분류할 수 없는 단일 표였다.
- P1: 선택 상태와 우측 상세 맥락이 약하고 모든 행에 관리 버튼이 반복됐다.
- P2: 인증 상태가 이모지에 의존했고 누적 비용·관리자·시간당 수치가 같은 위계로 섞였다.
- P2: 새 사용자 폼이 항상 노출돼 목록 작업의 집중도를 낮췄다.
- P2: 사용자 탭 진입 전에도 CodeMirror 리소스를 전부 로드했다.

### Iteration 2 — blocked

- 상단 운영 요약 스트립, 검색·상태 필터·정렬, 결과 수를 추가했다.
- 표를 사용자·계정 상태·크레딧·이번 시간 사용량·가입일의 5개 핵심 열로 재구성했다.
- 선택 행과 우측 상세/빠른 작업을 연결하고 필터 결과가 바뀌면 선택도 안전하게 갱신한다.
- 인증 이모지를 텍스트 상태 배지로 교체하고 사용자 추가 폼을 접었다.
- CodeMirror를 코드 에디터 탭에서만 지연 로드하도록 변경했다.
- P1: 1206px 폭에서 크레딧 열의 모델 제한 보조 문구가 이번 시간 사용량 열과 겹쳤다.

### Iteration 3 — passed

- 표의 크레딧 열에서는 금액과 크레딧만 표시하고 모델·보고서 접근 정보는 우측 인스펙터로 일원화했다.
- 1206px에서는 검색/필터 도구 막대만 자연스럽게 두 줄로 접히며 표와 인스펙터는 같은 행에 유지된다.
- 1440px와 1206px 모두 문서 가로 overflow, 텍스트 겹침, 컨테이너 잘림이 없다.
- Post-fix evidence: `/tmp/quilo-admin-users-console.png`, `/tmp/quilo-admin-users-1206.png`.

## Follow-up polish

- P3: 실제 Pro/Max 등급과 최근 로그인 시각은 현재 사용자 목록 API가 제공하지 않으므로 표시하지 않았다. 향후 공식 필드가 생기면 인스펙터 탭과 요약 지표에 추가할 수 있다.
- P3: 사용자 수가 수백 명을 넘으면 서버 페이지네이션이 필요하다. 현재 규모에서는 클라이언트 검색과 정렬이 충분하다.

final result: passed
