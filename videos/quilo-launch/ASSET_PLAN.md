# Quilo launch — asset and build plan

## Asset strategy

This film is built from deterministic native UI, not a screenshot montage. HTML/CSS/SVG surfaces carry the product proof; the only raster brand asset is the official Quilo mark. Every state is driven by `ui-demo-data.json` so seeking and rendering remain repeatable.

## Frozen brand asset

| ID | Resolved source | Build target | Purpose | State |
| --- | --- | --- | --- | --- |
| `logo_001` | `.media/images/logo_001.png` | `capture/assets/quilo-logo.png` → `assets/quilo-logo.png` | center hub and final lockup | resolved and staged; SHA-256 identical across all three files |

Source provenance: first-party `/Users/minjun/Quilo/public/favicon.png`, 256×256 RGBA. Do not redraw or substitute it.

## Native UI component plan

| Component | Frames | Construction | Motion responsibility |
| --- | --- | --- | --- |
| Prompt composer | 1–2 | semantic HTML input shell + text caret | type-on, card morph, send press |
| File queue | 2–3 | deterministic rows from `ui-demo-data.json.files` | cursor drag, material drop state, path handoff |
| Analysis network | 3, 6 | SVG connector layer + HTML nodes + official logo | path draw, focus rack, one finite camera push/pull |
| Scatter/trend chart | 4–5 | inline SVG using fixed point coordinates | axes/point/fit-line sequential reveal, report handoff |
| Report canvas | 5 | HTML document grid, table, chart slot, export row | line-by-line construction and ready states |
| Platform constellation | 6 | five finite capability nodes | center-out expansion and held connected map |
| Brand lockup | 7 | official PNG mark + HTML wordmark and CTA | restrained assemble and static final hold |

## Audio opportunity pass

The project has seven spoken cues and six strong interaction seams, so narration, a light music bed, and tactile SFX materially improve comprehension. They are planned but intentionally not generated in this phase.

- **Voice:** Korean neutral, medium-low register, measured and human. Resolve after HeyGen sign-in or after installing a Korean-capable local TTS engine; do not synthesize with the currently missing local stack.
- **BGM:** restrained electronic pulse around 104 BPM, low harmonic density, no trailer riser and no cinematic boom. Begin sparse; add one additional rhythmic layer from Frame 3; thin back out under Frame 7.
- **SFX palette:** soft keyboard, file drop, connector draw, analysis pulse, axis draw, point ticks, document type, export-ready chime, clean whoosh, logo settle. Use one sound per meaningful state change, never every animation.
- **Ducking:** narration owns the midrange; music should duck beneath all seven lines and return only during short held reads.

Current preflight: HeyGen is not signed in; Kokoro and MusicGen dependencies are missing. Audio generation is deferred rather than silently falling back to an unsuitable voice.

## Camera continuity

The camera is one continuous idea across the film:

1. static on the typed prompt;
2. cursor-tracked within the input surface;
3. push through the Quilo analysis hub;
4. settle on the graph result;
5. short target push into the report chart, then stop;
6. pull back from report to the product constellation;
7. no camera motion after the logo resolves.

Internal seams use matched direction and speed. Between-frame transitions are owned by the storyboard and must not be duplicated inside frame compositions.

## Explicitly excluded assets

- webpage screenshots and screen recordings
- stock photography or generic student footage
- browser/device mockup PNGs
- third-party logos
- decorative AI orbs, particles, and purple gradients
- emoji standing in for product icons
- data not present in `ui-demo-data.json`

## Build readiness checklist

- [x] HyperFrames project initialized
- [x] 1920×1080 brief locked
- [x] `blue-professional` frame preset remixed to Quilo tokens
- [x] official logo resolved through media-use
- [x] deterministic UI demo content frozen
- [x] storyboard and narration script written
- [x] native UI and camera choreography specified
- [x] stage resolved logo into `capture/assets/` and `assets/`
- [ ] resolve Korean voice, BGM, and SFX after audio-provider choice
- [ ] build seven frame compositions
- [ ] assemble and run lint/check/snapshot
- [ ] obtain approval before final render

Final rendering is deliberately outside this preparation phase.
