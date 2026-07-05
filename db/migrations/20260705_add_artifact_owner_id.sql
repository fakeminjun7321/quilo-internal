-- H1 (보안): 아티팩트 소유권을 '표시명(owner=users.name, 중복 가능)' 이 아니라
-- 불변 user id(owner_id) 로 키잉한다. 표시명 충돌만으로 타인의 비공개 아티팩트를
-- 읽기/덮어쓰기/삭제할 수 있던 IDOR 를 닫는다.
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run. idempotent(여러 번 실행 안전).
-- 코드는 이 컬럼이 없어도 동작(레거시 name 기준 폴백)하므로, 마이그레이션 전 배포도 안전하다.

alter table artifacts add column if not exists owner_id uuid;
create index if not exists artifacts_owner_id_idx on artifacts (owner_id);

-- 기존 행 backfill: owner(표시명)이 '유일하게' 매칭되는 사용자일 때만 안전하게 연결한다.
-- (표시명이 중복인 행은 모호하므로 null 로 남겨 두고, canManage 가 레거시 name 폴백으로 처리)
update artifacts a
   set owner_id = u.id
  from users u
 where a.owner_id is null
   and a.owner = u.name
   and (select count(*) from users u2 where u2.name = a.owner) = 1;
