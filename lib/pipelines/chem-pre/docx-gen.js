const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  ShadingType,
  WidthType,
  PageNumber,
  Header,
  Footer,
  LevelFormat,
  ExternalHyperlink,
  convertMillimetersToTwip,
} = require("docx");
const { parseRichText, stripMarkers } = require("../../parser");

const { AsyncLocalStorage } = require("async_hooks");
const { normalizeFontFace } = require("../../document-fonts");

const DEFAULT_FONT = normalizeFontFace();
const fontStorage = new AsyncLocalStorage();
function currentFont() {
  return fontStorage.getStore() || DEFAULT_FONT;
}

// ── Style helpers ────────────────────────────────────────────────────────────

function richP({ runs = [], align, indent, spaceAfter = 80 }) {
  return new Paragraph({
    alignment: align,
    spacing: { after: spaceAfter, line: 312 }, // ~1.3 line spacing
    indent,
    children: runs,
  });
}

function p(text, opts = {}) {
  const runs = parseRichText(text, {
    font: currentFont(),
    size: opts.size || 22,
    bold: opts.bold,
    italic: opts.italic,
  });
  return richP({
    runs,
    align: opts.align,
    indent: opts.indent,
    spaceAfter: opts.spaceAfter,
  });
}

function emptyP() {
  return new Paragraph({ children: [new TextRun({ text: "" })] });
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildHeader(content) {
  const titleEn = content.title_en || "";
  const titleKr = content.title_kr || "";
  const date = content.date || "";
  const stu = content.__studentInfo || {};
  const idName = [stu.studentId, stu.userName].filter(Boolean).join(" ");
  const blocks = [
    p("실험 보고서", { align: AlignmentType.CENTER, bold: true, size: 40, spaceAfter: 120 }),
    p(`${titleEn} (${titleKr})`, {
      align: AlignmentType.CENTER,
      bold: true,
      size: 32,
      spaceAfter: 200,
    }),
  ];

  if (idName) {
    blocks.push(p(idName, { align: AlignmentType.RIGHT, size: 22, spaceAfter: 40 }));
  }
  blocks.push(p(`날짜 : ${date}`, { align: AlignmentType.RIGHT, size: 22, spaceAfter: 200 }));
  return blocks;
}

function buildPurpose(items = []) {
  const out = [];
  out.push(p("1. 실험목표", { bold: true, size: 32, spaceAfter: 120 }));
  out.push(p("가. 실험목표", { bold: true, size: 26, spaceAfter: 80 }));
  items.forEach((it, idx) => {
    out.push(
      p(`(${idx + 1}) ${it}`, {
        size: 22,
        indent: { left: convertMillimetersToTwip(5) },
      }),
    );
  });
  out.push(emptyP());
  return out;
}

const KR_NUM = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];

// 점선 테두리 (그림 placeholder용)
const DASHED_BORDER = {
  top: { style: BorderStyle.DASHED, size: 6, color: "888888" },
  bottom: { style: BorderStyle.DASHED, size: 6, color: "888888" },
  left: { style: BorderStyle.DASHED, size: 6, color: "888888" },
  right: { style: BorderStyle.DASHED, size: 6, color: "888888" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
};

// 그림이 첨부되지 않은 경우의 placeholder — 점선 박스 + 검색 링크
function buildFigurePlaceholderBox(fig) {
  const caption = fig.caption || "";
  const description = fig.description || "";
  const searchQuery = fig.search_query || caption || "";
  const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchQuery)}`;

  const captionLine = `[그림 ${fig.number}] ${caption}${description ? " — " + description : ""}`;

  const cellChildren = [
    p(captionLine, {
      align: AlignmentType.CENTER,
      italic: true,
      size: 20,
      spaceAfter: 80,
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40, line: 312 },
      children: [
        new TextRun({
          text: "🔎 Google 이미지 검색: ",
          font: currentFont(),
          size: 18,
        }),
        new ExternalHyperlink({
          link: searchUrl,
          children: [
            new TextRun({
              text: `"${searchQuery}"`,
              font: currentFont(),
              size: 18,
              color: "0563C1",
              underline: {},
            }),
          ],
        }),
      ],
    }),
  ];

  const cell = new TableCell({
    children: cellChildren,
    margins: { top: 200, bottom: 200, left: 240, right: 240 },
  });

  const row = new TableRow({ children: [cell] });

  return [
    new Table({
      rows: [row],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: DASHED_BORDER,
    }),
    emptyP(),
  ];
}

// 그림 1장 분량의 paragraph 묶음 — 점선 박스 placeholder + 구글 검색 링크
function buildFigureBlock(fig) {
  return buildFigurePlaceholderBox(fig);
}

function buildTheory(theory = [], figuresNeeded = [], insertedSet = null) {
  const out = [];
  out.push(p("2. 이론적 배경과 원리", { bold: true, size: 32, spaceAfter: 120 }));

  const findFig = (n) =>
    (figuresNeeded || []).find((f) => Number(f.number) === Number(n));

  theory.forEach((section, sIdx) => {
    const krLetter = KR_NUM[sIdx] || `${sIdx + 1}`;
    out.push(p(`${krLetter}. ${section.topic || ""}`, { bold: true, size: 26, spaceAfter: 80 }));

    const items = section.items || section.paragraphs || [];
    let textCounter = 0;
    items.forEach((item) => {
      // 그림 마커: { "figure": N } 객체
      if (item && typeof item === "object" && typeof item.figure === "number") {
        const fig = findFig(item.figure);
        if (fig) {
          out.push(...buildFigureBlock(fig));
          if (insertedSet) insertedSet.add(Number(fig.number));
        } else {
          // figures_needed에 매칭되는 항목이 없으면 placeholder
          out.push(
            p(`[그림 ${item.figure}] (메타데이터 없음)`, {
              align: AlignmentType.CENTER,
              italic: true,
              size: 20,
              spaceAfter: 120,
            }),
          );
        }
      } else if (typeof item === "string") {
        textCounter++;
        out.push(
          p(`(${textCounter}) ${item}`, {
            size: 22,
            indent: { left: convertMillimetersToTwip(5) },
            spaceAfter: 100,
          }),
        );
      }
    });

    // 구식 schema 호환: section.figures 배열이 있으면 섹션 끝에 인라인 삽입
    (section.figures || []).forEach((figRef) => {
      const fullFig = findFig(figRef.number) || figRef;
      out.push(...buildFigureBlock(fullFig));
      if (insertedSet) insertedSet.add(Number(fullFig.number));
    });
  });
  out.push(emptyP());
  return out;
}

// ── Tables ───────────────────────────────────────────────────────────────────

const FULL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
};

function tableCell(text, { bold = false, shaded = false, align = AlignmentType.LEFT } = {}) {
  const runs = parseRichText(text, { font: currentFont(), size: 20, bold });
  return new TableCell({
    children: [
      new Paragraph({
        alignment: align,
        spacing: { before: 40, after: 40 },
        children: runs,
      }),
    ],
    shading: shaded
      ? { type: ShadingType.CLEAR, color: "auto", fill: "D9E2F3" }
      : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
  });
}

function buildChemicalsSummaryTable(rows = []) {
  const headers = ["시약", "화학식", "몰질량(g/mol)", "녹는점/끓는점", "주요 특성"];
  const headerRow = new TableRow({
    children: headers.map((h) =>
      tableCell(h, { bold: true, shaded: true, align: AlignmentType.CENTER }),
    ),
    tableHeader: true,
  });
  const dataRows = rows.map(
    (r) =>
      new TableRow({
        children: [
          tableCell(r.name || ""),
          tableCell(r.formula || ""),
          tableCell(r.molar_mass || "", { align: AlignmentType.CENTER }),
          tableCell(r.mp_bp || "", { align: AlignmentType.CENTER }),
          tableCell(r.properties || ""),
        ],
      }),
  );
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: FULL_BORDER,
  });
}

function buildDataTable(rows = []) {
  if (!rows || rows.length === 0) return null;
  const headerRow = new TableRow({
    children: [
      tableCell("항목", { bold: true, shaded: true, align: AlignmentType.CENTER }),
      tableCell("값", { bold: true, shaded: true, align: AlignmentType.CENTER }),
    ],
    tableHeader: true,
  });
  const dataRows = rows.map(
    (r) =>
      new TableRow({
        children: [tableCell(r.item || ""), tableCell(r.value || "")],
      }),
  );
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: FULL_BORDER,
  });
}

// ── Apparatus & Chemicals ────────────────────────────────────────────────────

function compactApparatusDescription(description) {
  let text = String(description || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  text = text
    .replace(/\s*\([^)]{32,}\)/g, "")
    .replace(/\s*\([A-Za-z][^)]{10,}\)/g, "")
    .replace(/^[A-Za-z0-9 .·()/_-]+(?:와|과|,)\s*[A-Za-z0-9 .·()/_-]+\s+등\s*/, "");

  let first = text.split(/(?<=[.!?。])\s+/)[0].trim();
  if (first.length > 58) {
    const parts = first.split(/[;；。]|,\s*|이며|하고|하여|므로|때문에| 경우| 함께| 또는/);
    if ((parts[0] || "").trim().length >= 10) first = parts[0].trim();
  }
  if (first.length > 58) {
    const cut = first.lastIndexOf(" ", 58);
    first = first.slice(0, cut >= 24 ? cut : 58).trim();
  }

  first = first.replace(/[ .。;；,，]+$/g, "");
  if (first.endsWith(" 때")) first = `${first} 사용`;
  return first ? `${first}.` : "";
}

function buildApparatusAndChemicals(content) {
  const out = [];
  out.push(p("3. 실험 기구 및 시약", { bold: true, size: 32, spaceAfter: 120 }));

  // 가. 실험 기구
  out.push(p("가. 실험 기구", { bold: true, size: 26, spaceAfter: 80 }));
  (content.apparatus || []).forEach((ap, idx) => {
    const description = compactApparatusDescription(ap.description);
    out.push(
      p(`(${idx + 1}) **${ap.name || ""}**: ${description}`, {
        size: 22,
        indent: { left: convertMillimetersToTwip(5) },
        spaceAfter: 80,
      }),
    );
  });
  out.push(emptyP());

  // 나. 시약
  out.push(p("나. 시약", { bold: true, size: 26, spaceAfter: 80 }));
  (content.chemicals || []).forEach((ch, idx) => {
    const head = `(${idx + 1}) **${ch.name || ""}** (${ch.iupac || ""}, ${ch.formula || ""})`;
    out.push(
      p(head, {
        size: 22,
        indent: { left: convertMillimetersToTwip(5) },
        spaceAfter: 40,
      }),
    );
    // 시약 속성을 한 줄에 슬래시(`/`)로 이어 붙이면 GPT 요약 같은 인상을
    // 준다는 베타테스터 피드백. 각 속성을 별도 줄로 분리해 학생이 작성한
    // 정상 보고서처럼 보이도록 한다.
    const lines = [
      ch.molar_mass ? `· 몰질량: ${ch.molar_mass}` : "",
      ch.mp_bp ? `· 녹는점/끓는점: ${ch.mp_bp}` : "",
      ch.density ? `· 밀도: ${ch.density}` : "",
      ch.properties ? `· 주요 특성: ${ch.properties}` : "",
      ch.toxicity ? `· 독성/취급: ${ch.toxicity}` : "",
    ].filter(Boolean);
    lines.forEach((line, i) => {
      out.push(
        p(line, {
          size: 22,
          indent: { left: convertMillimetersToTwip(10) },
          spaceAfter: i === lines.length - 1 ? 100 : 20,
        }),
      );
    });
  });

  // 시약 요약 표
  if ((content.chemicals_summary_table || []).length > 0) {
    out.push(emptyP());
    out.push(p("[표 1] 시약 요약", { bold: true, size: 22, spaceAfter: 80 }));
    out.push(buildChemicalsSummaryTable(content.chemicals_summary_table));
    out.push(emptyP());
  }

  return out;
}

// ── Procedure ────────────────────────────────────────────────────────────────

function buildProcedure(procedure = []) {
  const out = [];
  out.push(p("4. 실험 과정", { bold: true, size: 32, spaceAfter: 120 }));
  procedure.forEach((sec, sIdx) => {
    const krLetter = KR_NUM[sIdx] || `${sIdx + 1}`;
    out.push(
      p(`${krLetter}. ${sec.title || ""}`, { bold: true, size: 26, spaceAfter: 80 }),
    );
    (sec.steps || []).forEach((step, stIdx) => {
      // step may be a string or { text, notes: [...] }
      if (typeof step === "string") {
        out.push(
          p(`(${stIdx + 1}) ${step}`, {
            size: 22,
            indent: { left: convertMillimetersToTwip(5) },
            spaceAfter: 80,
          }),
        );
      } else if (step && typeof step === "object") {
        out.push(
          p(`(${stIdx + 1}) ${step.text || ""}`, {
            size: 22,
            indent: { left: convertMillimetersToTwip(5) },
            spaceAfter: 60,
          }),
        );
        (step.notes || []).forEach((note) => {
          out.push(
            p(`- ${note}`, {
              size: 22,
              indent: { left: convertMillimetersToTwip(10) },
              spaceAfter: 40,
            }),
          );
        });
      }
    });
    out.push(emptyP());
  });
  return out;
}

// ── Data / discussion / references (optional) ────────────────────────────────

function buildDataSection(rows, sectionNumber = 5, tableNumber = 2) {
  const out = [];
  if (!Array.isArray(rows) || rows.length === 0) return out;
  out.push(p(`${sectionNumber}. 예상 데이터`, { bold: true, size: 32, spaceAfter: 120 }));
  out.push(p(`[표 ${tableNumber}] 예상 데이터`, { bold: true, size: 22, spaceAfter: 80 }));
  const t = buildDataTable(rows);
  if (t) out.push(t);
  out.push(emptyP());
  return out;
}

function discussionItemToParts(item) {
  if (typeof item === "string") return { question: "", answer: item };
  if (item && typeof item === "object") {
    return {
      question: item.question || item.topic || item.title || "",
      answer: item.answer || item.text || item.response || "",
    };
  }
  return { question: "", answer: String(item ?? "") };
}

function buildExpectedDiscussion(items = [], sectionNumber = 6) {
  const out = [];
  if (!Array.isArray(items) || items.length === 0) return out;
  out.push(p(`${sectionNumber}. 예상 토의`, { bold: true, size: 32, spaceAfter: 120 }));
  items.forEach((item, idx) => {
    const { question, answer } = discussionItemToParts(item);
    const prefix = question ? `**${question}**: ` : "";
    out.push(
      p(`(${idx + 1}) ${prefix}${answer}`, {
        size: 22,
        indent: { left: convertMillimetersToTwip(5) },
        spaceAfter: 100,
      }),
    );
  });
  out.push(emptyP());
  return out;
}

function buildReferences(refs = []) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const out = [
    p("참고 문헌", { bold: true, size: 32, spaceAfter: 120 }),
  ];
  refs.forEach((r, idx) => {
    out.push(
      p(`[${idx + 1}] ${refToString(r)}`, {
        size: 22,
        indent: { left: convertMillimetersToTwip(5) },
        spaceAfter: 80,
      }),
    );
  });
  return out;
}

// ── Footer with page number ──────────────────────────────────────────────────

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "- ", font: currentFont(), size: 20 }),
          new TextRun({ children: [PageNumber.CURRENT], font: currentFont(), size: 20 }),
          new TextRun({ text: " -", font: currentFont(), size: 20 }),
        ],
      }),
    ],
  });
}

// ── Top-level builder ────────────────────────────────────────────────────────

// ── Minimal 스타일 빌더들 ───────────────────────────────────────────────────
// 사전보고서용 minimal 스타일 (장원석 02~07 학생 보고서 스타일을 사전보고서에 맞춤).
// "잘 만든 학생 사전보고서" 패턴: 표지·시약 표·그림 placeholder·가나다 헤더 모두 없음.
// 4~7페이지, 자연스러운 학생 보고서 스타일.

function buildMinimalHeader(content) {
  const titleEn = content.title_en || "";
  const titleKr = content.title_kr || "";
  const stu = content.__studentInfo || {};
  const idName = [stu.studentId, stu.userName].filter(Boolean).join(" ");
  const blocks = [];

  // 영문 제목 큼지막하게, 한글은 괄호로
  const titleLine = titleEn
    ? (titleKr ? `${titleEn} (${titleKr})` : titleEn)
    : (titleKr || "");
  if (titleLine) {
    blocks.push(
      p(titleLine, {
        align: AlignmentType.CENTER,
        bold: true,
        size: 32,
        spaceAfter: 60,
      }),
    );
  }

  // "학번 이름 | 날짜" 한 줄
  const headerBits = [];
  if (idName) headerBits.push(idName);
  if (content.date) headerBits.push(content.date);
  if (headerBits.length) {
    blocks.push(
      p(headerBits.join(" | "), {
        align: AlignmentType.RIGHT,
        size: 22,
        spaceAfter: 200,
      }),
    );
  }
  return blocks;
}

function buildMinimalPurpose(items = []) {
  const blocks = [
    p("1. 실험 목표", { bold: true, size: 28, spaceAfter: 80 }),
  ];
  if (items.length === 0) {
    blocks.push(p("(데이터 부족)"));
  } else if (items.length === 1) {
    blocks.push(p(items[0], { indent: { firstLine: 200 } }));
  } else {
    blocks.push(p(items.join(" "), { indent: { firstLine: 200 } }));
  }
  blocks.push(emptyP());
  return blocks;
}

function buildMinimalTheory(theory = []) {
  const blocks = [
    p("2. 이론적 배경", { bold: true, size: 28, spaceAfter: 80 }),
  ];
  theory.forEach((sec, i) => {
    blocks.push(
      p(`(${i + 1}) ${sec.topic}`, { bold: true, spaceAfter: 40 }),
    );
    const items = Array.isArray(sec.items) ? sec.items : [];
    items.forEach((item) => {
      // figure 마커는 minimal에선 무시
      if (typeof item === "string") {
        blocks.push(p(item, { indent: { left: 240, firstLine: 200 } }));
      }
    });
    blocks.push(emptyP());
  });
  if (theory.length === 0) blocks.push(p("(이론 데이터 부족)"));
  return blocks;
}

function buildMinimalApparatus(content) {
  const blocks = [
    p("3. 실험 준비물", { bold: true, size: 28, spaceAfter: 80 }),
  ];
  const apps = Array.isArray(content.apparatus) ? content.apparatus : [];
  const chems = Array.isArray(content.chemicals) ? content.chemicals : [];
  const parts = [];
  apps.forEach((a) => {
    if (a.name) parts.push(a.name);
  });
  chems.forEach((c) => {
    const formula = c.formula ? `(${c.formula})` : "";
    if (c.name) parts.push(`${c.name}${formula}`);
    else if (c.iupac) parts.push(`${c.iupac}${formula}`);
  });
  if (parts.length === 0) {
    blocks.push(p("(준비물 데이터 부족)"));
  } else {
    blocks.push(p(parts.join(", ")));
  }
  blocks.push(emptyP());
  return blocks;
}

function buildMinimalProcedure(procedure = []) {
  const blocks = [
    p("4. 실험 과정", { bold: true, size: 28, spaceAfter: 80 }),
  ];
  procedure.forEach((proc, i) => {
    if (procedure.length > 1) {
      blocks.push(
        p(`(${i + 1}) ${proc.title}`, { bold: true, spaceAfter: 40 }),
      );
    }
    const steps = Array.isArray(proc.steps) ? proc.steps : [];
    const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
    steps.forEach((step, j) => {
      const text = typeof step === "string" ? step : step.text || "";
      const marker = circled[j] || `(${j + 1})`;
      blocks.push(
        p(`${marker} ${text}`, {
          indent: { left: procedure.length > 1 ? 240 : 0 },
        }),
      );
      // notes는 들여써서 표기
      if (typeof step === "object" && Array.isArray(step.notes)) {
        step.notes.forEach((note) => {
          blocks.push(
            p(`- ${note}`, { indent: { left: 480 }, size: 20 }),
          );
        });
      }
    });
    blocks.push(emptyP());
  });
  if (procedure.length === 0) blocks.push(p("(실험 과정 데이터 부족)"));
  return blocks;
}

// Claude가 references를 문자열 대신 객체로 응답한 경우 안전하게 한 줄 문자열로 변환.
// 객체면 흔한 필드(저자/연도/제목/출판사 등)를 합쳐 문자열로, 마지막 fallback은 JSON.
function refToString(r) {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const parts = [
      r.label,
      r.author || r.authors,
      r.year || r.date,
      r.title,
      r.journal,
      r.publisher,
      r.url,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
    return JSON.stringify(r);
  }
  return String(r ?? "");
}

function buildMinimalReferences(refs = []) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return [];
  }
  const blocks = [
    p("5. 참고 문헌", { bold: true, size: 28, spaceAfter: 80 }),
  ];
  refs.forEach((r) => {
    blocks.push(p(refToString(r)));
  });
  return blocks;
}

function buildMinimalChildren(content) {
  return [
    ...buildMinimalHeader(content),
    ...buildMinimalPurpose(content.purpose || []),
    ...buildMinimalTheory(content.theory || []),
    ...buildMinimalApparatus(content),
    ...buildMinimalProcedure(content.procedure || []),
    ...buildMinimalReferences(content.references || []),
  ];
}

function buildDefaultChildren(content) {
  const hasChemTable = (content.chemicals_summary_table || []).length > 0;
  const dataRows = Array.isArray(content.data_table) ? content.data_table : [];
  const discussionItems = Array.isArray(content.expected_discussion)
    ? content.expected_discussion
    : [];
  const hasData = dataRows.length > 0;
  const dataSectionNumber = 5;
  const discussionSectionNumber = hasData ? 6 : 5;
  const dataTableNumber = hasChemTable ? 2 : 1;

  return [
    ...buildHeader(content),
    ...buildPurpose(content.purpose || []),
    ...buildTheory(content.theory || [], content.figures_needed || []),
    ...buildApparatusAndChemicals(content),
    ...buildProcedure(content.procedure || []),
    ...buildDataSection(dataRows, dataSectionNumber, dataTableNumber),
    ...buildExpectedDiscussion(discussionItems, discussionSectionNumber),
    ...buildReferences(content.references || []),
  ];
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

async function generateDocx(content) {
  return fontStorage.run(
    normalizeFontFace(content.__fontFace || content.font_face),
    () => generateDocxWithFont(content),
  );
}

async function generateDocxWithFont(content) {
  const isMinimal = content.__style === "minimal";
  const sectionChildren = isMinimal
    ? buildMinimalChildren(content)
    : buildDefaultChildren(content);

  const doc = new Document({
    creator: "Chem Pre-Lab Generator",
    title: content.title_kr || "사전보고서",
    styles: {
      default: {
        document: {
          run: { font: currentFont(), size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(25),
              right: convertMillimetersToTwip(25),
              bottom: convertMillimetersToTwip(25),
              left: convertMillimetersToTwip(25),
            },
          },
        },
        // minimal 모드는 푸터 없음 (학생 보고서 스타일)
        footers: isMinimal ? undefined : { default: buildFooter() },
        children: sectionChildren,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateDocx };
