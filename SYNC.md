# 두 맥 동기화 (SYNC)

두 대의 맥에서 각각 Claude Code로 Quilo를 작업할 때 **항상 같은 상태에서** 이어가기 위한 시스템.

## 무엇이 어떻게 동기화되나

| 대상 | 채널 | 비고 |
|------|------|------|
| 소스코드 전체 (`server.js`, `lib/`, `public/`, `docs/`, `CLAUDE.md` …) | **git** (GitHub `fakeminjun7321/Quilo`) | 템플릿 `.hwpx` 3종도 `git add -f`로 이미 추적됨 |
| `.env` (시크릿) | **iCloud 심링크** | ⚠️ git 커밋 금지 (공개 mirror repo 존재) |
| `lib/pipelines/phys-result/form.pdf` | **iCloud 심링크** | `*.pdf` gitignore 대상 |
| Claude 메모리 `~/.claude/projects/…/memory/` | **iCloud 심링크** | 프로젝트 맥락 누적본 |
| `node_modules/`, `.venv/`, `__pycache__/` | **동기화 안 함** | 각 맥에서 `npm install`로 재생성 |

iCloud 실제 폴더: `~/Library/Mobile Documents/com~apple~CloudDocs/QuiloSync/`
프로젝트 안의 `.env`·`form.pdf`·`memory`는 그 폴더를 가리키는 **심볼릭 링크**(복사본 아님)다.

## 일상 루틴

작업 **시작할 때**:
```bash
npm run sync:start
```
→ 링크 상태 점검 · iCloud 충돌본 감지 · `git fetch` · (안전하면) fast-forward pull · 의존성 변경 시 자동 `npm install` · 지난 맥이 남긴 핸드오프 노트 출력.

작업 **끝낼 때**:
```bash
npm run sync:end -- "다음 맥에 남길 한 줄 메모"
```
→ 미커밋 변경 요약 · 핸드오프 노트를 iCloud에 기록 · 미푸시 커밋 알림. (메모 생략 가능; 인자 없으면 물어봄)

아무 때나 상태만 보고 싶으면:
```bash
npm run sync          # 링크/브랜치/변경 요약
```

> `sync:start`/`sync:end`는 **절대 main을 자동으로 rebase/merge 하지 않고, 코드를 자동 커밋하지도 않는다.** (다른 창에서 main을 병렬로 정리하는 습관과 안전하게 공존하기 위함) 커밋은 늘 **본인 파일만 골라서** 직접.

## 새 맥에서 처음 한 번 (예: 맥 B)

1. 저장소 클론 (또는 이미 있으면 `git pull`):
   ```bash
   git clone https://github.com/fakeminjun7321/Quilo.git
   cd Quilo
   ```
2. iCloud Drive가 켜져 있고 `QuiloSync` 폴더가 내려받아졌는지 확인 (Finder → iCloud Drive).
3. 의존성 설치:
   ```bash
   npm install        # postinstall이 .venv·tectonic·pandoc까지 세팅
   ```
4. 링크 연결 (한 번만):
   ```bash
   npm run sync:setup
   ```
   맥 B에는 이미 iCloud에 `.env`·`form.pdf`·`memory`가 있으므로, 스크립트가 **iCloud본을 채택하고 링크만** 건다. 로컬에 같은 파일이 있으면 `*.bak.<시각>`으로 백업한 뒤 iCloud본을 쓴다.

이후로는 맥 B에서도 `sync:start` / `sync:end`만 쓰면 된다.

## 주의 / 문제 해결

- **iCloud 충돌본** (`.env 2`, `MEMORY 2.md` 등): 두 맥에서 동시에 같은 파일을 고치면 iCloud가 만든다. `sync:start`가 감지해서 경고하니, 올바른 본만 남기고 삭제.
- **한 맥에서 끝내고 다른 맥에서 시작**하는 흐름을 지켜야 충돌이 거의 안 난다. (`sync:end` → 자리 이동 → `sync:start`)
- **iCloud가 아직 안 내려받음**: `sync:start`가 `brctl download`로 강제 다운로드를 시도한다. 그래도 비어 있으면 Finder에서 QuiloSync 폴더를 열어 다운로드를 재촉.
- **링크가 깨졌을 때**: `npm run sync:setup`을 다시 실행하면 idempotent하게 재연결한다.
- **되돌리기**: 심링크를 지우고 iCloud 폴더의 실제 파일을 프로젝트로 복사하면 원상복구. (`.bak.*` 백업도 참고)

## 커밋 대상

이 시스템 파일 중 **git으로 두 맥에 전달해야 하는 것**:
- `scripts/quilo-sync.sh`
- `SYNC.md`
- `package.json` (sync 스크립트 4줄 추가분)

`.env`·`form.pdf`·`memory`·`QuiloSync/`는 커밋 대상이 **아니다** (iCloud가 담당).
