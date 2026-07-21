# Quilo 정식 출시 준비 점검 기록 — 2026-07-21

이 문서는 현재 작업 트리의 출시 준비 상태와, 코드만으로 완료할 수 없는 운영 검증을
구분해 남기는 작업 메모다. 실제 사용자 업로드나 운영 계정 데이터는 점검에 사용하지
않았다.

## 현재 결론

코드 기준의 주요 보안·신뢰성 위험은 보강했지만, 아래 **배포 차단 조건**을 운영에서
확인하기 전에는 정식 출시 완료로 판정하지 않는다.

1. Supabase에 `20260705_add_artifact_owner_id.sql`과
   `20260721_add_credit_reservation_ledger.sql`을 적용한다.
2. Render에 32자 이상의 별도 `SESSION_SECRET`, Supabase service key, AI 공급자 키를
   설정하고 시작 실패가 없는지 확인한다.
3. Supabase 파일함 장애 시 생성 작업이 `done` 또는 크레딧 정산으로 넘어가지 않고
   환불되는지 스테이징에서 확인한다.
4. 실제 생성한 DOCX/HWPX를 macOS 한글과 Windows 한컴에서 각각 열어 표·수식·이미지와
   첫 페이지 제목 박스를 확인한다.

## 완료된 보강

### 생성·결제·파일

- 유료 생성은 DB 원장에 크레딧을 먼저 예약하고, 완료 시 정산하며 실패·중단 시 환불한다.
- 결과 파일은 운영 저장소의 식별자를 확인한 뒤에만 완료·정산한다. 저장 실패는
  `ARTIFACT_PERSISTENCE_FAILED`로 fail-closed 처리한다.
- 파일함 저장은 제한된 지수 backoff로 재시도하고, 영구 오류는 즉시 중단한다.
- 다중 PDF 결과의 보상 삭제는 `job.fileId`뿐 아니라 모든 `files[].fileId`를 정리한다.
- 완료 파일의 메모리 TTL/LRU, 사용자별 소유권, 24시간 저장 fallback을 보강했다.
- 생성 동시성·대기열 길이·대기시간·전체 multipart RAM 예산을 제한했다.
- 바이브 이미지 생성은 공급자 호출 전에 크레딧을 예약하고 사용자별 동시 실행을 제한한다.

### 인증·권한·외부 연동

- 운영 세션 비밀값 누락·짧은 값은 서버 시작 단계에서 거부한다.
- 로그인 요청에 동일 출처 검사를 적용하고, 운영 권한 조회 실패는 허용하지 않는다.
- `/api/me`와 로그인 응답은 표시 이름이 아닌 불변 사용자 ID를 제공한다.
- 레거시 `owner_id=null` 산출물은 이름 일치만으로 일반 사용자에게 공개하지 않는다.
- OAuth redirect URI는 완전 일치 HTTPS URL만 허용하고 동적 클라이언트 등록에 제한을 둔다.
- 연동 상태 조회와 실제 Drive/Dropbox 데이터 접근 scope를 분리했다.
- 액세스 토큰 폐기 시 같은 사용자·리소스의 refresh token family도 함께 폐기한다.
- Webhook은 DNS 해석 결과를 검증한 뒤 그 IP로 연결하고 redirect를 거부해 SSRF 재바인딩을 막는다.

### 업로드·파서·실행 격리

- PDF, Office ZIP, HWPX, CAP, XLS, 이미지의 실제 파일 시그니처를 확장자와 함께 검증한다.
- DOCX, XLSX, HWPX ZIP은 entry 수, 실제 inflate byte, 총 압축 해제량, 압축비를 제한한다.
- 스프레드시트는 한 번의 bounded parse 결과를 Markdown과 canonical table에 재사용한다.
- BYOK Anthropic Files API 업로드와 삭제에 같은 활성 사용자 키를 사용한다.
- 브라우저 코드 실행은 메인 페이지 `eval` 대신 시간·출력·API가 제한된 Worker에서 수행한다.
- 계정 전환·로그아웃 시 보고서 초안, 학번, 편집기 코드 등 민감한 브라우저 저장값을 지운다.

### 프론트엔드·운영 품질

- 모델 가용성·권한과 실제 선택 가능한 옵션을 동기화하고 서버 정책으로 재검증한다.
- 390px 모바일 보고서 진입 시 긴 상태 요약보다 단계 안내와 활성 입력 폼을 먼저
  배치해 작업 시작점이 첫 화면에 보이도록 했다.
- 채팅 제공자가 비활성인 환경에서도 홈의 큰 fallback 카드가 물리 결과보고서로
  실제 이동하도록 바꿨고, 메모 첨부 파일 입력을 기존 폼 토큰으로 정리했다.
- SSE 재연결, 취소, 비용 표시, 실패 상태를 보강했다.
- `/api/version` 기본 응답을 최소화하고 상세 노트는 명시적 요청에서만 제공한다.
- 보안 헤더, sitemap, 키보드 접근성, dropzone 상태, 공통 shell 일관성을 개선했다.
- 공급망 빌드·배포 구성은 별도 점검 결과와 함께 최종 회귀 테스트로 확정한다.

## 검증 근거

- 업로드 위장 파일, ZIP forged-size/과도한 entry/실제 inflate 초과 PoC가 거부된다.
- 정상 XLSX/XLS/CSV와 저장소에서 생성한 HWPX는 강화된 파서를 통과했다.
- 결제 원장, 예약 보상, 영속 저장, 다중 파일 정리, OAuth scope·폐기, webhook SSRF,
  브라우저 저장소 격리, Worker 격리 테스트를 추가했다.
- Root Node 테스트 `511/511`, PDF Python `155/155`, SDK Python `9/9`, Classbot
  `114/114`, 문법 검사 `20/20`이 통과했다.
- Playwright QA `416/416`이 안정적인 단일 worker 실행에서 통과했다. 48개 공개 route,
  1440/933/390px shell, 보고서 모델 선택, mocked 생성/SSE 재연결, 인증, 관리자,
  PDF·OCR, 외부 연동 흐름을 실제 Chromium으로 확인했다.
- 홈과 화학 사전보고서의 데스크톱·모바일 화면을 같은 뷰포트에서 전후 비교했고,
  브라우저 page error·console error와 가로 overflow가 없음을 확인했다. 비교 기록은
  `design-qa.md`와 외부 시각화 폴더에 남겼다.
- Root와 Classbot의 production `npm audit`는 모두 취약점 0개이며,
  `git diff --check`도 통과했다.
- Linux amd64 HF Docker 이미지를 실제로 빌드·실행해 uid 1000, Node 의존성,
  PyMuPDF/fontTools/lxml, Tectonic을 확인했고 SDK wheel/sdist도 실제 빌드했다.
- macOS 차트 테스트에서 `sharp`와 `canvas`가 로드하는 GLib 클래스 중복 경고가 한 번
  발생했으나 실패·크래시는 없었다. Linux/Render에서는 배포 후 차트 생성을 별도로 확인한다.

## 남은 수동·외부 검증

- 실제 AI 공급자 키를 사용하는 `.cap`, `.cap + Excel`, Excel/텍스트 단독, 이미지 포함
  DOCX/HWPX 스테이징 생성
- 생성 파일의 원본 데이터 일치와 raw `{{EQ...}}`, Markdown pipe 잔존 여부 확인
- Render 환경의 큐 포화, 업로드 메모리 한도, 파일함 장애, 프로세스 재시작 시나리오
- 공개 저장소에 포함하지 않는 학교 템플릿의 사용 권한과 배포 경로 확인

## 점검 도구 제약

- 공식 Deep/Standard Security Scan 도구는 이번 실행 환경의 worker 수와 연결 오류 때문에
  완료 상태를 주장할 수 없다. 대신 인증·소유권, 공급망·브라우저, 파서·생성 세 축으로
  독립적인 코드 점검과 회귀 테스트를 수행했다.
- 앱 내 브라우저 제어 연결은 `Transport closed`로 반복 종료됐다. 사용자의 명시적
  허가 후 standalone Playwright Chromium으로 fallback해 최신 화면 캡처·상호작용·전후
  비교를 완료했으므로 화면 점검 결과에는 이 대체 경로를 명시한다.

## 전체 프론트엔드·권한 재검사 및 연결 센터 개편

- 운영 공개 경로 64개를 데스크톱과 모바일에서 각각 열어 `128/128` 기본 화면 상태를
  확인했다. 문서 4xx/5xx, page error, 예상 밖 failed response, 깨진 가시 이미지,
  가로 overflow, 이름 없는 가시 control은 발견되지 않았다.
- 로컬 격리 환경에서 anonymous/member/Pro/admin/API developer의 92개 route-role 상태와
  Max, 단일 beta, developer, restricted-model, approval-pending, API Test/Live scope,
  Bearer 비관리자 권한 상승 방지 등 7개 특수 권한 시나리오를 통과했다.
- 클릭형 광역 crawler의 632개 timeout은 닫힌 overlay·클릭 후 DOM 교체·비동기 detach에서
  발생한 탐색 잡음으로 분류했다. 각 경로의 기능 단위 테스트와 상태 전이는 별도
  persistent QA로 검증했으며, 원시 ledger는 삭제하지 않았다.
- 개발자 페이지를 일반 사용자도 이해할 수 있는 `Quilo 연결 센터`로 개편했다.
  ChatGPT OAuth, Codex Test token, 직접 API의 세 작업 경로, Test/Live의 정확한 차이,
  역할/요금제와 scope의 경계, 첫 요청, token 수명, idempotency, request ID를 단계적으로
  안내한다.
- 범위 선택 preset, 동적 scope/endpoint 수, catalog category 접기, paused 항목 비활성,
  clipboard 실패 표시, 요청 로그 loading/disable 상태를 추가했다. 죽은
  `navBetaTranslate` reveal target도 제거했다.
- 개발자 페이지 집중 Playwright `6/6`, 전체 Playwright `417/417`이 통과했다. 같은 상태와
  viewport의 선택 시안·실제 구현을 한 화면에서 비교한 기록은 `design-qa.md`에 추가했다.
- 상세 경로·권한 결과는 외부 점검 산출물
  `/Users/minjun/.codex/visualizations/2026/07/21/019f83bd-c9ff-7ab0-abbd-53238b8e0365/quilo-exhaustive-frontend/combined-summary.md`
  와 JSON ledger 세 개에 남겼다.

## Render 스테이징 판정

- 저장소에는 `render.yaml`, Render CLI 로그인, 서비스 ID, 스테이징 GitHub environment가
  없어 기존 스테이징 대상을 안전하게 식별할 수 없었다.
- `chem-pre-lab-web.onrender.com`은 운영으로 redirect되어 스테이징으로 사용할 수 없다.
- 운영 `/api/version`은 점검 시 release `1.0.57`, commit `ed657879…`였고 GitHub main과
  일치했지만, 현재 로컬 작업 트리는 별도 dirty 상태이므로 운영에 배포하지 않았다.
- 따라서 실제 공급자 key를 쓰는 canary와 HWPX/DOCX OS 교차 열기는 아직 출시 차단
  조건이다. 정확한 Render 스테이징 서비스가 준비되기 전에는 운영 배포를 하지 않는다.
