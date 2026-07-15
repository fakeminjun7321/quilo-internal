# Quilo 일정 관리 운영 배포 절차

기준일: 2026-07-16

Quilo 일정 관리 서비스는 기존 Quilo 보고서 서버와 같은 저장소에서 관리하지만 별도의 Render Web Service와 Cron Job으로 배포한다. 실제 비밀값은 Git, 문서, 채팅, 스크린샷에 넣지 않는다.

## 1. 배포 전 확인

```bash
cd apps/classbot
npm ci
npm run release:check
```

- `apps/classbot`이 Git에 커밋되어 원격 저장소에 올라가 있어야 한다.
- 기존 Quilo 보고서 Render 서비스의 Build Filter에서 `apps/classbot/**`를 제외한다. 일정 관리 변경 때문에 보고서 서버가 불필요하게 재배포되지 않게 하기 위함이다.
- [`render.yaml`](../render.yaml)은 Starter Web Service와 유료 Cron Job을 만든다. Render Blueprint를 적용하기 전에 현재 요금을 확인한다.

## 2. Supabase 스키마

Supabase SQL Editor에서 [`db/schema.sql`](../db/schema.sql) 전체를 실행한다. 이 파일은 재실행 가능하게 작성되어 있다. 완료 후 아래 읽기 전용 SQL로 버전과 필수 RPC를 확인한다.

```sql
select id, version from public.classbot_schema_meta where id = 1;

select
  to_regprocedure('public.classbot_health_check()') is not null as health_rpc,
  to_regprocedure('public.classbot_create_member(uuid,text,text)') is not null as member_rpc,
  to_regprocedure('public.classbot_claim_invite(uuid,text,text,text)') is not null as invite_rpc,
  to_regprocedure('public.classbot_replace_timetable_day(uuid,integer,jsonb)') is not null as timetable_rpc;
```

기대값은 schema version `1`과 모든 RPC의 `true`다. 모든 일정 관리 테이블은 RLS가 활성화되고 anon/authenticated 정책은 만들지 않는다. 서버만 service role key로 접근한다.

## 3. Render Blueprint

Render에서 New Blueprint를 만들고 Blueprint Path를 `apps/classbot/render.yaml`로 지정한다. Blueprint는 모노레포 Root Directory를 `apps/classbot`으로 제한하며, 자동 배포는 GitHub 검사가 성공한 커밋에서만 진행한다.

최초 입력이 필요한 값:

- `CLASSBOT_ADMIN_PASSWORD`: 16자 이상, 다른 secret과 중복 금지
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `KAKAO_REST_API_KEY`: 연결한 Quilo 비즈앱의 REST API 키. 채팅이나 문서에 복사하지 않고 Render에 직접 입력한다.

세션, Cron, 카카오 스킬 secret은 Render가 각각 독립된 임의 값으로 생성한다. 앱은 Render 런타임을 항상 production으로 취급하며 placeholder, 개발 기본값, HTTP 외부 주소, 중복 secret을 거부한다.

첫 배포에서는 `KAKAO_EVENT_ENABLED=false`를 유지한다. Web Service의 `/api/health`가 다음 조건을 만족해야 한다.

```json
{"ok":true,"storage":"supabase","kakaoEnabled":false}
```

이 health check는 Supabase의 `classbot_health_check()` RPC와 schema version을 실제로 확인하며 실패 시 HTTP 503을 반환한다.

## 4. 읽기 전용 배포 후 점검

```bash
cd apps/classbot
CLASSBOT_EXPECT_STORAGE=supabase npm run smoke -- https://YOUR_CLASSBOT_HOST
```

Smoke test는 관리자 로그인을 시도하거나 데이터를 생성하지 않는다. 정적 화면, health, 익명 세션, 관리자 API 보호, Cron Bearer 보호, 카카오 스킬 secret 보호만 확인한다.

Cron Job은 Render private network의 `hostport`로 Web Service를 호출한다. 외부 URL과 secret을 로그에 남기지 않으며 성공 시 처리 건수만 출력한다. 1분마다 실행하므로 Render Cron 요금이 발생한다.

## 5. 카카오 조회 기능 활성화

1. 기본 채널형 `Quilo` 채널을 생성한다. 사용할 수 없으면 `Quilo 일정`을 사용한다. `Class`는 넣지 않는다.
2. 챗봇 생성·채널 연결과 봇 배포를 완료한다. 단톡방에서 직접 호출하는 조회 기능만 쓸 때는 사업자 인증이나 월렛이 필요하지 않다.
3. 카카오 스킬에 공개 HTTPS `/api/kakao/skill` 엔드포인트와 `X-Classbot-Skill-Secret` 헤더를 연결하고 폴백 블록이 스킬 응답을 사용하게 한다.
4. Blueprint에 고정된 `KAKAO_BOT_ID=6a57ace9fd013545b6416293`을 확인하고, `KAKAO_REST_API_KEY`는 Render에 직접 입력한다.
5. 개발봇 또는 테스트 채널에서 `오늘 일정 학생 1`처럼 이름을 맨 뒤에 붙인 조회와 개인 일정 격리를 확인한다.

자동 알림을 추가로 켜는 경우에만 비즈니스 채널 인증, 비즈앱, 카카오 로그인, 월렛과 Event 블록을 준비하고 이벤트명을 `quilo_schedule_notification`으로 설정한다. 테스트 구성원 한 명만 활성 수신자로 둔 상태에서 `KAKAO_EVENT_ENABLED=true`로 바꾸고 한 건만 시험 발송한다. POST 접수 후 task 결과가 `sent`로 확정되면 운영 Cron을 활성화하고, 실패하면 즉시 `KAKAO_EVENT_ENABLED=false`로 되돌린다.

실패 알림은 자동 재시도하지 않는다. 원인을 확인한 뒤 관리자 명시적 재시도만 사용한다.

## 6. 롤백 기준

다음 중 하나라도 발생하면 카카오 발송을 먼저 끄고 직전 정상 배포로 롤백한다.

- `/api/health`가 503이거나 schema version이 다르다.
- 관리자 세션이 반복 해제되거나 외부 Origin에서 관리자 API가 허용된다.
- 동일 일정·공지·Cron 실행에서 중복 알림이 생긴다.
- task 결과 조회 전 알림이 성공 처리된다.
- 데이터가 재배포 후 사라지거나 16명 정원·초대 코드 일회성 규칙이 깨진다.

롤백 후에도 Supabase 스키마를 임의로 삭제하지 않는다. 먼저 `KAKAO_EVENT_ENABLED=false`로 전송을 정지하고 Render의 직전 정상 Deploy를 선택한다.
