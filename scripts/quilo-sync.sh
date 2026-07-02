#!/usr/bin/env bash
# quilo-sync — 두 맥 사이에서 Quilo 작업을 동기화한다.
#
#   코드            → git (GitHub: fakeminjun7321/Quilo)
#   .env / form.pdf / Claude 메모리  → iCloud Drive 심볼릭 링크
#
# 사용법:
#   npm run sync:setup            # (맥마다 1회) iCloud 폴더 + 심링크 구성
#   npm run sync:setup -- --dry-run   # 실제로 옮기기 전에 무엇을 할지만 출력
#   npm run sync:start            # 작업 시작: fetch·상태·FF pull·의존성·핸드오프
#   npm run sync:end              # 작업 종료: 상태 점검 + 핸드오프 노트 기록
#   npm run sync:end -- "메모"     # 다음 맥에 남길 한 줄 메모 지정
#   npm run sync                  # 현재 동기화 상태 요약(doctor)
#
# 원칙: 이 스크립트는 절대 main을 자동으로 rebase/merge 하지 않고,
#       코드도 자동 커밋하지 않는다. (병렬 git 작업과 안전하게 공존)

set -uo pipefail

# ── 경로 계산 ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ICLOUD_ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
QSYNC="$ICLOUD_ROOT/QuiloSync"

# Claude 메모리 경로 = 프로젝트 절대경로를 mangling(/→-)해서 유도
MANGLED="$(printf '%s' "$PROJECT_DIR" | sed 's#/#-#g')"
MEMORY_DIR="$HOME/.claude/projects/$MANGLED/memory"

# 동기화 대상 (로컬 ↔ iCloud)
ENV_LOCAL="$PROJECT_DIR/.env";                              ENV_CLOUD="$QSYNC/.env"
FORM_LOCAL="$PROJECT_DIR/lib/pipelines/phys-result/form.pdf"; FORM_CLOUD="$QSYNC/phys-result-form.pdf"
MEM_CLOUD="$QSYNC/memory"
HANDOFF="$QSYNC/HANDOFF.md"

DRY_RUN=0

# ── 출력 유틸 ──────────────────────────────────────────────────────────
c_red() { printf '\033[31m%s\033[0m\n' "$*"; }
c_grn() { printf '\033[32m%s\033[0m\n' "$*"; }
c_yel() { printf '\033[33m%s\033[0m\n' "$*"; }
c_dim() { printf '\033[2m%s\033[0m\n'  "$*"; }
hr()    { printf '────────────────────────────────────────\n'; }
ts()    { date "+%Y-%m-%d %H:%M:%S"; }
tag()   { date "+%Y%m%d-%H%M%S"; }

_do() { # DRY_RUN이면 실행 대신 출력 (인자 그대로 실행 — 공백 안전)
  if [ "$DRY_RUN" = "1" ]; then c_dim "  [dry-run] $*"; else "$@"; fi
}

ensure_icloud() {
  if [ ! -d "$ICLOUD_ROOT" ]; then
    c_red "✗ iCloud Drive가 안 보입니다: $ICLOUD_ROOT"
    c_yel "  시스템 설정 → Apple 계정 → iCloud → 'iCloud Drive'를 켜세요."
    exit 1
  fi
}

# ── 링크 헬퍼 ──────────────────────────────────────────────────────────
link_file() { # <local> <cloud> <label> <required:0|1>
  local local_p="$1" cloud_p="$2" label="$3" required="${4:-0}"
  if [ -L "$local_p" ]; then
    if [ "$(readlink "$local_p")" = "$cloud_p" ]; then
      c_grn "✓ $label: 이미 링크됨"
      [ -e "$cloud_p" ] || c_yel "  ⚠ iCloud에 실체가 아직 없음(다운로드 대기 중일 수 있음)"
      return 0
    fi
    c_yel "→ $label: 다른 대상 링크 재연결"
    _do rm "$local_p"
  elif [ -e "$local_p" ]; then
    _do mkdir -p "$(dirname "$cloud_p")"
    if [ -e "$cloud_p" ]; then
      local bak="$local_p.bak.$(tag)"
      c_yel "→ $label: 양쪽 다 존재 → 로컬을 백업($bak)하고 iCloud본 채택"
      _do mv "$local_p" "$bak"
    else
      c_grn "→ $label: 로컬 파일을 iCloud로 이동"
      _do mv "$local_p" "$cloud_p"
    fi
  else
    if [ ! -e "$cloud_p" ]; then
      if [ "$required" = "1" ]; then
        c_red "✗ $label: 로컬에도 iCloud에도 없음 — 이 파일은 앱 실행에 필요합니다"
      else
        c_yel "· $label: 아직 어디에도 없음 (선택 파일, 건너뜀)"
      fi
      return 0
    fi
  fi
  _do ln -s "$cloud_p" "$local_p"
  c_grn "✓ $label: 링크 완료 → iCloud"
}

link_dir() { # <local_dir> <cloud_dir> <label>
  local local_p="$1" cloud_p="$2" label="$3"
  if [ -L "$local_p" ]; then
    if [ "$(readlink "$local_p")" = "$cloud_p" ]; then c_grn "✓ $label: 이미 링크됨"; return 0; fi
    c_yel "→ $label: 링크 재연결"; _do rm "$local_p"
  elif [ -d "$local_p" ]; then
    _do mkdir -p "$(dirname "$cloud_p")"
    if [ -d "$cloud_p" ]; then
      local bak="$local_p.bak.$(tag)"
      c_yel "→ $label: 양쪽 다 존재 → 로컬을 백업($bak)하고 iCloud본 채택"
      _do mv "$local_p" "$bak"
    else
      c_grn "→ $label: 로컬 디렉터리를 iCloud로 이동"
      _do mv "$local_p" "$cloud_p"
    fi
  fi
  _do mkdir -p "$(dirname "$local_p")"
  [ -d "$cloud_p" ] || _do mkdir -p "$cloud_p"
  _do ln -s "$cloud_p" "$local_p"
  c_grn "✓ $label: 링크 완료 → iCloud"
}

check_link() { # <local> <cloud> <label>
  local local_p="$1" cloud_p="$2" label="$3"
  if [ -L "$local_p" ] && [ "$(readlink "$local_p")" = "$cloud_p" ]; then
    if [ -e "$cloud_p" ]; then c_grn "✓ $label → iCloud (OK)"
    else c_yel "⚠ $label: 링크는 있으나 iCloud 실체 없음(다운로드 대기)"; fi
  elif [ -e "$local_p" ]; then c_yel "· $label: 로컬 실파일(아직 링크 안 됨) — 'sync:setup' 필요"
  else c_red "✗ $label: 없음 — 'sync:setup' 필요"; fi
}

# iCloud 충돌본(예: '.env 2') 감지
warn_conflicts() {
  local hits
  hits="$(find "$QSYNC" -maxdepth 2 -name '* [0-9]*' 2>/dev/null)"
  if [ -n "$hits" ]; then
    c_red "⚠ iCloud 충돌본으로 보이는 파일이 있습니다 (두 맥에서 동시 편집?):"
    printf '%s\n' "$hits" | sed 's/^/    /'
    c_yel "  올바른 본을 남기고 나머지를 지운 뒤 다시 시작하세요."
  fi
}

# ── 의존성 최신화 ──────────────────────────────────────────────────────
dep_check() {
  local lock="$PROJECT_DIR/package-lock.json"
  local marker="$PROJECT_DIR/node_modules/.quilo-lock-hash"
  if [ -f "$lock" ]; then
    local h; h="$(shasum "$lock" | awk '{print $1}')"
    if [ ! -d "$PROJECT_DIR/node_modules" ] || [ "$(cat "$marker" 2>/dev/null)" != "$h" ]; then
      c_yel "→ package-lock 변경 감지 → npm install 실행..."
      ( cd "$PROJECT_DIR" && npm install ) && printf '%s' "$h" > "$marker" \
        && c_grn "✓ node_modules 갱신" || c_yel "⚠ npm install 실패 — 수동 확인 필요"
    else
      c_grn "✓ node_modules 최신"
    fi
  fi
  local req="$PROJECT_DIR/requirements.txt"
  if [ -f "$req" ] && [ -d "$PROJECT_DIR/.venv" ]; then
    local rmarker="$PROJECT_DIR/.venv/.quilo-req-hash"
    local rh; rh="$(shasum "$req" | awk '{print $1}')"
    if [ "$(cat "$rmarker" 2>/dev/null)" != "$rh" ]; then
      c_yel "→ requirements 변경 감지 → pip install 실행..."
      ( "$PROJECT_DIR/.venv/bin/pip" install -r "$req" >/dev/null 2>&1 ) \
        && printf '%s' "$rh" > "$rmarker" && c_grn "✓ .venv 갱신" \
        || c_yel "⚠ pip install 실패 — 수동 확인"
    else
      c_grn "✓ .venv 최신"
    fi
  elif [ -f "$req" ]; then
    c_yel "· .venv 없음 — 필요 시: npm install (postinstall이 venv 생성)"
  fi
}

# ── 핸드오프 노트 ──────────────────────────────────────────────────────
show_handoff() {
  if [ -s "$HANDOFF" ]; then
    c_grn "📋 지난 핸드오프 노트:"; hr; cat "$HANDOFF"; hr
  else
    c_dim "핸드오프 노트 없음."
  fi
}

write_handoff() { # <note> <branch> <status_text>
  local note="$1" br="$2" st="$3"
  local last host
  last="$(git -C "$PROJECT_DIR" log -1 --pretty='%h %s' 2>/dev/null)"
  host="$(hostname -s 2>/dev/null || hostname)"
  {
    echo "# Quilo 핸드오프"
    echo
    echo "- 시각: $(ts)"
    echo "- 머신: $host"
    echo "- 브랜치: $br"
    echo "- 마지막 커밋: $last"
    echo "- 커밋 안 된 파일:"
    if [ -n "$st" ]; then printf '%s\n' "$st" | sed 's/^/    /'; else echo "    (없음)"; fi
    echo "- 메모: ${note:-(없음)}"
  } > "$HANDOFF"
}

# ── git 상태 요약 ──────────────────────────────────────────────────────
git_upstream_counts() { # echo "behind ahead" or ""
  git -C "$PROJECT_DIR" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1 || return 1
  git -C "$PROJECT_DIR" rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null
}

# ── 커맨드 ─────────────────────────────────────────────────────────────
cmd_setup() {
  ensure_icloud
  _do mkdir -p "$QSYNC"
  hr; echo "iCloud 동기화 폴더: $QSYNC"; hr
  link_file "$ENV_LOCAL"  "$ENV_CLOUD"  ".env (시크릿)"        1
  link_file "$FORM_LOCAL" "$FORM_CLOUD" "phys-result/form.pdf" 0
  link_dir  "$MEMORY_DIR" "$MEM_CLOUD"  "Claude 메모리"
  [ -f "$HANDOFF" ] || _do touch "$HANDOFF"
  hr
  if [ "$DRY_RUN" = "1" ]; then
    c_yel "dry-run이었습니다. 실제 적용: npm run sync:setup"
  else
    c_grn "설정 완료. 이제 npm run sync:start / sync:end 를 쓰세요."
    c_dim "다른 맥에서는: git pull 후 npm run sync:setup 한 번 실행."
  fi
}

cmd_start() {
  ensure_icloud
  hr; c_grn "▶ Quilo sync:start ($(ts))"; hr
  check_link "$ENV_LOCAL"  "$ENV_CLOUD"  ".env"
  check_link "$FORM_LOCAL" "$FORM_CLOUD" "form.pdf"
  if [ -L "$MEMORY_DIR" ] && [ "$(readlink "$MEMORY_DIR")" = "$MEM_CLOUD" ]; then
    c_grn "✓ Claude 메모리 → iCloud (OK)"
  else
    c_yel "· Claude 메모리: 링크 안 됨 — 'sync:setup' 필요"
  fi
  warn_conflicts
  # iCloud 강제 다운로드(best-effort)
  command -v brctl >/dev/null 2>&1 && brctl download "$QSYNC" >/dev/null 2>&1 || true
  hr

  c_grn "git fetch..."
  git -C "$PROJECT_DIR" fetch --all --prune 2>&1 | sed 's/^/  /'
  local br; br="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD)"
  echo "현재 브랜치: $br"
  local counts behind ahead dirty
  if counts="$(git_upstream_counts)"; then
    behind="$(printf '%s' "$counts" | awk '{print $1}')"
    ahead="$(printf '%s' "$counts" | awk '{print $2}')"
    echo "upstream 대비: ↓${behind:-0} behind / ↑${ahead:-0} ahead"
    dirty=0; [ -n "$(git -C "$PROJECT_DIR" status --porcelain)" ] && dirty=1
    if [ "${behind:-0}" -gt 0 ] && [ "${ahead:-0}" -eq 0 ] && [ "$dirty" -eq 0 ]; then
      c_grn "fast-forward pull..."
      git -C "$PROJECT_DIR" pull --ff-only 2>&1 | sed 's/^/  /'
    elif [ "${behind:-0}" -gt 0 ] && [ "${ahead:-0}" -gt 0 ]; then
      c_yel "⚠ diverged — 다른 창에서 rebase 중일 수 있어 자동으로 손대지 않습니다. 직접 확인하세요."
    elif [ "$dirty" -eq 1 ] && [ "${behind:-0}" -gt 0 ]; then
      c_yel "⚠ behind이지만 로컬 변경 있음 → pull 생략. 먼저 커밋/스태시."
    else
      c_grn "코드 최신 상태."
    fi
  else
    c_yel "· upstream 없는 브랜치 ($br) — pull 생략"
  fi
  hr
  dep_check
  hr
  show_handoff
}

cmd_end() {
  ensure_icloud
  hr; c_grn "■ Quilo sync:end ($(ts))"; hr
  local br st
  br="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD)"
  st="$(git -C "$PROJECT_DIR" status --porcelain)"
  echo "브랜치: $br"
  if [ -n "$st" ]; then
    c_yel "커밋 안 된 변경:"; printf '%s\n' "$st" | sed 's/^/  /'
    c_yel "※ 본인 파일만 골라 커밋하세요 (git add -A 지양). 이 스크립트는 자동 커밋하지 않습니다."
  else
    c_grn "작업 트리 깨끗."
  fi
  local note="${1:-}"
  if [ -z "$note" ] && [ -t 0 ]; then
    printf "다음 맥에 남길 한 줄 메모(엔터=생략): "; read -r note || true
  fi
  write_handoff "$note" "$br" "$st"
  command -v brctl >/dev/null 2>&1 && brctl upload "$HANDOFF" >/dev/null 2>&1 || true
  c_grn "📋 핸드오프 노트 기록 완료 (메모리·시크릿은 iCloud가 자동 동기화)."
  local counts ahead
  if counts="$(git_upstream_counts)"; then
    ahead="$(printf '%s' "$counts" | awk '{print $2}')"
    [ "${ahead:-0}" -gt 0 ] && c_yel "↑ ${ahead} 커밋 미푸시 → 확인 후: git push"
  fi
}

cmd_status() {
  ensure_icloud
  hr; c_grn "Quilo 동기화 상태 ($(ts))"; hr
  echo "프로젝트: $PROJECT_DIR"
  echo "iCloud:   $QSYNC  $([ -d "$QSYNC" ] && echo '(있음)' || echo '(없음 — setup 필요)')"
  echo "메모리:   $MEMORY_DIR"
  hr
  check_link "$ENV_LOCAL"  "$ENV_CLOUD"  ".env"
  check_link "$FORM_LOCAL" "$FORM_CLOUD" "form.pdf"
  if [ -L "$MEMORY_DIR" ] && [ "$(readlink "$MEMORY_DIR")" = "$MEM_CLOUD" ]; then
    c_grn "✓ Claude 메모리 → iCloud (OK)"
  else
    c_yel "· Claude 메모리: 링크 안 됨"
  fi
  warn_conflicts
  hr
  local br; br="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  echo "git 브랜치: $br"
  git -C "$PROJECT_DIR" status --short 2>/dev/null | sed 's/^/  /' | head -20
}

# ── 진입점 ─────────────────────────────────────────────────────────────
main() {
  local cmd="${1:-status}"; shift || true
  local note=""
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY_RUN=1 ;;
      *) [ -z "$note" ] && note="$a" ;;
    esac
  done
  case "$cmd" in
    setup)          cmd_setup ;;
    start)          cmd_start ;;
    end)            cmd_end "$note" ;;
    status|doctor)  cmd_status ;;
    *) echo "usage: quilo-sync {setup|start|end|status} [--dry-run] [\"핸드오프 메모\"]"; exit 1 ;;
  esac
}
main "$@"
