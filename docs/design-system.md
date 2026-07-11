# Quilo 디자인 시스템 베이스라인

## 1. 개요

이 문서는 Quilo(보고서 생성 웹앱)의 디자인 시스템 베이스라인이다. 앞으로 진행하는 모든 디자인 개선·리팩터링·신규 페이지 작성은 이 문서를 기준선으로 삼는다. 어떤 변경이 "일관성을 회복하는 것"인지 "이탈을 키우는 것"인지 판단할 때 가장 먼저 참고할 근거 문서다.

- **적용 범위**: `public/*.html` 전체 페이지 + 공유 `public/style.css`(약 3,100줄)의 `:root` 토큰과 컴포넌트 규칙.
- **현재 디자인 언어 한 줄 요약**: `style.css`의 `:root` 의미론 토큰(서피스·텍스트·액센트·상태색 + 라이트/다크 대응)을 단일 출처로 삼는 라이트/다크 양립형 시스템이지만, 일부 페이지(`create`/`editor`/`translate-app`/`studio` 등)가 공유 시트를 링크하지 않거나 토큰을 우회한 하드코딩 색으로 평행 디자인 시스템을 만들고, 메인 `index`조차 인라인 `style=` 103곳에서 토큰을 한 번도 쓰지 않아(브랜드블루를 `#243ba2`로 24곳 하드코딩) 일관성이 페이지별로 크게 갈리는 상태다.

토큰 아키텍처 자체는 견고하다. 색·그림자는 의미론 토큰으로 정리되어 있고 다크 모드 오버라이드가 거의 모든 토큰에 존재한다. 문제는 (a) 토큰 체계에 **간격·타이포 스케일 토큰이 없다**는 구조적 공백과, (b) 여러 페이지가 토큰을 **사용하지 않고 하드코딩으로 재구현**한다는 적용상의 공백 두 축에 집중되어 있다.

---

## 2. 디자인 토큰

### 2.1 색 토큰 (라이트 / 다크)

`style.css`의 `:root`에 정의된 의미론 색 토큰. 다크 값은 `html[data-theme="dark"]` 오버라이드 기준이다.

| 토큰 | 라이트 | 다크 | 주 용도 |
|---|---|---|---|
| `--bg` | `#f5f6f8` | `#0b0d12` | 페이지 배경(html, body); landing-nav 반투명 베이스 |
| `--surface` | `#ffffff` | `#14171d` | 기본 카드/패널: 폼, `.settings-card`, `#progressArea`, fieldset, 모달, 드롭다운, 인풋, topnav |
| `--surface-2` | `#f3f4f6` | `#1a1e26` | 보조/함몰 서피스: `.form-section`, `.file-item`, `.progress-step`, hover, table thead, `.stat-box`. `--surface-soft` 별칭 |
| `--surface-3` | `#ebedf1` | `#20252e` | 최심 서피스. report-type 라벨 hover 배경에만 사용(저빈도) |
| `--border` | `#e7e9ee` | `#272c35` | 카드·섹션·테이블·디바이더·드롭다운의 기본 1px 헤어라인 |
| `--border-strong` | `#d4d8e0` | `#363c47` | 인풋·버튼·세그먼트·드롭존 dashed의 강조 보더 |
| `--text` | `#15171c` | `#e7ebf2` | 본문/제목 기본 텍스트 |
| `--text-muted` | `#5e6672` | `#9aa3b0` | 보조 텍스트·라벨·힌트. `--muted` 별칭. ※ select-chevron SVG data-URI에 `#5e6672`로 하드코딩되어 다크에서 재색칠되지 않음 |
| `--text-faint` | `#8b929d` | `#69727f` | 3차/placeholder 텍스트·kicker·서브라벨·푸터 |
| `--accent` | `#2563eb` | `#3b76ee` | 브랜드 블루: 주요 버튼·활성 탭·포커스 링·체크 상태·스텝 번호. `--primary` 별칭 |
| `--accent-hover` | `#1d4ed8` | `#5288f5` | 액센트 채움 hover. `--primary-dark` 별칭 |
| `--accent-text` | `#2563eb` | `#7aa6ff` | 액센트 텍스트/링크/아이콘. ※ 라이트는 `--accent`와 동일, 다크는 더 밝음(텍스트 대비용 의도적 분리) |
| `--accent-soft` | `#eaf1ff` | `#172234` | 부드러운 액센트 틴트 배경: 체크된 카드, `.policy-check`, `.balance-box`, `.eyebrow`, hover pill, cta-band. `--primary-soft` 별칭 |
| `--accent-border` | `#cfe0ff` | `#2b3e60` | accent-soft 서피스의 보더(balance-box, 배너, cta-band, pill) |
| `--on-accent` | `#ffffff` | `#ffffff` | 액센트 채움 위 텍스트/아이콘(버튼 라벨, 활성 탭, step-num, beta-pill) |
| `--success` | `#0f9d6b` | `#18a572` | 성공: 채워진 드롭존 보더, 다운로드 버튼 배경, 체크 아이콘, done step |
| `--success-soft` | `#e6f7ef` | `#0f2a22` | 성공 틴트: `.dropzone.is-filled` |
| `--danger` | `#d4453f` | `#e35d57` | 에러/파괴 텍스트, `.req` 별표, `.stop-btn`, form-error |
| `--danger-soft` | `#fdeceb` | `#2c1614` | danger 틴트: `.stop-btn` |
| `--danger-border` | `#f3c2bf` | `#5a2a27` | `.stop-btn` 보더 |
| `--warning` | `#a8741a` | `#d6a544` | 경고 텍스트, `.notice` 좌측 보더 액센트 |
| `--warning-soft` | `#fff6e2` | `#2a2210` | `.notice` 배경. `--warning-bg` 별칭 |
| `--console-bg` | `#0c1322` | `#080b12` | 콘솔/로그 서피스(`#progressArea pre`, `.console`) — 양 테마 모두 의도적으로 어두움 |
| `--console-text` | `#d8deea` | `#cfd6e2` | 콘솔 텍스트 |
| `--ring` | `rgba(37,99,235,0.28)` | `rgba(91,140,255,0.34)` | 인풋 포커스 box-shadow 링(3px spread) |

### 2.2 타이포그래피

- **폰트**: 단일 sans 스택 `--font-sans`(-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Pretendard, Malgun Gothic, 맑은 고딕, system-ui)와 `--font-mono`(ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas). ※ `.tool-out-code`(L2697)는 자체 mono 스택을 하드코딩 — 미세 드리프트.
- **타입 스케일 토큰 없음**: `--text-sm`/`--fs-*` 류 토큰이 전무. 모든 크기가 raw px 리터럴.
- **제목 스케일은 요소 기반**: h1 31px/820, h2 20px/760, h3 740(크기 미지정, 상속). 마케팅 제목은 `clamp()`으로 재선언(.hero h1 33–52px, .home-hero h1 31–56px, .section-head h2 24–32px).
- **폰트 크기 리터럴이 매우 잘게 쪼개져 일관성 낮음**: 11.5/12.5/13.5/14.5/15.5 같은 반-스텝 포함 15종의 개별 px 값. 라운드 스케일 없음.
- **폰트 굵기가 가장 큰 비일관 지점**: 사용 중인 굵기 15종(550,600,640,650,680,700,740,750,760,770,780,800,820,850). 700(22회)·760(10회)이 우세하나 640/650/740/750/760이 토큰 없이 "semibold급"으로 거의 호환 사용됨.
- **줄간격**: 본문 1.55, 제목 1.06–1.35, 프로즈 1.6–1.7 — 셀렉터별 즉석 정의, 토큰 없음.

### 2.3 간격 · 반경

- **반경 토큰**: `--radius:14px`, `--radius-sm:9px`, `--radius-lg:20px`가 존재하고 널리 사용됨. 그러나 일회성 반경이 우회: 10px(5회), 12px(2회), 13px(2회), 7px(.segmented label·.file-actions a), 9px(.brand-mark·.page-tabs — `--radius-sm` 값과 같지만 하드코딩), 999px(9회 pill — `--radius-full` 토큰 없음), 50%(.spinner). → 10px/12px/13px은 **매칭 토큰이 없는 공백**, 7px/9px은 `--radius-sm`로 흡수 가능.
- **간격 스케일 토큰 전무**: `--space-*` 류가 하나도 없음. 모든 gap/padding/margin이 raw px. 값이 대략 4px 리듬 근처에 모이지만 off-grid가 많음(gap 6/7/8/9/10/11/12/14/16/18/22px; padding 13/14/15/16/17/18/24/26px). 카드 패딩은 24px(폼)/18px(.form-section·모바일 카드)/26px(모달·login-card·feature-card)로 토큰 없이 세 종류.

### 2.4 그림자

- 테마 인지 그림자 토큰 3종: `--shadow-sm`, `--shadow`, `--shadow-lg`. 라이트는 저-불투명 레이어드 `rgba(16,24,40,...)`, 다크는 더 무거운 `rgba(0,0,0,...)`로 오버라이드 — 좋은 다크 패리티.
- 사용 일관됨: `-sm`은 바/탭/칩/정지 상태 카드, 기본 `--shadow`는 hover 상승 카드·주요 폼, `--shadow-lg`는 모달/드롭다운/login-card.
- 일부 인라인 box-shadow가 토큰에 inset 링을 합성(`0 0 0 1px var(--accent) inset, var(--shadow-sm)` 등). 이 inset-ring 패턴이 3~4회 반복 → `--ring-inset` 토큰 후보. 포커스는 인풋엔 box-shadow 링, 버튼/라벨엔 `2px solid outline`으로 **두 가지 포커스 시각 언어** 공존(접근성 참조).

---

## 3. 컴포넌트 인벤토리

`style.css`가 제공하는 공유 컴포넌트와, 어디서 쓰이고 어디서 제각각 재정의되는지.

| 컴포넌트 | 용도 | 사용/재정의 현황 |
|---|---|---|
| `button`(요소) + `.primary`/`.secondary`/`.ghost`/`.compact` + `.stop-btn` | 코어 버튼 시스템(요소 스코프) | 기본 button=중립 서피스; `[type=submit]`/`.primary`=액센트 채움; `.secondary`=서피스 아웃라인; `.ghost`=투명; `.compact`=소형; `.stop-btn`=danger. 토큰 사용 견고 |
| `.btn-lg`/`a.btn-primary`/`a.btn-outline`/`.blog-cta .btn`/`.nav-login-menu .btn` | 앵커/마케팅용 **두 번째 평행 버튼 시스템** | 요소 버튼 시스템과 중복. 베이스 `.btn` 클래스 없음 — `.blog-cta .btn`·`.nav-login-menu .btn`는 스코프 안에서만 스타일됨. `.primary` vs `.btn-primary` 비일관 |
| `body>form`, `.tab-panel>form`, `.settings-card`, `#progressArea`, `fieldset`, `.legal-page`, `.tool-card`, `.feature-card`, `.version-card`, `.login-card` | 카드/패널 서피스 | 같은 surface+border+radius+shadow 레시피를 별도 선언(`.card` 유틸 없음). 반경(`--radius` vs `--radius-lg`)·패딩(18/24/26px) 제각각 |
| `.confirm-overlay` + `.confirm-card`(+ `.confirm-list`/`.confirm-actions`) | 모달/다이얼로그 | 단일 패턴, 토큰 주도, 오버레이 블러 + 진입 키프레임. 양호. `body.modal-open` 스크롤 잠금 |
| `input`/`select`/`textarea`(요소) + `.tool-input` + `.nav-login-menu` 인풋 | 폼 인풋 | 요소 레벨 인풋이 시스템(44px min-height, `--border-strong`, `--radius-sm`, `--ring` 포커스). 단 `.tool-input`은 반경 10px·포커스 `0 0 0 3px var(--accent-soft)`로 분기 |
| `.page-tabs button` + `.segmented label` + `.form-flow-steps button` + `.progress-steps` | 탭/세그먼트/스테퍼 | 시각적으로 유사한 "pill 그룹" 3종이 반경(9px/7px)·활성 스타일 미묘차로 손수 구현. 단일 컴포넌트화 가능 |
| pill: `.balance-box span`, `.workspace-summary li`, `.settings-shortcuts a`, `.quick-jump a`, `.file-actions a`, `.beta-pill`, `.feature-tag`, `.eyebrow` | 배지/칩/pill | 공유 `.badge`/`.chip` 클래스 없이 최소 6종의 round-pill 처리(반경 999px, 패딩/크기/색 제각각). **파일 내 최다 중복 영역** |
| `.topnav` + `.nav-dd` + `.nav-dd-menu` + `.landing-nav` | 상단 내비 + 드롭다운 | **두 내비 시스템 공존**: `.landing-nav`(마케팅, 반투명 블러) vs `.topnav`(앱, full-bleed sticky) — 둘 다 66px이나 크롬 다름. 드롭다운(`.nav-dd-menu`)은 단일·토큰 주도 |
| `.notice` + `.compliance-notice` | 인라인 알림/콜아웃 | 좌측 보더 액센트 콜아웃; warning 기본, `.compliance-notice`=액센트. 변형 2종뿐, success/danger 콜아웃 변형 없음 |

### 토큰/별칭 충돌 메모

- 레거시 별칭 블록(L60-67): `--muted`/`--primary`/`--primary-dark`/`--primary-soft`/`--surface-soft`/`--surface-raised`/`--warning-bg`를 신토큰에 매핑(하위호환). 한 값에 두 이름 → 별칭을 잘못 편집하면 드리프트.
- `--surface-raised = var(--surface)`는 순수 no-op 별칭(상승 효과 없는 오해 소지 이름).
- `--accent`와 `--accent-text`는 라이트 동일(#2563eb)·다크 분기 → 오용 쉬움(링크 텍스트에 `--accent` 쓰면 다크에서 어색).
- progress done/error 상태가 `--success`/`--danger` 토큰 대신 rgba 리터럴 사용(토큰이 있는데 안 씀).
- `.ann-ticker*`는 하드코딩 hex 섬 + 자체 다크 블록.
- `table`에 `border:0 !important` / thead `background:var(--surface-2) !important` — 공유 요소 셀렉터의 `!important`는 컴포넌트 오버라이드와 충돌 위험.
- `[hidden]` 대상 다수 `!important display` 규칙 — base 컴포넌트가 `[hidden]`을 기본 존중하지 않는 반복 함정.

---

## 4. 일관성 규칙 & 위반 현황 ⭐

### 4.1 규칙(베이스라인)

1. **모든 페이지는 `/style.css`를 링크하고 `:root` 토큰을 사용한다.** 공유 시트를 링크하지 않는 페이지(평행 디자인 시스템)는 금지.
2. **색·간격·반경·그림자는 인라인/하드코딩 hex 금지, 공유 토큰만 사용한다.** 배경→`--surface`/`--surface-2`, 보더→`--border`/`--border-strong`, 텍스트→`--text`/`--text-muted`/`--text-faint`, 액센트→`--accent`/`--accent-hover`/`--accent-text`, 상태→`--success`/`--danger`/`--warning`(+`-soft`/`-border`).
3. **브랜드 블루는 `--accent`(#2563eb) 하나다.** `#2950e6`/`#3b5bdb`/`#243ba2`/`#0e639c`/`#2f80ed` 등 평행 블루 금지.
4. **다크 모드는 토큰을 통해 자동 적용한다.** 정의되지 않은 토큰(`--card-bg`/`--brand`/`--chip-bg`/`--input-bg`)에 라이트 hex 폴백을 거는 패턴 금지(폴백이 항상 이겨 다크가 깨짐).
5. **컴포넌트는 공유 클래스를 재사용한다.** 탭→`.page-tabs`, 모달→`.confirm-overlay`/`.confirm-card`, 카드→공유 카드 레시피, 콘솔→`--console-bg`/`--console-text`, 인풋→요소 인풋 규칙. 공유 클래스명(`.beta-pill` 등) 재정의로 의미를 바꾸지 않는다.
6. **반경은 `--radius-sm`(9)/`--radius`(14)/`--radius-lg`(20)에 스냅한다.** 8/10/11/12/13px 일회성 금지.
7. **터치 타깃·포커스는 공유 베이스라인(44px, `:focus-visible` 링)을 유지한다.**

### 4.2 위반 페이지 표

#### (a) 공유 CSS 미링크 / 평행 시스템

| 페이지 | 상태 | 핵심 |
|---|---|---|
| `editor.html` | **미링크** | `/style.css` 전혀 링크 안 함. 100% 인라인. VS Code 클론 팔레트(`#1e1e1e`/`#0e639c`/`#007acc`), 자체 `.qide.light` 테마(글로벌 `data-theme` 무시). 토큰 0 참조 |
| `create.html` | **미링크** | `/style.css` 미링크. 자체 `:root`(`--acc:#3b5bdb`, `--bg:#f6f7fb`, `--card`, `--bd`, `--ink:#1c2333`, `--mut`). 완전 평행 시스템 |
| `translate-app.html` | **미링크** | `/style.css` 미링크. 자체 `:root`(`--acc:#3b5bdb`/`--accd:#2f49b0`/`--bg:#f5f7fb`/`--bd:#e3e6ef`/`--ink`/`--mut`/`--ok`). card/button/dropzone/modal/console/badge 전부 재정의 |
| `studio.html` | **미링크** | `/style.css` 링크 0회(이전 "4회 link"는 실제로 JS `.style.cssText`/bundler 셀렉터였음). head `<style>`(L10–111)가 자체 `:root`(`--bg:#0f1117`/`--panel:#161922`/`--ink:#e7e9ef`/`--acc:#5b7cfa`/`--accd:#4763e0`…)로 공유 토큰 전체 우회. 버튼·카드·모달·탭·입력·뱃지 전량 재구현. **다크-온리**(`data-theme` 미사용) |

#### (b) 링크했으나 토큰 이탈(부분 포크)

| 페이지 | 상태 | 핵심 이탈 |
|---|---|---|
| `index.html` ⭐메인 | 링크 O, 공유 컴포넌트 사용 O | 공유 컴포넌트(`.report-form`·`.dropzone`·`.segmented`·`.notice`·`.settings-card`·`.topnav`)는 잘 쓰나, **인라인 `style=` 103곳에서 `var(--*)` 사용 0회**. 브랜드블루를 `--accent`(#2563eb) 아닌 `#243ba2`로 24곳 하드코딩(링크/qc버튼/요약문/`theme-color` meta). memo-guide·who-preview·qc 버튼 색(`#eef1fc`/`#dfe4fb`/`#f7f9ff`/`#e2e6f3`/`#475569`)·readonly textarea(`#fff`) 직접 박아 다크 미대응 |
| `exam-prep.html` | 링크 O, 토큰 우회 | `~100줄` 인라인 + JS 마크업이 페이지 전체를 하드코딩으로 재구성. 액센트 `#2950e6`(≠`--accent`), 미정의 `var(--card-bg)`→항상 `#fff`. `.beta-pill` **공유 클래스와 충돌 재정의**(앰버). 단일 최대 결함 |
| `study.html` | 링크 O, 부분 포크 | nav/footer/theme-toggle 공유 재사용(양호). 그러나 워크벤치 코어가 360줄 인라인. 플로팅 버튼 `rgba(255,255,255,0.92)`+`var(--text)`(다크 시 흰-흰), zoom 모달 `#fff`/`#111827`/`#e5e7eb` 하드코딩, 자체 버튼/라디오 카드/모달 재구현 |
| `translate.html` | 링크 O, 부분 이슈 | 인시스템 모범에 가까우나 `.card`(스타일 정의 없음, 3회)·`button.btn-primary`(스타일 없음) 사용. JS 모달 `askRetypeset()`이 `#fff`/`#1f2937`/`rgba(15,23,42,.45)` 인라인 cssText |
| `admin.html` | 링크 O, 부분 포크 | 정적 마크업은 온-시스템(`.settings-card`/table/form 재사용). 그러나 구 브랜드 `#243ba2`/슬레이트 `#475569`/`#64748b`/`#94a3b8` 등 ~40개 인라인·JS 색. `#adminTabs`가 `.page-tabs` 재구현. 글로벌 `.CodeMirror{border:#e6e8f0}` 누출 |
| `filechat.html` | 링크 O, 가짜 토큰 | 공유 크롬 재사용(양호)이나 `.fc-*`가 **미정의 토큰**(`--card-bg`,#fff / `--brand`,#243ba2 / `--chip-bg`,#f1f5f9 / `--input-bg`,#fff / `--text`,#0f172a) 사용 → 폴백이 항상 이겨 다크에서 흰 채팅창 |
| `community.html` | 링크 O, 재구현 | `.cm*`/`.lab*`/`.vote`/`.pill-filter`/`.md-*`를 raw hex로 거의 전부 재구현. 유일 토큰 `var(--card-bg,#fff)`→항상 `#fff`. 액센트 `#2950e6` ~15회 |
| `examples.html` | 링크 O, 컴포넌트 중복 | 인라인 규칙은 토큰을 올바로 소비하나 `.ex-card`/`.ex-badge`/`.ex-pre`로 공유 카드 중복. `.btn`(스탠드얼론 규칙 없음) 사용 → 비-primary `.btn` 앵커가 무스타일 |

#### (c) 하드코딩 값 → 대응 토큰 매핑(대표)

| 하드코딩 값 | 등장 페이지 | 대응 토큰 |
|---|---|---|
| `#2950e6` / `#243ba2` / `#3b5bdb` / `#2f80ed` / `#0e639c` / `#5b7cfa`(브랜드 블루 변종) | **index**(#243ba2 ×24), **studio**(#5b7cfa), exam-prep, community, admin, create, translate-app, study, editor | `--accent` / `--accent-hover` / `--accent-text` |
| `var(--card-bg,#fff)` / `#fff`(미정의 토큰 폴백) | exam-prep, filechat, community, study, translate-app | `--surface` |
| `#f7f9ff`/`#eef1fc`/`#eef2ff`/`#f8fafc`/`#f6f7fb`/`#fafbff` · `#161922`/`#1d212c`(소프트/패널 배경) | index(#f7f9ff·#eef1fc), studio(#161922·#1d212c), exam-prep, admin, create, study | `--surface` / `--surface-2` / `--accent-soft` |
| `#e2e6f3`/`#dfe4fb`/`#d7e0f5`/`#e6e8f0`/`#e3e6ef`/`#e5e7eb` · `#272b38`(보더) | index(#e2e6f3·#dfe4fb), studio(#272b38), exam-prep, admin, translate-app, create, study | `--border` / `--border-strong` |
| `#1e293b`/`#334155`/`#475569`/`#64748b`/`#94a3b8` · `#9aa1b4`/`#243b5e`(슬레이트 텍스트) | index(#475569·#64748b·#243b5e), studio(#9aa1b4), exam-prep, admin, community, translate-app, study | `--text` / `--text-muted` / `--text-faint` |
| `#0f172a`/`#0f1320`(콘솔/코드) | exam-prep, community, translate-app | `--console-bg` / `--console-text` |
| `#16a34a`/`#15803d`(성공) | exam-prep, admin, filechat | `--success` / `--success-soft` |
| `#dc2626`/`#b91c1c`(에러) | exam-prep, admin, community, filechat | `--danger` / `--danger-soft` / `--danger-border` |
| `#b45309`/`#fff4e5`(경고) | exam-prep, admin, community, translate | `--warning` / `--warning-soft` |
| 반경 8/10/11/12/13px | exam-prep, editor, study, admin, create, studio(10·13px) | `--radius-sm`(9) / `--radius`(14) / `--radius-lg`(20) |
| `<meta theme-color #243ba2>` / `#243ba2` / `#2950e6` | index(`#243ba2`), study(`#243ba2`), 전 legal/static 페이지, exam-prep | `--accent`(#2563eb) |
| select-chevron `stroke='%235e6672'` (다크 미오버라이드) | style.css L661(시스템 전역) | 다크용 `stroke='%239aa3b0'` 오버라이드 추가 |

---

## 5. 다크모드 커버리지

토큰 아키텍처 덕에 `html[data-theme="dark"]`가 모든 의미론 토큰을 오버라이드 → 토큰을 쓰는 컴포넌트는 자동 재색칠된다. 깨지는 곳은 토큰을 우회한 하드코딩 영역이다.

| 페이지 | 커버리지 | 깨지는 곳 |
|---|---|---|
| `terms` / `privacy` / `refund` | **full** | 없음(theme-color meta만 비테마) |
| `guide` / `changelog` | **full** | 없음 |
| `signup` | **full(거의)** | 비밀번호 eye-toggle 색 `#64748b` 하드코딩(다크 대비 약화) |
| `examples` | **full** | `.ex-badge` `--surface` on `--surface-2` → 다크에서 거의 안 보임(평탄) |
| `index` ⭐메인 | **partial** | 공유 컴포넌트(topnav·report-form·dropzone·segmented·btn·settings-card)는 토큰 기반이라 정상. 그러나 인라인 하드코딩 영역이 라이트 전용: memo-guide 박스(`#f7f9ff`+`#e2e6f3`+`#475569`), qc/memo/프롬프트복사 버튼(`#eef1fc`/`#dfe4fb`/`#243ba2`), readonly textarea(`background:#fff`), who-preview(`#f7f9ff`/`#243b5e`) → 다크 배경 위 밝은 패널이 그대로 떠 대비·이질감 |
| `study` | **partial** | 플로팅 canvas/zoom 버튼 흰-흰(보이지 않음), zoom 모달 전체(`#fff`/`#111827`/`#e5e7eb`/`#f8fafc`) 라이트 고정, `.study-caption` 흰 슬랩 |
| `admin` | **partial** | JS 생성 영역 전부(AI 채팅 `#f6f7fb`/`#fff` 버블, appeal 카드, beta chip `#eef2ff`, 공지 행, action 카드 `#fff8ee`) 라이트 섬. IDE 자체 테마 분리 |
| `translate` | **partial** | `askRetypeset()` 모달 라이트 고정(`#fff`/`#1f2937`), `.card` div가 서피스 없음 |
| `filechat` | **broken/partial** | 셸은 다크 OK이나 채팅 코어(`.fc-chat`/`.fc-composer`/버블/textarea/select) 가짜 토큰 폴백으로 흰-온-다크 |
| `exam-prep` | **none(기능적 깨짐)** | 로드 시 다크 옵트인하나 전 서피스 하드코딩 라이트. 흰 카드 섬 + 약대비 슬레이트 텍스트. **최고 임팩트 결함** |
| `community` | **none** | `data-theme=dark` 설정하나 다크 오버라이드 0 → 흰 카드·라이트 보더 그대로 |
| `studio` | **none(공유 기준)** | 자체 단일 **다크-온리** 팔레트만 하드코딩, `data-theme` 토글·공유 토큰 미사용(0%). 내부는 일관 다크이나, 사이트가 라이트일 때도 스튜디오만 강제 다크 → 전역 테마 전환·브랜드 일관성에서 깨짐 |
| `create` | **none** | 부트스트랩·토글·다크 규칙 전무, 자체 라이트 전용 `:root`. 영구 라이트 |
| `editor` | **none(글로벌 기준)** | 자체 `.qide.light` 토글(localStorage `ceTheme`)만 존재, 글로벌 `data-theme`/OS 무시. 게이트 화면 다크 전용 |
| `login` / `build` | N/A | 즉시 리다이렉트 스텁 |

---

## 6. 접근성 베이스라인 (WCAG 2.1 AA)

발견된 플래그를 유형별로 모음.

### 대비 (1.4.3)
- `exam-prep`/`community`/`admin`/`translate-app`: 슬레이트 muted 텍스트(`#94a3b8`≈2.6:1, `#64748b`, `#cbd5e1`≈1.6:1) 흰/다크 배경에서 AA 미달.
- `editor`: `#858585` on `#333`(~3.5:1), `#969696` on `#2d2d2d`(~3.6:1), `#777` on `#202021` 미달.
- `study`/`filechat`: 다크에서 흰 플로팅 버튼/흰 채팅창에 `--text`(거의 흰) → 흰-온-흰 사실상 불가시.
- `signup`: eye-toggle `#64748b` on 다크 `--surface`(~3.8:1) 아이콘 sub-AA.
- `translate-app`: `#6b7280` on `#f5f7fb`(4.51, 12px 비-bold는 미달).
- `index`: `#64748b`(balanceBox·체크박스 안내)·`#9a6a00`(form-maker 경고문) 보조텍스트가 흰/연블루 배경에서 본문 4.5:1 경계선; 다크 시 라이트-전용 박스 대비 깨짐.
- `studio`: `--mut #9aa1b4` on `--panel #161922`(~4.0:1, 11~12px AA 미달), `.placeholder #5b6275` on `#0b0d12` 대비 부족, `#5b7cfa` 위 흰 12px 라벨 경계선.

### 포커스 (2.4.7)
- `editor`/`translate-app`: `:focus-visible` 스타일 전무(공유 링 미상속) → 모든 커스텀 컨트롤 포커스 불가시.
- `study`: 시각 숨김 라디오에 `:has(input:focus-visible)` outline 없음(모드 선택 키보드 포커스 불가시), `.study-gate-btn`(앵커) 포커스 스타일 없음.
- 전 평행 페이지: 로컬 재스타일 컨트롤이 공유 `button:focus-visible`/`input:focus` 링 미상속 → 약함/없음.
- `studio`: 파일 전체에 `:focus`/`:focus-visible` 0건. 버튼·탭·칩·textarea·select가 OS 기본에 의존하고 `border:0` 버튼(.btn/modeseg/seg)은 포커스 표시 사실상 소실(2.4.7 위반).
- `index`: 인라인 `style=`로 만든 커스텀 컨트롤(📋 프롬프트 복사 ×5, qc/memo 버튼)이 공유 `.btn`을 안 거쳐 `--ring` 포커스 보장 못 함.

### 탭 타깃 (2.5.5 / 2.5.8, 44px)
- `exam-prep`: `.qbtn`(~34px), `.ct-item`(8px 13px).
- `study`: zoom 툴바/플로팅 버튼 32px, `.study-actions` 40px.
- `editor`: `.qbtn`~36px, `.tab-x` 16px, 상태바 span ~24px.
- `admin`: JS 생성 버튼 11–12px 폰트 + 3–6px 패딩, 테이블 액션 30px.
- `translate-app`: 버튼 ~40px, `.ghost`/logout ~32px, select/input ~36px.
- `create`/`community`: `.myrow`/`.pill` ~26px, `.linkbtn`/`.cmtabs` <44px.
- `studio`: `.iconbtn` 40px, `.thumbs .rm` 17px·파일칩 rm 15px, `.ck` 칩·`.chips button`·`.modeseg`/`.seg`/`.fbtn` 28~34px 다수.
- `index`: 📋 프롬프트 복사·qc 버튼이 `padding:4~6px`+12px 폰트로 44px 미만, `.policy-check`/체크박스 모바일 타깃 부족 가능.

### 시맨틱 / ARIA
- 탭 시맨틱 부재: `exam-prep`(`.eptabs`), `admin`(8 섹션), `community`(`.cmtabs`)가 `role=tab`/`aria-selected`/`tabpanel` 없는 plain button.
- 비-버튼 인터랙티브: `editor`/`admin` 상태바 액션이 `<span onclick>`(포커스/키보드 불가).
- 모달: `translate`(`askRetypeset`), `create`(`#cmtModal`)가 `role=dialog`/`aria-modal`/포커스 트랩 없음. `study` zoom 모달은 dialog 속성 있으나 포커스 트랩 미완.
- Live region 부재: `exam-prep`(`#ctResults`), `editor`(`#stMsg`), `filechat`/`translate`/`translate-app` 진행/결과가 `aria-live` 없이 갱신. `studio`도 `#instatus`/스트리밍 버블/`#pubStatus`에 `aria-live` 없어 진행·완료 미낭독.
- 탭/모달 시맨틱 부재(추가): `studio`(`#tabs`/`#devseg`/`#modeseg` `role=tab`/`aria-selected` 없음, `.on` 클래스 색에만 의존; `#pubModal` `role=dialog`/`aria-modal`/focus trap 없음). 단 `index`는 `radiogroup`+`aria-labelledby`·드롭다운 `aria-label`로 양호.

### alt / 아이콘 의미
- 캔버스 대체텍스트 없음: `study`(`#minkowskiCanvas`/zoom canvas) `role`/`aria-label` 없음(1.1.1).
- 이모지=의미: `exam-prep`(✅❌🔒🐍▶), `editor`(🗂▶✨🏠), `admin`(🗂▶✨), `create`(❤💬📋🔀🚩) 아이콘 전용 버튼 `aria-label` 없음.
- iframe title 없음: `create` 갤러리 썸네일 iframe.
- `studio`: 모드/툴바/탭이 이모지 텍스트(🤖🧩🎨🖼💻📱↻↶⤢↑📎)로만 라벨링(스크린리더 의미 불명), AI/게시 이미지 버블 `<img>` alt 누락. (`index`는 모든 장식 SVG·이모지를 `aria-hidden` 처리해 문제 없음.)

### label (1.3.1 / 3.3.2)
- placeholder-as-label: `editor`(agentModel/agentPrompt/ceLang), `translate-app`(#code 게이트), `community`(#newTitle/#newBody/댓글), `exam-prep`(assist textarea).
- `admin`: 공지 폼 `제목<br><input>`(label-for 연결 없음).
- `privacy`: 데이터 테이블 `<th>` `scope="col"` 없음, `<caption>` 없음.
- `studio`: 게시 모달 `<label>`이 `for`/`id` 미연결, `select#model`·`textarea#prompt`가 가시 label 없이 `title`/`placeholder`에만 의존.

### 키보드
- `signup`: 비밀번호 reveal 토글 `tabIndex=-1` → 키보드 도달 불가(reveal 불가).
- `translate-app`: 파일 드롭 div `onclick`만(키보드 비포커스, `role`/`tabindex` 없음).
- `editor`: `maximum-scale=1`로 사용자 줌 비활성(1.4.4 / reflow).
- `terms`/`privacy`/`refund` theme-toggle: aria-label 정적 '다크 모드로 전환'(다크일 때 라벨 반전 미확인), `aria-pressed` 없음.
- `studio`: 모달 Esc 닫기·focus trap 없음(배경 클릭만 닫힘), 탭/모드 토글 화살표 키 roving tabindex 미구현. (textarea Enter=전송/Shift+Enter=줄바꿈은 적절.)

---

## 7. 페이지별 critique 요약

| 페이지 | 강점(1~2) | 핵심 이슈 (severity) |
|---|---|---|
| `index` ⭐메인 | 공유 style.css 링크 + 공유 컴포넌트(.report-form/.dropzone/.segmented/.notice) 적극 재사용; 일관된 form-section 리듬·radiogroup·aria-label·aria-hidden 등 시맨틱 양호; `<img>` 없어 alt 누락 0 | 인라인 `style=` 103곳 토큰 0회(P1); 브랜드블루 `#243ba2` ×24 하드코딩→액센트 분기(P1); 하드코딩 박스/버튼 다크 미대응(P1); 커스텀 복사·qc 버튼 탭타깃<44px·포커스 미보장(P2); `#64748b`/`#9a6a00` 보조텍스트 대비 경계선(P2) |
| `studio` | 일관된 자체 다크 셸·명확한 채팅↔스테이지 2분할; 동작하는 체크포인트/파일트리/탭 UX; 760px 반응형 분기 | 공유 style.css **미링크**→토큰·컴포넌트(.btn/.card/.modal/.tab/.input/.badge) 전량 재구현(P0); accent `#5b7cfa`≠브랜드(P0); 포커스 표시 전무·`border:0` 버튼(P0); 다크-온리 `data-theme` 불연동(P1); 탭/모달 ARIA·focus trap·aria-live 부재(P1); 보조텍스트·placeholder 대비 AA 경계(P1); 탭타깃 17~34px 다수(P2); label `for` 미연결(P2) |
| `exam-prep` | `/style.css` 링크 + 사전 테마 적용(수정은 hex→토큰 치환 위주); 마크다운 escape(XSS 방어) | 다크 깨짐(P0); 액센트 `#2950e6` 불일치(P0); `.beta-pill` 충돌(P1); 컴포넌트 전 bespoke(P1); 탭 ARIA·탭타깃(P1) |
| `study` | 공유 nav/footer/theme-toggle 재사용; 인라인 대부분 토큰 소비; 모달 dialog/Escape | 플로팅 버튼 흰-흰(P0); zoom 모달 라이트 고정(P0); 포커스 불가시(P1); 탭타깃 32/40px(P1); 컴포넌트 재구현(P1); canvas alt(P1) |
| `editor` | VS Code 클론으로 내부 일관·친숙; iframe sandbox; 자체 라이트/다크 토글 | 토큰 0·VS Code 블루(P0); 상태바 `<span onclick>`·포커스 없음(P0); 글로벌 테마 미연동(P1); 대비 미달(P1); 탭타깃·모바일(P1) |
| `translate` | 인시스템 모범(공유 nav/footer/dropzone/console/field); CTA 토큰 사이징; 견고한 UX 플로우 | `.card` 미정의→깨진 카드(P0); 모달 비공유·다크 깨짐(P1); `button.btn-primary` 클래스 불일치(P1) |
| `translate-app` | noindex·법적 동의 게이트(제품/법무 위생) | 평행 시스템·다크 없음·sub-44px·포커스 없음(P0); 모달 비공유(P1); 키보드 드롭 불가(P1) |
| `admin` | 공유 시트·핵심 컴포넌트(app-bar/settings-card/table/form) 재사용; FOUC 가드; 일부 셀 토큰 사용 | 구 브랜드 `#243ba2`(P1); `#adminTabs` `.page-tabs` 재구현(P1); JS 영역 다크 깨짐(P1); span 키보드(P1); 탭타깃(P1) |
| `create` | 깔끔한 레이아웃·플루이드 그리드 | 미링크·평행 토큰(P0); 영구 라이트(P0); 탭타깃·포커스(P1); 모달·아이콘 라벨(P1) |
| `filechat` | 3개 중 가장 시스템 근접(공유 크롬·theme-toggle); XSS escape; 채팅 버블 affordance | 가짜 토큰→다크 깨짐(P0); 탭타깃·포커스(P1) |
| `community` | FOUC 부트스트랩; XSS escape; lab 아코디언·마크다운 구조 양호 | 미링크 아님이나 재구현·다크 없음(P0); 컴포넌트 재발명(P1); 대비 미달(P2); placeholder-label(P2) |
| `examples` | 토큰 규율 양호(인라인도 토큰 소비) | `.btn` 미정의→무스타일 다운로드 CTA(P1); 컴포넌트 중복(P2); theme-color 불일치(P2) |
| `guide` | 모범 시민: bespoke CSS 0, 순수 공유 컴포넌트 합성 | theme-color `#243ba2` 불일치(P2) |
| `changelog` | 공유 컴포넌트(legal-page/version-card/patch-note) 클린 재사용 | 죽은 클래스 `.changelog-page`(P2); 헤더 패턴 불일치(P2) |
| `signup` | 공유 auth/form 컴포넌트 조립; `role=alert` 에러; label 연결 정확 | eye-toggle `tabIndex=-1` 키보드 불가(P1); eye 색 하드코딩·다크 대비(P2) |
| `terms`/`privacy`/`refund` | **시스템 최우수 소비자**(인라인 0·하드코딩 0·100% 토큰); 마크업 바이트 일관; 다크 full | theme-color 불일치(P2); privacy 와이드 테이블 모바일(P2); `<th> scope` 없음(P2) |
| `login`/`build` | 의도적 리다이렉트 스텁 | theme-color 동기화만(P2) |

---

## 8. 우선순위 개선 로드맵

### P0 — 일관성 붕괴 · 접근성 위반 · 다크모드 깨짐

> **P0 전체 적용 완료 (2026-06-26)** — 아래 9개 항목 모두 처리·미리보기 검증함. 상세는 §9.

- [x] **`exam-prep.html` 하드코딩 hex → 토큰 일괄 치환**(배경→surface, 보더→border, 텍스트→text-*, 액센트→accent, 상태→semantic). `var(--card-bg)` 제거. `.beta-pill` 충돌→`.ep-beta` 개명. ✅다크 자동 흐름 검증 — *exam-prep*
- [x] **브랜드 블루 단일화**: `#243ba2`/`#2950e6`/`#5b7cfa` 등 변종→`--accent`/`--accent-text`(legal/static의 theme-color meta는 P2). 전역 `chat-widget.js`의 `#243ba2`×12도 `#2563eb`로. — *index(24곳), studio, exam-prep, community, create, translate-app, admin, study, chat-widget.js*
- [x] **미링크 페이지 `/style.css` 링크 + `:root` 별칭**(로컬 var를 공유 토큰에 alias, `--bg` 제거해 상속 → 다크 자동 + 충돌 회피). + 테마 부트스트랩·`/theme.js`·토글 추가. ✅라이트/다크 검증 — *create, translate-app*
- [x] **`studio.html` 브랜드 정렬 + 포커스(다크 IDE 유지)**: studio는 editor처럼 **다크가 의도된 IDE**라 강제 라이트 추종 대신 브랜드블루만 정렬(`--acc:#5b7cfa→#3b76ee`, `--accd→#5288f5`=공유 다크 액센트값) + `:focus-visible{outline:2px solid var(--acc)}` 추가. 공유 시트 완전편입은 P1로 이관. ✅검증 — *studio*
- [x] **가짜 토큰 폴백 제거**: `var(--card-bg,#fff)`→`--surface`, `var(--brand,#243ba2)`→`--accent`, `var(--chip-bg,#f1f5f9)`→`--surface-2`, `var(--input-bg,#fff)`→`--surface`, `var(--text,#0f172a)`→`--text`. ✅다크 채팅창/카드 검증 — *filechat, community*
- [x] **다크 깨짐 표면 토큰화**: 플로팅 버튼 흰배경→`--surface`+`--shadow-sm`; zoom/캡션/모달 라이트 고정색→`--surface`/`--text`/`--border`/`--surface-2`. 캔버스 렌더링 JS 내부 색은 유지. — *study*
- [x] **`create`/`community` 영구 라이트 해소**: 공유 토큰 + 테마 부트스트랩 + `.theme-toggle`. ✅다크 검증(이전 흰 카드 → 전부 다크) — *create, community*
- [x] **`translate.html` `.card`/`button.btn-primary` 깨진 표면 수정**: `.card`→공유 `.tool-card`, 모달 버튼→`.primary`/`.secondary`, 모달 인라인색→토큰. — *translate*
- [x] **`editor` 상태바 액션 `<span onclick>`→`<button>`/role+tabindex + 인터랙티브 `:focus-visible` 링 + 아이콘 `aria-label` + `maximum-scale=1` 제거**(IDE 색 팔레트는 의도 유지). — *editor*

### P1 — 컴포넌트 통일 · 하드코딩 토큰화

- [ ] **`index.html`(메인) 인라인 `style=` 103곳 → 공유 클래스/토큰 추출**: 반복되는 memo-guide 박스·who-preview·qc/복사 버튼을 재사용 클래스로 묶고 색을 `--accent-soft`/`--accent-border`/`--text-muted`/`--surface`로 토큰화(다크 자동 대응). 커스텀 복사·qc 버튼은 공유 `.btn`(secondary/sm)으로 교체해 포커스·탭타깃 일괄 확보. `#64748b`→`--text-muted`, `#9a6a00`→`--warning`. — *index*
- [ ] **공유 베이스 `.btn` 규칙 신설**(요소 `button` 미러: min-height 42px, padding 10px 17px, border `--border-strong`, radius `--radius-sm`, bg `--surface`) → `.btn`/`.btn-primary` 앵커가 어디서나 버튼으로 렌더. — *examples, translate*
- [ ] **`.page-tabs`로 커스텀 탭 통일**: `#adminTabs`/`.eptabs`/`.cmtabs`/`studio`(`#tabs`·`#devseg`·`#modeseg`) 제거하고 공유 탭 + `role=tablist/tab` + `aria-selected`. — *admin, exam-prep, community, studio*
- [ ] **모달 공유 컴포넌트화**: 손수 만든 모달(`askRetypeset`, `#cmtModal`, study zoom, `#terms`, studio `#pubModal`)을 `.confirm-overlay`/`.confirm-card` + `role=dialog`/`aria-modal`/포커스 트랩·Esc 닫기로. — *translate, create, study, translate-app, studio*
- [ ] **`.beta-pill` 충돌 해소**: 로컬 앰버 재정의를 `.ep-beta`로 개명하거나 공유 pill 재사용. — *exam-prep*
- [ ] **버튼/라디오 카드/인풋 재구현 → 공유 컴포넌트 채택**(`button`/`.primary`/`.secondary`, `#reportTypeFieldset` 선택 카드 패턴, 요소 인풋). — *study, community, filechat, create*
- [ ] **admin JS 생성 영역 인라인 hex → 토큰**(bg→surface/surface-2, border→border, muted→text-muted, 상태→semantic). — *admin*
- [ ] **탭 타깃 44px 상향**: `.qbtn`/`.ct-item`(exam-prep), zoom·`.study-actions`(study), `.qbtn`/탭/상태바(editor), JS 액션 버튼(admin), `.myrow`/`.linkbtn`(create/community), translate-app 컨트롤, studio(`.thumbs .rm` 17px·`.ck`/`.chips`/`.modeseg` 28~34px), index(복사·qc 버튼). — *exam-prep, study, editor, admin, create, community, translate-app, studio, index*
- [ ] **`signup` 비밀번호 토글 `tabIndex=-1` 제거**(키보드 도달 가능). — *signup*
- [ ] **`editor`/`study` 캔버스·셸 테마를 글로벌 `data-theme`에 연동**(또는 첫 방문 시 글로벌 테마로 기본값). — *editor, study*
- [ ] **placeholder-as-label 제거 + 아이콘 버튼 라벨링**: 시각 숨김 `<label>`/`aria-label` 추가; studio는 게시 모달 `<label for>` 연결·이모지 전용 버튼(📎↑↻↶⤢💻📱) `aria-label`·이미지 버블 `<img alt>`·`aria-live` 추가. — *editor, translate-app, community, exam-prep, studio*

### P2 — 폴리시 · 미세조정

- [ ] **`<meta name=theme-color>`를 `--accent`(#2563eb)로 통일**(+ `prefers-color-scheme:dark` 변형). — *전 legal/static·examples·guide·changelog·login·study(`#243ba2`)*
- [ ] **간격 스케일 토큰 신설**(`--space-*`, `--pad-card`) 및 라운드 타입 스케일·폰트 굵기 토큰(`--fs-*`/`--fw-*`) 도입. — *style.css(시스템 전역)*
- [ ] **반경 토큰 보강**: `--radius-full`(999px) 추가, 8/10/11/12/13px 일회성을 `--radius-sm`/`--radius`/`--radius-lg`로 스냅(studio 13px 버블·10px 입력 포함). 모달 dim(`#000a`)용 스크림 토큰 신설. — *전 평행 페이지·studio·style.css*
- [ ] **다크 select-chevron 오버라이드 추가**(`html[data-theme=dark] select` background-image `stroke='%239aa3b0'`). — *style.css(시스템 전역)*
- [ ] **`--inset-ring`/`--focus-ring` 토큰화**(반복되는 `0 0 0 1px var(--accent) inset` 선택 링, 인풋 box-shadow vs 버튼 outline 통일). — *style.css*
- [ ] **레거시 별칭 정리**: no-op `--surface-raised` 등 오해 소지 별칭 검토. — *style.css*
- [ ] **콘솔 블록 토큰화**: `pre.md-code`/editor 콘솔을 `--console-bg`/`--console-text`로. — *community, exam-prep, translate-app*
- [ ] **공유 `.badge`/`.chip` 클래스 신설** 후 bespoke pill(.ex-badge, .pill, .cmbadge, .fc-badge 등) 흡수. — *examples, create, community, filechat, study*
- [ ] **`changelog` 죽은 `.changelog-page` 클래스 정의 또는 제거; legal/static 헤더 패턴(`.app-bar` vs `.landing-nav`) 정규화**. — *changelog, examples, guide, signup*
- [ ] **`privacy` 데이터 테이블 `.table-wrapper` 래핑 + `<th scope="col">` + `<caption>`**. — *privacy*
- [ ] **`editor` `maximum-scale=1` 제거**(사용자 줌 허용). — *editor*

## 9. P0 적용 이력 (2026-06-26)

베이스라인(§1~7) 작성 직후 P0 로드맵을 일괄 적용했다. §1~7은 **감사 시점 스냅샷**으로 보존하고, 변경분은 여기서 추적한다.

**변경 파일 (12개)**

| 파일 | 핵심 변경 |
|---|---|
| `index.html` | 브랜드블루 `#243ba2` ×24 → `--accent-text`, theme-color → `#2563eb` (나머지 인라인 토큰화는 P1) |
| `admin.html` | 정적 `#243ba2`(탭 활성/보더)·theme-color → 토큰/`#2563eb` (JS 동적 버블은 P1) |
| `exam-prep.html` | 인라인+JS 하드코딩 hex 전면 토큰화, `var(--card-bg)` 제거, `.beta-pill`→`.ep-beta` |
| `community.html` | 가짜 토큰 폴백 제거, `.cm*/.lab*` raw hex → 토큰 (다크 복구) |
| `filechat.html` | 채팅 코어 가짜 토큰 폴백 제거 (다크 흰 채팅창 복구) |
| `study.html` | 플로팅/zoom/캡션 라이트 고정색 → 토큰, 포커스 링; 캔버스 JS 색 유지 |
| `translate.html` | `.card`→`.tool-card`, 모달 버튼→`.primary`/`.secondary`, 모달 인라인색→토큰 |
| `editor.html` | 상태바 `span`→접근가능 버튼, `:focus-visible`, 아이콘 `aria-label`, 줌 허용 (IDE 색 유지) |
| `create.html` | `/style.css` 링크 + `:root` 별칭(–`--bg`) + 부트스트랩 + `/theme.js` + 토글 (영구 라이트 → 테마 추종) |
| `translate-app.html` | 〃 (영구 라이트 → 테마 추종) |
| `studio.html` | 브랜드블루 `--acc` 정렬(#3b76ee/#5288f5) + `:focus-visible` (다크 IDE 유지) |
| `chat-widget.js` | 전역 위젯 `#243ba2` ×12 → `#2563eb` |

**미리보기 검증 (DEV_FAKE_AUTH 로컬, 라이트/다크)**: `create`·`translate-app` 라이트+다크 정상(영구 라이트 해소), `studio` 다크 IDE+브랜드 정렬, `exam-prep`·`community`·`filechat` 다크 복구(흰 카드/채팅창 → 다크 surface), `index` 라이트 회귀 없음, 콘솔 오류 0.

**의도적 보류(P1/P2)**: index 인라인 `style=` 103곳 전체 토큰화(P1) · admin JS 동적 영역(P1) · studio 공유시트 완전편입(P1) · legal/static 8p theme-color meta(P2) · 간격/타입 스케일 토큰 신설(P2).

---

## 10. P1 적용 + Claude Design 연동 (2026-06-26)

**P1 (멀티에이전트, 14개 팀) — 적용·검증 완료**
- **Foundation(`style.css`)**: `--radius-full`·간격 스케일 `--space-1~6`·`--pad-card`·`--focus-ring`·`--inset-ring` 토큰 추가, 다크 `select` 화살표 오버라이드, 공유 베이스 클래스 `.btn`/`.btn-primary`/`.badge`/`.chip` 신설(기존 규칙 무변경, additive).
- **메인 `index.html` 인라인 `style=` 103곳 완전 토큰화** → 다크모드 완성(잔존 hex 0, 미리보기 검증).
- **접근성 통일(구조·JS 불변, 속성 additive)**: 탭 `role=tablist/tab`+`aria-selected`(admin·exam-prep·community·studio), `role=tabpanel`(exam-prep), 동적 항목 `role=button`+키보드(exam-prep `.ct-item`), `aria-live`(exam-prep·community·studio·filechat·translate·translate-app), 모달 `role=dialog`+`aria-modal`+Esc(studio·translate 등), 아이콘 버튼 `aria-label`, placeholder→`aria-label`, 탭타깃 44px 보강, `signup` 비밀번호 토글 `tabindex=-1` 제거.
- **admin** JS 동적영역 hex→토큰(다크 동적영역 정상화). **privacy** 테이블 `<th scope>`+`<caption>`+래퍼. **legal/static** theme-color `#2563eb` 통일(`signup` 포함). **chat-widget.js** 브랜드블루 통일(P0).
- 검증: index/studio/exam-prep 라이트·다크 정상, 콘솔 오류 0, JS 동작·레이아웃 무손상. **미커밋**(working tree). ⚠ `index.html`엔 사용자의 병렬 작업(학생 인증 `verifyBanner`·로그인 라벨)이 섞여 있음 — 커밋 분리 주의. `verify-email.html`(사용자 신규 파일)은 미수정.
- 보류(P2/판단필요): exam-prep 인라인 코드색 `#b91c5c`(코드 시맨틱 토큰 부재), admin IDE 자체 테마·상태색 일부, community appeal-box 핑크.

**Claude Design 연동 (claude.ai/design)**
- 별도 베타 웹앱 `claude.ai/design`에 **"Quilo Design System"** 생성(브라우저 "Create here" 경로, 브랜드 브리프+컴포넌트 인벤토리 입력→Generate). React 17컴포넌트+라이트/다크 토큰+스펙카드 20+Quilo UI킷(dashboard·studio·translate·editor), 76파일. **비공개**(미게시).
- ⚠ 최고 충실도(실제 코드 반영)는 터미널 `/design-sync`지만 그 OAuth(`/design-login`)는 비대화형 환경에서 불가 → 브리프 기반 "proposed starting point"로 생성됨. 추후 실제 코드와 reconcile 권장.

---

## 11. 내비게이션 IA 재정리 (2026-06-26)

상단 메뉴가 **드롭다운 3 + 평면 링크 4(검정/파랑 혼재)**로 분류 기준이 섞여 있던 것을 **목적별 5개 일관 드롭다운**으로 재정리.

| 그룹 | 항목 |
|---|---|
| ① 보고서 만들기 | 화학 사전·결과, 물리 결과, 자유 + 문제집·양식 메이커(베타) |
| ② 수행평가·학습 | 수행평가 도움(베타), 공부(베타) |
| ③ 창작·코딩 | 창작 스튜디오, Quilo Code(베타), 파일 챗봇(베타) |
| ④ 도구 | 파일 변환기, 이미지·PDF 도구, 수식 변환, PDF 통번역(베타) |
| ⑤ 둘러보기 | 예시·이용 가이드·패치노트·커뮤니티 |

- **고친 것**: 보고서 기능 통합(3곳→①), '도구 모음'의 대형 AI 베타/소형 유틸 분리(②③ vs ④), 강조 역전 해소(상위 5개 동일 스타일 + 핵심 ①만 강조), 베타 배지를 드롭다운 안에서만 일관 처리.
- **구현**: `index.html`의 `.topnav`만 풀 nav 보유(`exam-prep`는 자체 헤더, 그 외는 minimal `landing-nav`). JS 훅(`data-report`·`data-dd`·베타 reveal id `navBeta*`/`navExamPrep`·로그인/계정 dd) 전부 보존, 그룹 위치·라벨만 재배치. 미리보기 검증: 데스크톱 드롭다운 토글·모바일 버거 아코디언·콘솔 오류 0.
- **후속(미적용)**: minimal `landing-nav`(examples/guide/study/translate 등 7p)는 `메인`+`도구 모음`만 있는 경량 nav — 원하면 풀 5그룹 nav로 승격(드롭다운 JS 이식 필요).

---

## 12. P2 적용 (2026-06-26) — 토큰 스케일 채우기 + 정리

**style.css 핵심(직접, replace_all)**
- 토큰 추가: `--fw-regular(400)/medium(500)/semibold(600)/bold(700)/heavy(800)`, 타입 스케일 `--fs-xs~2xl`.
- **폰트 굵기 14종 → 5종**으로 수렴(550·640·650·680·740·750·760·770·780·820·850 → 가장 가까운 `var(--fw-*)`; 600/700/800도 토큰화). `var(--fw-*)` ×66.
- **반-스텝 폰트 제거**: 11.5/12.5→12, 13.5/14.5→14, 15.5→16.
- **일회성 반경 스냅**: 10/12/13px → `var(--radius-sm/--radius)`.
- 검증: 잔존 0, 중괄호 470/470.

**페이지 10개(멀티에이전트, 3배치)**: 인라인/로컬의 잔여 굵기→토큰, 반-스텝→라운드, 일회성 반경→토큰. 색·구조·JS·간격 불변.
- ⭐ **studio 자동 보류(0 변경)**: studio는 style.css 미링크(자체 다크 IDE)라 P2 토큰이 스코프에 없음 → 적용 시 반경 0·굵기 400으로 깨짐을 에이전트가 간파하고 안전 보류. (editor도 동일 이유로 P2 대상 제외.) **교훈: 토큰 마이그레이션은 공유 시트를 링크한 페이지에만.**
- pill 통일: **채택 0**(전부 보수적 보류) — bespoke pill 대부분이 의미색(warning/danger/회색)이거나 JS 조건부 변종이라 공유 `.badge`(accent-soft)와 시각 불일치. 강제 치환 시 색/DOM 변경 위험 → 보류가 정답.
- 검증: index 라이트/다크·exam-prep 다크 정상, 콘솔 0, 깨진 토큰 아티팩트 0.

**의도적 미적용**: 간격(padding/gap/margin) 전면 스냅 — 같은 값 이름만 바꾸는 작업 + 레이아웃 변동 위험 대비 가치 낮음. `--space-*` 토큰은 정의·유지(신규 작업용), 기존 값 대량 재작성은 안 함.

---

_생성: Claude design 베이스라인 감사 · P0+P1+P2 적용·nav IA 재정리 2026-06-26 · Claude Design "Quilo Design System" 연동_
