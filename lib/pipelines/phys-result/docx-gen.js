// 일반물리학실험 결과보고서 docx 생성 (5p 강제, 1.1/1.2 구조)
//
// JSON 스키마는 chem-result와 다름:
//   { title, experiment_setup, experiments[], conclusion }
// 차트·사진은 chem-result와 동일 (chartjs-node-canvas + photo_indices)

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
  WidthType,
  ShadingType,
  Footer,
  PageNumber,
  convertMillimetersToTwip,
} = require("docx");
const sizeOf = require("image-size");
const { parseRichText } = require("../../parser");

const FONT = "Malgun Gothic";

// 5p 안에 들어가도록 차트·사진 크기 작게
const CHART_WIDTH_PX = 380;
const CHART_HEIGHT_PX = 240;
const PHOTO_TARGET_WIDTH_PX = 240;
const PHOTO_MAX_HEIGHT_PX = 280;
const PHOTO_FALLBACK_HEIGHT_PX = 180;

function getPhotoDimensions(buffer) {
  try {
    const dim = sizeOf(buffer);
    if (dim && dim.width && dim.height) {
      const aspect = dim.height / dim.width;
      let w = PHOTO_TARGET_WIDTH_PX;
      let h = Math.round(w * aspect);
      if (h > PHOTO_MAX_HEIGHT_PX) {
        h = PHOTO_MAX_HEIGHT_PX;
        w = Math.round(h / aspect);
      }
      return { width: w, height: h };
    }
  } catch {
    /* fall through */
  }
  return { width: PHOTO_TARGET_WIDTH_PX, height: PHOTO_FALLBACK_HEIGHT_PX };
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function p(text, opts = {}) {
  const runs = parseRichText(String(text ?? ""), {
    font: FONT,
    size: opts.size || 20, // 5p 강제 위해 약간 작게
    bold: opts.bold,
    italic: opts.italic,
  });
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.spaceAfter ?? 60, line: 280 }, // 행간도 약간 좁게
    indent: opts.indent,
    children: runs,
  });
}

function heading(text, opts = {}) {
  return new Paragraph({
    heading: opts.level || HeadingLevel.HEADING_1,
    spacing: { before: opts.before ?? 160, after: opts.after ?? 80 },
    children: [
      new TextRun({
        text: String(text ?? ""),
        font: FONT,
        size: opts.size || 24,
        bold: true,
      }),
    ],
  });
}

function emptyP() {
  return new Paragraph({ children: [new TextRun({ text: "" })] });
}

// 표 셀
function tableCellParagraph(text, opts = {}) {
  const runs = parseRichText(String(text ?? ""), {
    font: FONT,
    size: 18, // 작게 (5p 강제)
    bold: opts.bold,
  });
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: runs,
  });
}

function buildTable(headers, rows) {
  const headerCells = headers.map(
    (h) =>
      new TableCell({
        shading: { type: ShadingType.CLEAR, fill: "D5E8F0" },
        children: [tableCellParagraph(h, { bold: true })],
      }),
  );
  const headerRow = new TableRow({ children: headerCells, tableHeader: true });
  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [tableCellParagraph(cell)],
            }),
        ),
      }),
  );
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function buildPhotoBlocks(photoIndices, allPhotos, figCounter, captionPrefix) {
  const blocks = [];
  const indices = Array.isArray(photoIndices) ? photoIndices : [];
  for (const idx of indices) {
    const photo = allPhotos[idx];
    if (!photo) continue;
    const dim = getPhotoDimensions(photo.buffer);
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 30 },
        children: [
          new ImageRun({
            data: photo.buffer,
            transformation: { width: dim.width, height: dim.height },
          }),
        ],
      }),
    );
    figCounter.value += 1;
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: `[그림 ${figCounter.value}] ${captionPrefix || ""}`,
            font: FONT,
            size: 18,
            italic: true,
          }),
        ],
      }),
    );
  }
  return blocks;
}

function buildChartBlock(chart, figCounter) {
  const blocks = [];
  if (!chart || !chart.pngBuffer) {
    if (chart) {
      blocks.push(
        p(`[그래프] ${chart.title || ""} — 렌더 실패`, { italic: true }),
      );
    }
    return blocks;
  }
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 30 },
      children: [
        new ImageRun({
          data: chart.pngBuffer,
          transformation: {
            width: CHART_WIDTH_PX,
            height: CHART_HEIGHT_PX,
          },
        }),
      ],
    }),
  );
  figCounter.value += 1;
  const cap = `[그림 ${figCounter.value}] ${chart.title || ""}${chart.caption ? " — " + chart.caption : ""}`;
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: cap,
          font: FONT,
          size: 18,
          italic: true,
        }),
      ],
    }),
  );
  return blocks;
}

// ── 섹션 빌더 ──────────────────────────────────────────────────────────────

function buildHeader(content) {
  const blocks = [];
  // 학번·이름이 있으면 prefix로 붙임: "{학번}{이름}_{실험 제목}"
  const info = content.__studentInfo || {};
  const prefixParts = [];
  if (info.studentId) prefixParts.push(info.studentId);
  if (info.userName) prefixParts.push(info.userName);
  const prefix = prefixParts.length ? prefixParts.join("") + "_" : "";

  if (content.title) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: `${prefix}${content.title}`,
            font: FONT,
            size: 28,
            bold: true,
          }),
        ],
      }),
    );
  }
  if (content.title_en) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: content.title_en,
            font: FONT,
            size: 20,
            italic: true,
          }),
        ],
      }),
    );
  }
  if (content.date) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `날짜: ${content.date}`,
            font: FONT,
            size: 18,
          }),
        ],
      }),
    );
  }
  return blocks;
}

function buildResults(content, allPhotos, figCounter, tableCounter) {
  const blocks = [heading("1. 실험 결과")];

  // 1.1 실험 장치 및 세팅
  blocks.push(p("1.1 실험 장치 및 세팅", { bold: true, size: 22 }));
  const setup = content.experiment_setup || {};
  if (setup.description) {
    blocks.push(p(setup.description, { indent: { left: 240 } }));
  }
  blocks.push(...buildPhotoBlocks(setup.photo_indices, allPhotos, figCounter, "실험 장치"));
  blocks.push(emptyP());

  // 1.2, 1.3, ... 각 실험 파트
  const experiments = Array.isArray(content.experiments) ? content.experiments : [];
  experiments.forEach((exp, i) => {
    const subnum = `1.${i + 2}`;
    blocks.push(p(`${subnum} ${exp.name || `실험 ${i + 1}`}`, { bold: true, size: 22 }));

    if (exp.method_summary) {
      blocks.push(p(`방법: ${exp.method_summary}`, { indent: { left: 240 } }));
    }

    // 표
    if (exp.data_table?.headers && Array.isArray(exp.data_table.rows)) {
      tableCounter.value += 1;
      blocks.push(p(`[표 ${tableCounter.value}] 측정 데이터`, { indent: { left: 240 }, italic: true }));
      blocks.push(buildTable(exp.data_table.headers, exp.data_table.rows));
    }

    // 차트
    if (exp.chart) {
      blocks.push(...buildChartBlock(exp.chart, figCounter));
    }

    // 분석
    if (exp.analysis) {
      blocks.push(p(`분석: ${exp.analysis}`, { indent: { left: 240 } }));
    }

    // 사진
    blocks.push(...buildPhotoBlocks(exp.photo_indices, allPhotos, figCounter, exp.name || ""));
    blocks.push(emptyP());
  });

  return blocks;
}

function buildConclusion(content) {
  const blocks = [heading("2. 결론")];
  const c = content.conclusion || {};

  if (c.objective_recap) {
    blocks.push(p(`실험 목적: ${c.objective_recap}`));
  }
  if (c.result_summary) {
    blocks.push(p(`결과 요약: ${c.result_summary}`));
  }
  if (c.theory_connection) {
    blocks.push(p(`이론적 의미: ${c.theory_connection}`));
  }
  if (Array.isArray(c.error_analysis) && c.error_analysis.length) {
    blocks.push(p("오차 분석:", { bold: true }));
    c.error_analysis.forEach((e) => {
      blocks.push(p(`- ${e}`, { indent: { left: 240 } }));
    });
  }
  if (c.physical_meaning) {
    blocks.push(p(`물리적 의미: ${c.physical_meaning}`));
  }
  if (c.problem_solving) {
    blocks.push(p(`문제 인식·해결: ${c.problem_solving}`));
  }
  return blocks;
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

async function generateDocx(content) {
  const allPhotos = Array.isArray(content.__photos) ? content.__photos : [];
  const figCounter = { value: 0 };
  const tableCounter = { value: 0 };

  const children = [
    ...buildHeader(content),
    ...buildResults(content, allPhotos, figCounter, tableCounter),
    ...buildConclusion(content),
  ];

  // 푸터: "고 2,3 일반물리학실험  - N -"
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ["고 2,3 일반물리학실험  - ", PageNumber.CURRENT, " -"],
            font: FONT,
            size: 16,
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(20),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(20),
            },
          },
        },
        footers: { default: footer },
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateDocx };
