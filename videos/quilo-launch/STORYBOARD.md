---
format: 1920x1080
message: "Quilo turns a question and scattered source files into an analyzed, structured result in one continuous workspace."
arc: "Demo Loop — question → files → analysis → data result → report → product breadth → CTA"
audience: "students and early university users doing demanding research and academic work"
mode: autonomous
language: ko-KR
duration: 45s
music: "restrained electronic pulse, approximately 104 BPM, clean and precise rather than cinematic"
---

# Quilo launch — storyboard

## Video direction

- **Palette:** `frame.md` is authoritative: white canvas, near-black text, muted gray copy, and `#215FE5` as the single active accent. Success green appears only as status text. No purple-blue AI gradients.
- **Typography:** use display/body/mono roles from `frame.md`; prompt, status, chart labels, and document copy must remain legible as product UI rather than decorative type.
- **Motion grammar:** one virtual camera follows the work. Use smooth long-tail settles, sequential reveals on the spoken cue, velocity-matched internal seams, and a static read after every payoff. No bounce by default.
- **Native surface rule:** every product screen is reconstructed as deterministic HTML/CSS/SVG from `ui-demo-data.json`; screenshots never enter the frame. The custom cursor is an actor, not browser chrome.
- **Depth:** keep at least three planes in active frames: background field, working surface, foreground cursor/status/connector layer. Important content stays inside the top 83% caption-safe area.
- **Rhythm:** Frames 1–5 continuously develop; Frame 4 gets a short data hold, Frame 5 gets the longest document read, and Frame 7 holds the brand completely still for the final two seconds.
- **Negative list:** no stock photography, no device mockup raster, no floating decorative orbs, no generic AI particles, no endless loops, no lazy breathing, no front-loaded slideshow entrance, and no independent screensaver drift.

## Frame 1 — Work should not begin in chaos

- scene: A clean prompt field types the viewer's real request while three ghosted source-file names briefly surface at the edge.
- voiceover: "자료는 흩어져 있고, 마감은 기다려주지 않습니다."
- duration: 4.5s
- poster: 3.8s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Pain validation
- beat: tension → recognition
- blueprint: typewriter-reveal (Adapt)
- asset_candidates:
- sfx: keyboard-soft, paper-tick

narrativeRole: Start in the viewer's language and make the scattered-input problem felt without showing a generic clutter montage.
keyMessage: The work begins with a simple question, not a complicated setup.

Adapt: keep the live caret and typed-line signature; the payoff is a real Quilo prompt surface instead of an abstract brand pop.

Scene 1 (0.0–1.0s): white field with only a blinking cobalt caret at upper-center; the camera is static and the frame is intentionally sparse — Centered, one dominant input plane.
Scene 2 (1.0–3.3s): `실험 자료를 분석해줘` types on character-by-character (`discrete-text-sequence` + `context-sensitive-cursor`); as the VO names scattered material, three muted filenames appear one at a time at the far edges, then clip away via velocity-matched cut-the-curve seams.
Scene 3 (3.3–4.5s): the prompt surface expands from a line into the full composer (`card-morph-anchor`); caret stops, send control gains cobalt, and the complete request holds still.

## Frame 2 — Put the work in motion

- scene: A custom cursor finishes the prompt, drags three source files into the queue, and sends the request.
- voiceover: "Quilo에 질문을 적고, 실험 파일과 논문, 수업 노트를 올리세요."
- duration: 6.5s
- poster: 5.8s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-input.html
- type: feature_showcase
- persuasion: Friction reduction
- beat: control + momentum
- blueprint: cursor-ui-demo (Reproduce)
- asset_candidates:
- sfx: cursor-tap, file-drop-soft, send-press

narrativeRole: Demonstrate that the input is ordinary and direct before any AI claim is made.
keyMessage: One prompt and the files the user already has are enough to begin.

Scene 1 (0.0–1.4s): a large reconstructed Quilo composer settles on a white canvas; custom cobalt cursor sweeps to the prompt field and finishes the final syllable — Asymmetric 70/30, composer dominant, file dock waiting on the right.
Scene 2 (1.4–4.6s): XLSX, PDF, and MD file rows travel from the foreground into the queue one by one; each drop produces a restrained status check and material UI response (`cursor-click-ripple`, `dynamic-content-sequencing`), with the camera tracking the cursor between targets (`camera-cursor-tracking`).
Scene 3 (4.6–6.5s): the cursor lands on Send, button compresses once (`press-release-spring`), the prompt and files contract toward a central Quilo hub, and the camera locks on the hub before holding.

## Frame 3 — Follow the evidence

- scene: File nodes connect into Quilo, analysis stages activate in sequence, and the camera travels through the evidence network.
- voiceover: "Quilo는 파일을 읽고, 서로 연결된 근거를 따라 분석합니다."
- duration: 7s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/03-analysis.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: curiosity → trust
- blueprint: constellation-hub (Adapt)
- asset_candidates: assets/quilo-logo.png — official Quilo Q mark staged from the resolved first-party logo
- focal: assets/quilo-logo.png
- roles: quilo-logo = cutout; file nodes = supporting; connector world = background
- sfx: connector-draw, analysis-pulse, focus-whoosh

narrativeRole: Make the invisible analysis legible as an ordered evidence flow rather than a magical AI glow.
keyMessage: Quilo connects sources before it writes conclusions.

Adapt: keep the hub-and-connectors signature but replace orbiting partner logos with the three uploaded files and four analysis states.

Scene 1 (0.0–1.5s): official Quilo mark anchors the center; XLSX, PDF, and MD nodes occupy three wide stations around it — Layered-depth with a crisp center, muted outer planes, no orbit loop.
Scene 2 (1.5–4.8s): connector paths self-draw file by file (`svg-path-draw`), then `파일 구조 확인`, `측정값 정규화`, `근거 연결`, `결과 작성` activate sequentially on the VO cues; off-focus nodes rack-blur while the active path stays sharp (`depth-of-field-blur`).
Scene 3 (4.8–7.0s): the virtual camera pushes through the Quilo hub toward the completed `결과 작성` node (`multi-phase-camera` + `coordinate-target-zoom`); outer evidence falls away, motion resolves, and the final state holds still.

## Frame 4 — Data becomes an answer

- scene: Axes draw, data points land, a fitted line appears, and the result statistic resolves beside the graph.
- voiceover: "데이터는 그래프가 되고, 핵심 결과는 숫자와 문장으로 정리됩니다."
- duration: 7s
- poster: 6.4s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/04-data.html
- type: feature_showcase
- persuasion: Quantified proof
- beat: clarity + confidence
- blueprint: dataviz-countup (Adapt)
- asset_candidates:
- sfx: axis-draw, point-ticks, result-chime

narrativeRole: Deliver the first undeniable payoff: the uploaded numbers have become a readable finding.
keyMessage: Quilo produces interpretable evidence, not a wall of generated prose.

Adapt: keep the graph-as-hero and camera landing signature; use a restrained scatter/trend analysis instead of invented performance metrics.

Scene 1 (0.0–1.3s): chart grid and axes draw on from the lower-left (`svg-path-draw`); labels `m (kg)` and `T (s)` enter only as the VO reaches data — Asymmetric 60/40 with graph as the 60% hero.
Scene 2 (1.3–3.8s): five points land in measured sequence, each with a tiny tick; the camera remains stable so the viewer reads the accumulation.
Scene 3 (3.8–5.7s): fitted line draws left-to-right, `R² 0.98` counts into a cobalt metric card (`counting-dynamic-scale`), and the finding `질량이 증가할수록 주기가 증가` reveals phrase by phrase.
Scene 4 (5.7–7.0s): accent glow blooms once behind the result (`ambient-glow-bloom`) and stops; graph, statistic, and finding hold completely still.

## Frame 5 — The result writes itself into structure

- scene: A report page composes headings, table rows, chart, evidence links, and DOCX/HWPX export states in one continuous canvas.
- voiceover: "분석이 끝나면, 표와 차트가 들어간 보고서가 한 줄씩 완성됩니다."
- duration: 8s
- poster: 7.2s
- transition_in: crossfade 0.35s
- status: animated
- src: compositions/frames/05-report.html
- type: feature_showcase
- persuasion: Outcome demonstration
- beat: relief + accomplishment
- blueprint: device-surface-showcase (Adapt)
- asset_candidates:
- sfx: document-type, row-settle, export-ready

narrativeRole: Convert the analysis payoff into the final object the viewer came for.
keyMessage: Quilo carries the evidence into a structured, editable result.

Adapt: keep the persistent product surface and state-advance signature; the hero is a floating document canvas rather than a device mockup.

Scene 1 (0.0–1.5s): a blank report page establishes in a wide central window; title and `요약` heading type in, with no browser chrome — Centered canvas at ≥60% frame width, three depth planes.
Scene 2 (1.5–4.2s): table header and rows populate one at a time (`dynamic-content-sequencing`); evidence tags arrive beside the corresponding row, never before the VO names structure.
Scene 3 (4.2–6.4s): the graph from Frame 4 transfers into its reserved document slot via a matched card morph (`card-morph-anchor`), then conclusion lines type beneath it while the camera makes one short target push and immediately settles.
Scene 4 (6.4–8.0s): `DOCX` and `HWPX` export pills change from 준비 to 완료; a green `저장됨` status appears, then the full document holds for the longest read of the film.

## Frame 6 — One workspace, beyond one report

- scene: The completed report recedes into the Quilo hub as report, translation, study, tools, and API nodes assemble around it.
- voiceover: "보고서, 번역, 학습, 개발자 도구까지. 같은 작업 공간에서 이어집니다."
- duration: 6.5s
- poster: 5.8s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/06-platform.html
- type: benefit_highlight
- persuasion: Value stacking
- beat: possibility + scale
- blueprint: constellation-hub (Adapt)
- asset_candidates: assets/quilo-logo.png — official Quilo Q mark staged from the resolved first-party logo
- focal: assets/quilo-logo.png
- roles: quilo-logo = cutout; product nodes = supporting; connector plane = background
- sfx: pullback-whoosh, node-lock, platform-resolve

narrativeRole: Broaden Quilo's identity without interrupting the demonstrated workflow or reverting to a feature grid.
keyMessage: The report workflow is one part of a wider, connected Quilo workspace.

Adapt: keep the hub-and-satellites reveal; use product capabilities as a finite constellation and end on a held system map.

Scene 1 (0.0–1.4s): the report canvas recedes into the center and compresses into the official Quilo mark (`scale-swap-transition`); camera pulls back to reveal empty positions around it.
Scene 2 (1.4–4.8s): `보고서`, `PDF 통번역`, `학습`, `브라우저 도구`, and `API` nodes assemble one by one with connector lines (`center-outward-expansion` + `svg-path-draw`), paced to the comma-separated VO cues.
Scene 3 (4.8–6.5s): the full connected workspace resolves under the line `One workspace`; camera stops, outer nodes remain finite and still, and the system holds.

## Frame 7 — Start with a question

- scene: UI elements clear, the official Quilo lockup assembles, and the URL resolves beneath a single CTA.
- voiceover: "입력부터 결과까지. What can Quilo help you create? quilolab.com."
- duration: 5.5s
- poster: 4.8s
- transition_in: blur-crossfade 0.4s
- status: animated
- src: compositions/frames/07-cta.html
- type: cta
- persuasion: Direct action
- beat: confidence → motivation
- blueprint: logo-assemble-lockup (Adapt)
- asset_candidates: assets/quilo-logo.png — official Quilo Q mark staged from the resolved first-party logo
- focal: assets/quilo-logo.png
- roles: quilo-logo = cutout; URL = supporting; CTA = supporting
- sfx: logo-draw, wordmark-settle, cta-hit

narrativeRole: Collapse the entire demonstrated workflow into one memorable next action.
keyMessage: Start at quilolab.com with the work already in front of you.

Adapt: keep the clear-stage → mark → lockup signature; omit the aggressive push-through so the trust-focused brand holds cleanly.

Scene 1 (0.0–1.2s): capability nodes clear toward the frame edges on matched velocities, leaving a clean white field; no new copy appears during the clear.
Scene 2 (1.2–3.2s): official Q mark resolves center and the `Quilo` wordmark reveals beside it; a single cobalt rule draws beneath (`svg-path-draw`), then everything settles without overshoot.
Scene 3 (3.2–5.5s): `What can Quilo help you create?` reveals above `quilolab.com`; the cobalt `Quilo 시작하기` CTA appears once, and the final lockup holds dead still for two seconds.
