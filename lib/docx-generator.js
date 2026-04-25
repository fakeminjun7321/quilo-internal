const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
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
  convertMillimetersToTwip,
} = require("docx");
const { parseRichText, stripMarkers } = require("./parser");
const sizeOf = require("image-size");

const FONT = "Malgun Gothic";

// 이미지 가로 폭: 본문 영역(약 160mm)의 50~60% → 약 90mm
// 96 DPI 기준 90mm ≈ 340px. 비율에 맞게 height 자동.
const IMAGE_TARGET_WIDTH_PX = 340;
const IMAGE_MAX_HEIGHT_PX = 380;
const IMAGE_FALLBACK_HEIGHT_PX = 240;

function getImageDimensions(buffer) {
  try {
    const dim = sizeOf(buffer);
    if (dim && dim.width && dim.height) {
      const aspect = dim.height / dim.width;
      let w = IMAGE_TARGET_WIDTH_PX;
      let h = Math.round(w * aspect);
      if (h > IMAGE_MAX_HEIGHT_PX) {
        h = IMAGE_MAX_HEIGHT_PX;
        w = Math.round(h / aspect);
      }
      return { width: w, height: h };
    }
  } catch {
    /* fall through */
  }
  return { width: IMAGE_TARGET_WIDTH_PX, height: IMAGE_FALLBACK_HEIGHT_PX };
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
    p("온도/기압 : /", { align: AlignmentType.RIGHT, size: 22, spaceAfter: 200 }),
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

function buildTheory(theory = []) {
  const out = [];
  out.push(p("2. 이론적 배경과 원리", { bold: true, size: 32, spaceAfter: 120 }));
  theory.forEach((section, sIdx) => {
    const krLetter = KR_NUM[sIdx] || `${sIdx + 1}`;
    out.push(p(`${krLetter}. ${section.topic || ""}`, { bold: true, size: 26, spaceAfter: 80 }));

    const items = section.items || section.paragraphs || [];
    items.forEach((para, pIdx) => {
      out.push(
        p(`(${pIdx + 1}) ${para}`, {
          size: 22,
          indent: { left: convertMillimetersToTwip(5) },
          spaceAfter: 100,
        }),
      );
    });

    // Inline figure placeholders associated with this theory section
    (section.figures || []).forEach((fig) => {
      out.push(
        p(`[그림 ${fig.number}] ${fig.caption || ""}`, {
          align: AlignmentType.CENTER,
          italic: true,
          size: 20,
          spaceAfter: 120,
        }),
      );
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
    const detail = [
      ch.molar_mass ? `몰질량: ${ch.molar_mass}` : "",
      ch.mp_bp ? `녹는점/끓는점: ${ch.mp_bp}` : "",
      ch.density ? `밀도: ${ch.density}` : "",
      ch.properties ? `주요 특성: ${ch.properties}` : "",
      ch.toxicity ? `독성/취급: ${ch.toxicity}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
    out.push(
      p(detail, {
        size: 22,
        indent: { left: convertMillimetersToTwip(10) },
        spaceAfter: 100,
      }),
    );
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

// ── Figures-needed appendix ──────────────────────────────────────────────────

function buildFiguresNeeded(figures = []) {
  if (!figures || figures.length === 0) return [];
  const out = [];
  const hasAnyImage = figures.some((f) => f._image && f._image.buffer);
  out.push(emptyP());
  out.push(
    p(hasAnyImage ? "📷 그림 모음" : "📷 필요한 그림 목록", {
      bold: true,
      size: 26,
      spaceAfter: 100,
    }),
  );
  figures.forEach((fig) => {
    // 1) 이미지가 있으면 중앙정렬로 삽입
    if (fig._image && fig._image.buffer) {
      const dims = getImageDimensions(fig._image.buffer);
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new ImageRun({
              data: fig._image.buffer,
              transformation: { width: dims.width, height: dims.height },
            }),
          ],
        }),
      );

      // 2) 캡션 (중앙정렬)
      out.push(
        p(`[그림 ${fig.number}] ${fig.caption || ""}`, {
          align: AlignmentType.CENTER,
          bold: true,
          size: 20,
          spaceAfter: 20,
        }),
      );

      // 3) 출처 표기 (중앙정렬, 작게)
      const src = fig._image.source;
      let attribution = "";
      if (src === "nano-banana") {
        attribution = "출처: Google AI Studio로 생성";
      } else if (src === "search") {
        attribution = `출처: ${fig._image.displayLink || "웹 검색"}`;
      }
      if (attribution) {
        out.push(
          p(attribution, {
            align: AlignmentType.CENTER,
            italic: true,
            size: 18,
            spaceAfter: 120,
          }),
        );
      }
    } else {
      // 이미지 없음 — 기존 placeholder 동작
      out.push(
        p(`[그림 ${fig.number}] ${fig.caption || ""}`, {
          bold: true,
          size: 22,
          spaceAfter: 40,
        }),
      );
      if (fig.description) {
        out.push(
          p(fig.description, {
            size: 20,
            indent: { left: convertMillimetersToTwip(5) },
            spaceAfter: 80,
          }),
        );
      }
    }
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
  const sectionChildren = [
    ...buildHeader(content),
    ...buildPurpose(content.purpose || []),
    ...buildTheory(content.theory || []),
    ...buildApparatusAndChemicals(content),
    ...buildProcedure(content.procedure || []),
  ];

  // NOTE: data_table은 docx 출력에서 제외 (나중에 별도 엑셀 추출용으로만 사용)
  // 필요 시 buildDataSection(content.data_table)을 다시 활성화

  sectionChildren.push(...buildFiguresNeeded(content.figures_needed || []));

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
