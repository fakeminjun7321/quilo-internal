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

const FONT = "Malgun Gothic";

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
    font: FONT,
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

  return [
    p("실험 보고서", { align: AlignmentType.CENTER, bold: true, size: 40, spaceAfter: 120 }),
    p(`${titleEn} (${titleKr})`, {
      align: AlignmentType.CENTER,
      bold: true,
      size: 32,
      spaceAfter: 200,
    }),
    p(`날짜 : ${date}`, { align: AlignmentType.RIGHT, size: 22, spaceAfter: 40 }),
    p(`온도/기압 : ${content.temperature ? content.temperature + "°C" : ""} / ${content.pressure ? content.pressure + " hPa" : ""}`, {
      align: AlignmentType.RIGHT,
      size: 22,
      spaceAfter: 200,
    }),
  ];
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
          font: FONT,
          size: 18,
        }),
        new ExternalHyperlink({
          link: searchUrl,
          children: [
            new TextRun({
              text: `"${searchQuery}"`,
              font: FONT,
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
  const runs = parseRichText(text, { font: FONT, size: 20, bold });
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

function buildApparatusAndChemicals(content) {
  const out = [];
  out.push(p("3. 실험 기구 및 시약", { bold: true, size: 32, spaceAfter: 120 }));

  // 가. 실험 기구
  out.push(p("가. 실험 기구", { bold: true, size: 26, spaceAfter: 80 }));
  (content.apparatus || []).forEach((ap, idx) => {
    const enName = ap.name_en ? ` (${ap.name_en})` : "";
    out.push(
      p(`(${idx + 1}) **${ap.name || ""}**${enName}: ${ap.description || ""}`, {
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

// ── Data section (optional) ──────────────────────────────────────────────────

function buildDataSection(rows) {
  const out = [];
  out.push(p("5. 데이터 (사전보고서 양식)", { bold: true, size: 32, spaceAfter: 120 }));
  out.push(p("[표 2] 측정 및 문헌값", { bold: true, size: 22, spaceAfter: 80 }));
  const t = buildDataTable(rows);
  if (t) out.push(t);
  out.push(emptyP());
  return out;
}

// ── Footer with page number ──────────────────────────────────────────────────

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "- ", font: FONT, size: 20 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 }),
          new TextRun({ text: " -", font: FONT, size: 20 }),
        ],
      }),
    ],
  });
}

// ── Top-level builder ────────────────────────────────────────────────────────

async function generateDocx(content) {
  // 그림은 이론 본문 items 배열의 { "figure": N } 마커 위치에 인라인으로만 배치된다.
  // 별도의 "필요한 그림 목록" 섹션은 만들지 않는다.
  const sectionChildren = [
    ...buildHeader(content),
    ...buildPurpose(content.purpose || []),
    ...buildTheory(content.theory || [], content.figures_needed || []),
    ...buildApparatusAndChemicals(content),
    ...buildProcedure(content.procedure || []),
  ];

  // NOTE: data_table은 docx 출력에서 제외 (나중에 별도 엑셀 추출용으로만 사용)

  const doc = new Document({
    creator: "Chem Pre-Lab Generator",
    title: content.title_kr || "사전보고서",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
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
        footers: { default: buildFooter() },
        children: sectionChildren,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateDocx };
