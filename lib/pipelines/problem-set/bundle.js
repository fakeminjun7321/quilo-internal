// 문제집 메이커 — 3종 PDF(영어 문제지·한글 문제지·해설지) 조판 + ZIP 묶음.
//
// generate.js 가 만든 content(JSON) + 첨부 자산(소스 PDF·후보 그림 버퍼)을 받아:
//   1) 각 문제의 그림을 확정(후보 버퍼 또는 page+bbox 크롭 폴백).
//   2) 해설지의 chart 는 PNG 로, image(삽화 프롬프트)는 gpt-image 로 렌더.
//   3) 영어 문제지·한글 문제지·해설지를 LaTeX 로 조판(Tectonic) — 실패 시 안전모드,
//      그래도 실패하면 그 PDF 1개만 안내 페이지로 대체(나머지는 정상 출력).
//   4) 세 PDF 를 ZIP 하나로 묶어 Buffer 로 돌려준다.
//
// 자산 파일명은 문제/해설의 **배열 인덱스**로 만든다(문제 번호 num 으로 만들면
// "1(a)"·"1.a" 가 같은 파일로 충돌). 그림은 문제 인덱스, 차트/삽화는 해설 인덱스 기준.

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { compileTex } = require("../pdf-translate/latex-pdf");
const { renderChart } = require("../chem-result/chart-gen");
const { genImage } = require("../../report-image-gen");
const { cropRegions } = require("./figures");

const FONT_DIR = path.join(__dirname, "../../fonts");
const HAS_PRETENDARD = fs.existsSync(path.join(FONT_DIR, "Pretendard-Regular.ttf"));
const MAIN_FONT = HAS_PRETENDARD ? "Pretendard-Regular.ttf" : "NanumGothic-Regular.ttf";
const BOLD_FONT = fs.existsSync(path.join(FONT_DIR, "Pretendard-Bold.ttf"))
  ? "Pretendard-Bold.ttf"
  : null;
const PS_IMAGE_MODEL =
  process.env.PROBLEMSET_IMAGE_MODEL || process.env.IMAGE_MODEL_HIGH || "gpt-image-2";
const MAX_ANSWER_IMAGES = Math.max(
  0,
  parseInt(process.env.PROBLEMSET_IMAGE_MAX || "6", 10) || 6,
);

// ── LaTeX 이스케이프 ─────────────────────────────────────────────────────────
// 전체 이스케이프(평문 전용: 제목·캡션·표 셀·번호). 수식 없음 가정.
function escPlain(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%#_{}$])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

// 모델 LaTeX(인라인 수식 $...$, 디스플레이 \[...\]/\(...\) 포함)를 신뢰하되,
// **수식 밖** 평문의 리터럴 % # & 만 이스케이프한다. 수식 안의 &(행렬·aligned 정렬),
// %, # 는 절대 건드리지 않는다 — 안 그러면 \begin{matrix} a & b \end{matrix} 가 깨진다.
function fixInlineLatex(s) {
  s = String(s == null ? "" : s).replace(/\r\n/g, "\n");
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    // 수식 구간은 통째로 보존(이스케이프 안 함).
    if (c === "$") {
      const dd = s[i + 1] === "$";
      const close = dd ? "$$" : "$";
      const j = s.indexOf(close, i + close.length);
      if (j === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, j + close.length);
      i = j + close.length;
      continue;
    }
    if (c === "\\" && (s[i + 1] === "[" || s[i + 1] === "(")) {
      const closeTok = s[i + 1] === "[" ? "\\]" : "\\)";
      const j = s.indexOf(closeTok, i + 2);
      if (j === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, j + 2);
      i = j + 2;
      continue;
    }
    // 수식 밖: 리터럴 % # & 만 이스케이프(이미 \로 이스케이프된 건 그대로).
    if ((c === "%" || c === "#" || c === "&") && s[i - 1] !== "\\") {
      out += "\\" + c;
    } else {
      out += c;
    }
    i++;
  }
  return out;
}

// 안전모드: 수식까지 전부 평문 이스케이프(컴파일 보장, 수식 서식 포기).
function safeInline(s) {
  return escPlain(s);
}

function textOf(s, safe) {
  return safe ? safeInline(s) : fixInlineLatex(s);
}

const PREAMBLE_COMMON = (extra = "") => `\\documentclass[11pt]{article}
\\usepackage{fontspec}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage[a4paper,margin=14mm]{geometry}
\\usepackage{graphicx}
\\usepackage{xcolor}
\\usepackage{array}
\\usepackage{setspace}
\\setmainfont{${MAIN_FONT}}[Path=${FONT_DIR}/${BOLD_FONT ? `, BoldFont=${BOLD_FONT}` : ", AutoFakeBold=2.5"}]
\\setlength{\\parindent}{0pt}
\\definecolor{themegreen}{HTML}{1F7A5A}
\\definecolor{themedark}{HTML}{0F3D2E}
\\definecolor{rulegray}{HTML}{C8D6CF}
\\definecolor{reconorange}{HTML}{B45309}
\\definecolor{softbg}{HTML}{F3F8F5}
\\setlength{\\emergencystretch}{3em}
${extra}`;

// 번호 배지.
function numBadge(num) {
  return `\\colorbox{themegreen}{\\textcolor{white}{\\bfseries\\,${escPlain(num)}\\,}}`;
}

// 재구성/불일치 배지.
function reconBadge() {
  return `\\,\\colorbox{reconorange}{\\textcolor{white}{\\footnotesize\\,재구성됨\\,}}`;
}
function uncertainBadge() {
  return `\\,\\colorbox{reconorange}{\\textcolor{white}{\\footnotesize\\,재확인 필요\\,}}`;
}

// 표 블록(평문 데이터) → tabular. 행은 헤더 열 수에 맞춰 빈칸으로 패딩(짧은 행이 깨짐 방지).
function tableTex(t) {
  if (!t || !Array.isArray(t.headers) || !t.headers.length) return "";
  const cols = t.headers.length;
  const spec = "|" + "l|".repeat(cols);
  const head = t.headers.map((h) => `\\textbf{${escPlain(h)}}`).join(" & ");
  const rows = (Array.isArray(t.rows) ? t.rows : [])
    .map((r) => {
      const cells = (Array.isArray(r) ? r : [r]).slice(0, cols).map((c) => escPlain(c));
      while (cells.length < cols) cells.push("");
      return cells.join(" & ");
    })
    .join(" \\\\ \\hline\n");
  const cap = t.caption || t.title;
  return (
    `\\begin{center}\\small\n\\begin{tabular}{${spec}}\\hline\n` +
    `${head} \\\\ \\hline\n${rows}${rows ? " \\\\ \\hline" : ""}\n` +
    `\\end{tabular}\n${cap ? `\\\\[2pt]{\\footnotesize ${escPlain(cap)}}` : ""}\\end{center}\n`
  );
}

// solution 블록 배열 → LaTeX.
function blocksTex(blocks, safe) {
  const arr = Array.isArray(blocks) ? blocks : blocks ? [blocks] : [];
  let out = "";
  for (const b of arr) {
    if (typeof b === "string") {
      if (b.trim()) out += `${textOf(b, safe)}\\par\\smallskip\n`;
    } else if (b && typeof b === "object") {
      if (typeof b.equation === "string" && b.equation.trim()) {
        // 수식 블록은 순수 LaTeX(계약). 신뢰모드는 raw(이스케이프 금지 — & 정렬 보존),
        // 안전모드만 평문화. compileTex 의 sanitizeUntrustedTex 가 파일 IO 위험만 차단.
        out += safe
          ? `\\texttt{${safeInline(b.equation)}}\\par\\smallskip\n`
          : `\\[ ${String(b.equation).replace(/\r\n/g, "\n")} \\]\n`;
      } else if (b.table) {
        out += tableTex(b.table);
      } else if (typeof b.subheading === "string") {
        out += `\\textbf{${textOf(b.subheading, safe)}}\\par\\smallskip\n`;
      }
    }
  }
  return out;
}

function figureTex(filename, widthFrac = 0.55, maxH = "42mm") {
  return `\\begin{center}\\includegraphics[width=${widthFrac}\\linewidth,height=${maxH},keepaspectratio]{${filename}}\\end{center}\n`;
}

// ── 문제지(영어/한글) LaTeX ─────────────────────────────────────────────────
function buildWorksheetTex({ problems, lang, nPerPage, title, figByIdx, safe }) {
  const N = Math.max(1, Math.min(12, nPerPage));
  const gapCount = N - 1;
  const subtitle = lang === "ko" ? "문제지 (한국어)" : "Worksheet (English)";
  const preamble = PREAMBLE_COMMON(`\\newdimen\\slotgap \\slotgap=3mm
\\newdimen\\slotheight
% 페이지마다 머리글(제목+구분선)이 ~18mm 차지하므로 예약 후 N등분.
\\setlength{\\slotheight}{\\dimexpr(\\textheight - ${gapCount}\\slotgap - 20mm)/${N}\\relax}
% 풀이 칸: 7mm 간격의 옅은 가로줄로 슬롯의 남은 높이를 채운다.
\\newcommand{\\ruleunit}{\\vbox to 7mm{\\vfil\\hbox to \\linewidth{\\textcolor{rulegray}{\\rule{\\linewidth}{0.12mm}}}}}
\\newcommand{\\solveruling}{\\leaders\\ruleunit\\vfill}`);

  const header = `{\\large\\bfseries\\textcolor{themedark}{${escPlain(title)}}}\\hfill{\\small\\textcolor{themegreen}{${escPlain(subtitle)}}}\\\\[1mm]\\textcolor{rulegray}{\\rule{\\linewidth}{0.5mm}}\\par\\medskip\n`;

  const slot = (p, idx) => {
    const num = numBadge(p.num);
    const recon = p.reconstructed ? reconBadge() : "";
    const body = lang === "ko" ? p.text_ko || p.text_en || "" : p.text_en || p.text_ko || "";
    let fig = "";
    const f = figByIdx.get(idx);
    if (f) fig = figureTex(f, 0.5, "40mm");
    let given = "";
    if (p.given_data && Array.isArray(p.given_data.headers)) {
      given = tableTex(p.given_data);
    }
    return `\\vbox to \\slotheight{%
\\hsize=\\linewidth
\\noindent${num}\\hspace{2mm}${recon}\\hspace{1mm}${textOf(body, safe)}\\par
${given}${fig}\\vspace{1mm}
\\solveruling
}`;
  };

  // 슬롯(\vbox)을 수직 모드에서 \nointerlineskip 으로 쌓아 글루 누적(페이지 넘침) 방지.
  let bodyTex = header;
  for (let i = 0; i < problems.length; i++) {
    bodyTex += "\\nointerlineskip\n" + slot(problems[i], i) + "\n";
    if (i === problems.length - 1) break;
    const lastOnPage = (i + 1) % N === 0;
    if (lastOnPage) {
      bodyTex += "\\newpage\n" + header;
    } else {
      bodyTex += "\\nointerlineskip\\vskip\\slotgap\n";
    }
  }

  return `${preamble}
\\begin{document}\\sloppy
${bodyTex}
\\end{document}
`;
}

// ── 해설지 LaTeX ────────────────────────────────────────────────────────────
function buildAnswerTex({ answerKey, title, notes, assetByIdx, safe }) {
  const preamble = PREAMBLE_COMMON("");
  let body = `{\\LARGE\\bfseries\\textcolor{themedark}{${escPlain(title)} — 해설지}}\\par\\smallskip\\textcolor{rulegray}{\\rule{\\linewidth}{0.6mm}}\\par\\medskip\n`;

  if (Array.isArray(notes) && notes.length) {
    body += `\\colorbox{softbg}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{\\footnotesize\n`;
    body += notes.map((nt) => `\\textbullet\\ ${escPlain(nt)}`).join("\\\\\n");
    body += `\n}}\\par\\medskip\n`;
  }

  answerKey.forEach((a, idx) => {
    const num = numBadge(a.num);
    const badges = (a.reconstructed ? reconBadge() : "") + (a.uncertain ? uncertainBadge() : "");
    body += `\\noindent${num}${badges}\\par\\smallskip\n`;
    body += blocksTex(a.solution, safe);

    const asset = assetByIdx.get(idx);
    if (asset && asset.chart) {
      body += `\\begin{center}\\includegraphics[width=0.82\\linewidth,height=72mm,keepaspectratio]{${asset.chart}}\\end{center}\n`;
    }
    if (asset && asset.image) {
      body += `\\begin{center}\\includegraphics[width=0.6\\linewidth,height=60mm,keepaspectratio]{${asset.image}}`;
      if (asset.imageCaption) body += `\\\\[2pt]{\\footnotesize ${escPlain(asset.imageCaption)}}`;
      body += `\\end{center}\n`;
    }

    if (a.final_answer && String(a.final_answer).trim()) {
      body += `\\smallskip\\noindent\\textbf{정답:}\\ ${textOf(a.final_answer, safe)}\\par\n`;
    }
    body += `\\smallskip\\textcolor{rulegray}{\\rule{\\linewidth}{0.2mm}}\\par\\medskip\n`;
  });

  return `${preamble}
\\begin{document}\\sloppy
${body}
\\end{document}
`;
}

// 한 페이지 안내 PDF(조판 실패 시 그 PDF 만 대체 — 나머지는 정상 출력).
function buildPlaceholderTex(label, reason) {
  return `${PREAMBLE_COMMON("")}
\\begin{document}
{\\large\\bfseries ${escPlain(label)} 조판 실패}\\par\\medskip
이 PDF 는 조판 중 오류로 생성하지 못했습니다. 나머지 PDF 는 정상 생성되었습니다.\\par\\smallskip
{\\footnotesize ${escPlain(String(reason || "").slice(0, 200))}}\\par
\\end{document}
`;
}

// 1차(신뢰) → 안전모드 → 그래도 실패면 안내 PDF(그 PDF 만 대체, 전체 ZIP 은 살림).
async function compileResilient(buildFn, assets, { signal, onProgress, label }) {
  try {
    return await compileTex(buildFn(false), { signal, onProgress, assets });
  } catch (e1) {
    onProgress(`⚠ ${label} LaTeX 1차 실패 → 안전모드 재시도 (${String(e1.message).slice(0, 100)})`);
    try {
      return await compileTex(buildFn(true), { signal, onProgress, assets });
    } catch (e2) {
      onProgress(`⚠ ${label} 조판 실패 → 안내 페이지로 대체 (${String(e2.message).slice(0, 100)})`);
      // 안내 PDF 는 자산 없이 컴파일(자산 자체가 원인일 수 있으므로).
      return await compileTex(buildPlaceholderTex(label, e2.message), {
        signal,
        onProgress,
      });
    }
  }
}

/**
 * @param {Object} content  generate.js 산출 content (+ __sourcePdf, __candidates, __allowImageGen)
 * @param {Object} ctx      { studentId, userName, sourceFilename, signal, onProgress }
 * @returns {Promise<{buffer:Buffer, filename:string}>}
 */
async function generateBundle(content, ctx = {}) {
  const onProgress = ctx.onProgress || (() => {});
  const signal = ctx.signal;
  const problems = Array.isArray(content.problems) ? content.problems : [];
  const answerKey = Array.isArray(content.answer_key) ? content.answer_key : [];
  const title = content.title || "Problem Set";
  const nPerPage = content.per_page || 6;
  const candById = content.__candidates instanceof Map ? content.__candidates : new Map();
  const sourcePdf = content.__sourcePdf || null;

  // ── 1) 문제 그림 확정 (파일명·매핑 모두 문제 배열 인덱스 기준) ─────────────
  const assets = []; // [{name, buffer}] — .tex 옆에 쓰여 \includegraphics 가 참조
  const figByIdx = new Map(); // problemIndex → asset filename
  const cropQueue = []; // {id, idx, page, bbox}
  problems.forEach((p, idx) => {
    const f = p.figure;
    if (!f) return;
    if (f.candidate_id && candById.has(f.candidate_id)) {
      const cand = candById.get(f.candidate_id);
      if (cand && cand.buffer && cand.buffer.length) {
        const name = `figp${idx}.png`;
        assets.push({ name, buffer: cand.buffer });
        figByIdx.set(idx, name);
      }
    } else if (sourcePdf && f.page && Array.isArray(f.bbox) && f.bbox.length === 4) {
      cropQueue.push({ id: `c${idx}`, idx, page: f.page, bbox: f.bbox });
    }
  });
  if (cropQueue.length && sourcePdf) {
    try {
      onProgress(`✂ 소스에서 그림 ${cropQueue.length}개 크롭 중...`);
      const crops = await cropRegions(sourcePdf, cropQueue, { signal });
      const idxById = new Map(cropQueue.map((q) => [q.id, q.idx]));
      for (const cr of crops) {
        const idx = idxById.get(cr.id);
        if (idx == null || !cr.buffer || !cr.buffer.length) continue;
        const name = `figc${idx}.png`;
        assets.push({ name, buffer: cr.buffer });
        figByIdx.set(idx, name);
      }
    } catch (e) {
      onProgress(`⚠ 그림 크롭 실패(건너뜀): ${e.message}`);
    }
  }

  // ── 2) 해설지 chart / image 렌더 (병렬 — 인덱스별 독립) ───────────────────
  const assetByIdx = new Map(); // answerIndex → {chart, image, imageCaption}
  const entryOf = (i) => {
    let e = assetByIdx.get(i);
    if (!e) {
      e = {};
      assetByIdx.set(i, e);
    }
    return e;
  };
  const chartJobs = [];
  const imageJobs = [];
  answerKey.forEach((a, i) => {
    if (a.chart && typeof a.chart === "object") chartJobs.push({ i, spec: a.chart });
    if (
      content.__allowImageGen &&
      a.image &&
      typeof a.image.prompt === "string" &&
      a.image.prompt.trim() &&
      imageJobs.length < MAX_ANSWER_IMAGES
    ) {
      imageJobs.push({ i, image: a.image });
    }
  });
  // 차트 병렬 렌더(cap 2 — 차트 워커는 native canvas 라 동시 개수↑면 메모리↑).
  await runPool(chartJobs, 2, async (job) => {
    try {
      const png = await renderChart(job.spec);
      if (png && png.length) {
        const name = `chart${job.i}.png`;
        assets.push({ name, buffer: png });
        entryOf(job.i).chart = name;
      }
    } catch (e) {
      onProgress(`⚠ 차트 렌더 실패(${job.i + 1}번째 해설): ${e.message}`);
    }
  });
  // 삽화 병렬 생성(cap 3).
  if (imageJobs.length) {
    onProgress(`🖼 해설 삽화 ${imageJobs.length}장 생성 중(${PS_IMAGE_MODEL})...`);
    await runPool(imageJobs, 3, async (job) => {
      const prompt = `${job.image.prompt.trim().slice(0, 900)}\n\nStyle: clean educational schematic / diagram, flat vector, white background, minimal text labels. Not a photograph, not real measured data.`;
      let png = null;
      try {
        png = await genImage(prompt, { size: "1024x1024", model: PS_IMAGE_MODEL });
      } catch (e1) {
        try {
          png = await genImage(prompt, { size: "1024x1024" }); // gpt-image-1 폴백
        } catch (e2) {
          onProgress(`⚠ 삽화 생성 실패(${job.i + 1}번째 해설): ${String(e2.message).slice(0, 90)}`);
        }
      }
      if (png && png.length) {
        const name = `img${job.i}.png`;
        assets.push({ name, buffer: png });
        const e = entryOf(job.i);
        e.image = name;
        e.imageCaption = job.image.caption || "개념 도식 (AI 생성)";
      }
    });
  }

  // ── 3) 3종 PDF 컴파일 ────────────────────────────────────────────────────
  // Tectonic 은 프로세스당 메모리를 많이 쓴다(폰트·문서·이미지 로드). 3개를 동시에
  // 띄우면 큰 문서(문제 수↑·쪽수↑·그림↑)에서 인스턴스 메모리 한도를 넘어 OOM·재시작이
  // 난다. 그래서 문서가 크면 **순차(1개씩)** 로, 작으면 병렬로 조판한다. env 로 강제 가능.
  // 기본은 '순차(1개씩)'. Tectonic 은 프로세스당 기본 메모리(엔진+번들 폰트)가 ~200MB+ 로
  // 커서, 3개를 동시에 띄우면 문서 크기와 무관하게 ~800MB 까지 치솟아(실측) 인스턴스 메모리
  // 한도를 넘겨 OOM·강제 재시작이 난다. 순차면 ~330MB 로 안정적이다(실측). 메모리가 넉넉한
  // 인스턴스에서 속도를 원하면 PROBLEMSET_COMPILE_CONCURRENCY=2 또는 3 으로 올린다.
  const COMPILE_CONC = (() => {
    const env = parseInt(process.env.PROBLEMSET_COMPILE_CONCURRENCY || "", 10);
    if (Number.isFinite(env) && env > 0) return Math.min(3, env);
    return 1;
  })();
  onProgress(
    COMPILE_CONC > 1
      ? "📐 3종 PDF 동시 조판 중 (Tectonic)..."
      : "📐 3종 PDF 순차 조판 중 (메모리 절약, Tectonic)...",
  );
  const compileJobs = [
    {
      label: "영어 문제지",
      build: (safe) => buildWorksheetTex({ problems, lang: "en", nPerPage, title, figByIdx, safe }),
    },
    {
      label: "한글 문제지",
      build: (safe) => buildWorksheetTex({ problems, lang: "ko", nPerPage, title, figByIdx, safe }),
    },
    {
      label: "해설지",
      build: (safe) => buildAnswerTex({ answerKey, title, notes: content.notes, assetByIdx, safe }),
    },
  ];
  const compiled = new Array(compileJobs.length);
  await runPool(compileJobs, COMPILE_CONC, async (job, i) => {
    compiled[i] = await compileResilient(job.build, assets, {
      signal,
      onProgress,
      label: job.label,
    });
  });
  const [enPdf, koPdf, akPdf] = compiled;

  // ── 4) ZIP ───────────────────────────────────────────────────────────────
  onProgress("📦 3개 PDF를 ZIP으로 묶는 중...");
  const zip = new JSZip();
  zip.file("01_영어_문제지.pdf", enPdf);
  zip.file("02_한글_문제지.pdf", koPdf);
  zip.file("03_해설지.pdf", akPdf);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const base = sanitizeName(ctx.sourceFilename || title) || "문제집";
  const filename = `${base}_문제지·해설지.zip`;
  return { buffer, filename };
}

// 간단 동시성 풀(결과·중단 불필요 — 차트/삽화 렌더용). 각 작업은 자체 try/catch.
async function runPool(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      await fn(list[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker),
  );
}

function sanitizeName(s) {
  return String(s || "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60)
    .trim();
}

module.exports = { generateBundle };
