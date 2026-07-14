"use strict";

const path = require("node:path");
const sharp = require("sharp");
const {
  AlignmentType,
  convertMillimetersToTwip,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");
const { generateHwpx } = require("../pipelines/free-report/hwpx-gen");

const MAX_IMAGE_PIXELS = Math.max(1, parseInt(process.env.IMAGE_OCR_MAX_PIXELS || "80000000", 10));
const MAX_RESULT_JSON = 4 * 1024 * 1024;
const MAX_OCR_TEXT = 600_000;
const MAX_EXTRACTED_IMAGES = 16;
const DOCX_TABLE_WIDTH = convertMillimetersToTwip(165);

class OcrExportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "OcrExportError";
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanFilename(value) {
  const base = path.basename(String(value || "scan"), path.extname(String(value || ""))) || "scan";
  return base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "scan";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function markdownToPlain(value) {
  return decodeEntities(String(value || ""))
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|tr|table)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => alt ? `[이미지: ${alt}]` : "[이미지]")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMarkdownRow(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split(/(?<!\\)\|/).map((cell) => markdownToPlain(cell.replace(/\\\|/g, "|").trim()));
}

function isSeparatorRow(line) {
  const cells = parseMarkdownRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function htmlTablesToMarkdown(value) {
  return String(value || "").replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_table, body) => {
    const rows = [];
    for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        cells.push(markdownToPlain(cellMatch[2]).replace(/\|/g, "\\|").replace(/\n+/g, " "));
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return markdownToPlain(body);
    const width = Math.max(...rows.map((row) => row.length));
    const pad = (row) => Array.from({ length: width }, (_, index) => row[index] || "");
    const header = pad(rows[0]);
    const data = rows.slice(1).map(pad);
    return `\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${data.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n`;
  });
}

function markdownToBlocks(markdown) {
  const lines = htmlTablesToMarkdown(markdown).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    const value = markdownToPlain(paragraph.join("\n"));
    if (value) blocks.push(value);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      flush();
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading) {
      flush();
      blocks.push({ subheading: markdownToPlain(heading[1]) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flush();
      const headers = parseMarkdownRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseMarkdownRow(lines[i]));
        i += 1;
      }
      i -= 1;
      blocks.push({ table: { headers, rows } });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(markdownToPlain(lines[i].replace(/^\s*[-*+]\s+/, "")));
        i += 1;
      }
      i -= 1;
      blocks.push({ list: items.filter(Boolean) });
      continue;
    }
    if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

function normalizeResult(input) {
  let result = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_RESULT_JSON) throw new OcrExportError("OCR 결과가 너무 큽니다.", 413);
    try { result = JSON.parse(input); }
    catch { throw new OcrExportError("OCR 결과 JSON을 읽을 수 없습니다."); }
  }
  if (!result || typeof result !== "object") throw new OcrExportError("먼저 이미지를 판독하세요.");
  const text = String(result.text || "").slice(0, MAX_OCR_TEXT).trim();
  if (!text) throw new OcrExportError("내보낼 OCR 텍스트가 없습니다.");
  const pages = Array.isArray(result.pages) ? result.pages.slice(0, 8).map((page) => ({
    page: Number(page?.page) || 1,
    dimensions: page?.dimensions && typeof page.dimensions === "object" ? page.dimensions : null,
    images: Array.isArray(page?.images) ? page.images.slice(0, MAX_EXTRACTED_IMAGES) : [],
  })) : [];
  return {
    text,
    pages,
    confidence: result.confidence && typeof result.confidence === "object" ? result.confidence : {},
    quality: result.quality && typeof result.quality === "object" ? result.quality : {},
  };
}

async function prepareScanImage(file) {
  const source = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || []);
  if (!source.length) throw new OcrExportError("원본 이미지가 필요합니다.");
  let rendered;
  try {
    rendered = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
      .rotate()
      .flatten({ background: "#ffffff" })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new OcrExportError(`원본 스캔 이미지를 문서용으로 준비하지 못했습니다: ${error.message}`);
  }
  return {
    buffer: rendered.data,
    width: Number(rendered.info.width) || 1,
    height: Number(rendered.info.height) || 1,
    filename: cleanFilename(file?.originalname || file?.name),
  };
}

function coordinate(image, camel, snake) {
  const value = Number(image?.[camel] ?? image?.[snake]);
  return Number.isFinite(value) ? value : null;
}

async function extractDetectedImages(scan, pages) {
  const found = [];
  const seen = new Set();
  for (const page of pages || []) {
    const pageWidth = Number(page?.dimensions?.width) || scan.width;
    const pageHeight = Number(page?.dimensions?.height) || scan.height;
    for (const image of page?.images || []) {
      if (found.length >= MAX_EXTRACTED_IMAGES) return found;
      let left = coordinate(image, "topLeftX", "top_left_x");
      let top = coordinate(image, "topLeftY", "top_left_y");
      let right = coordinate(image, "bottomRightX", "bottom_right_x");
      let bottom = coordinate(image, "bottomRightY", "bottom_right_y");
      if ([left, top, right, bottom].some((value) => value == null)) continue;
      if (Math.max(left, top, right, bottom) <= 1.01) {
        left *= pageWidth; right *= pageWidth; top *= pageHeight; bottom *= pageHeight;
      }
      const x = Math.max(0, Math.floor(left / pageWidth * scan.width));
      const y = Math.max(0, Math.floor(top / pageHeight * scan.height));
      const width = Math.min(scan.width - x, Math.ceil((right - left) / pageWidth * scan.width));
      const height = Math.min(scan.height - y, Math.ceil((bottom - top) / pageHeight * scan.height));
      if (width < 32 || height < 32 || width * height > scan.width * scan.height * 0.92) continue;
      const key = `${x}:${y}:${width}:${height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const buffer = await sharp(scan.buffer).extract({ left: x, top: y, width, height }).png({ compressionLevel: 9 }).toBuffer();
        found.push({
          buffer,
          width,
          height,
          name: String(image?.id || `추출 이미지 ${found.length + 1}`).slice(0, 120),
          annotation: String(image?.annotation || image?.image_annotation || "").slice(0, 1000),
        });
      } catch {
        // A malformed provider bbox must not prevent the document export.
      }
    }
  }
  return found;
}

function displayDimensions(width, height, maxWidth = 600, maxHeight = 780) {
  const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height), 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function docxText(value, options = {}) {
  return new TextRun({ text: markdownToPlain(value), font: "Malgun Gothic", size: options.size || 21, bold: !!options.bold });
}

function docxParagraph(value, options = {}) {
  return new Paragraph({
    heading: options.heading,
    alignment: options.alignment,
    pageBreakBefore: !!options.pageBreakBefore,
    spacing: { before: options.before || 0, after: options.after ?? 110, line: 300 },
    bullet: options.bullet,
    children: [docxText(value, options)],
  });
}

function docxTable(block) {
  const headers = block.table.headers || [];
  const rows = block.table.rows || [];
  const count = Math.max(1, headers.length, ...rows.map((row) => row.length));
  const width = Math.floor(DOCX_TABLE_WIDTH / count);
  const makeCell = (value, header = false) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, fill: "E8EEF8" } : undefined,
    margins: { top: 70, right: 70, bottom: 70, left: 70 },
    children: [new Paragraph({ children: [docxText(value, { size: 18, bold: header })] })],
  });
  return new Table({
    width: { size: DOCX_TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: Array.from({ length: count }, () => width),
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: Array.from({ length: count }, (_, i) => makeCell(headers[i] || "", true)) }),
      ...rows.map((row) => new TableRow({ children: Array.from({ length: count }, (_, i) => makeCell(row[i] || "")) })),
    ],
  });
}

function docxBlocks(blocks) {
  const out = [];
  for (const block of blocks) {
    if (typeof block === "string") out.push(docxParagraph(block));
    else if (block?.subheading) out.push(docxParagraph(block.subheading, { heading: HeadingLevel.HEADING_2, size: 24, bold: true, before: 140 }));
    else if (Array.isArray(block?.list)) block.list.forEach((item) => out.push(docxParagraph(item, { bullet: { level: 0 } })));
    else if (block?.table?.headers?.length) out.push(docxTable(block), docxParagraph(""));
  }
  return out;
}

async function generateDocxExport(scan, crops, result) {
  const scanDim = displayDimensions(scan.width, scan.height);
  const children = [
    docxParagraph(`${scan.filename} OCR`, { heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, size: 34, bold: true, after: 80 }),
    docxParagraph("원본 스캔을 시각 손실 없이 포함하고, 다음 페이지에 편집 가능한 OCR 텍스트를 제공합니다.", { alignment: AlignmentType.CENTER, size: 18, after: 180 }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new ImageRun({ data: scan.buffer, type: "png", transformation: scanDim, altText: { title: scan.filename, description: "OCR 원본 스캔", name: scan.filename } })],
    }),
    docxParagraph("OCR 텍스트", { heading: HeadingLevel.HEADING_1, pageBreakBefore: true, size: 28, bold: true, after: 140 }),
    ...docxBlocks(markdownToBlocks(result.text)),
  ];
  if (crops.length) {
    children.push(docxParagraph("감지된 원본 그림", { heading: HeadingLevel.HEADING_1, size: 28, bold: true, before: 180 }));
    crops.forEach((crop, index) => {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ data: crop.buffer, type: "png", transformation: displayDimensions(crop.width, crop.height, 500, 430) })],
      }));
      children.push(docxParagraph(`[그림 ${index + 1}] ${crop.annotation || crop.name}`, { alignment: AlignmentType.CENTER, size: 17 }));
    });
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: "Malgun Gothic", size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: convertMillimetersToTwip(14), bottom: convertMillimetersToTwip(14), left: convertMillimetersToTwip(15), right: convertMillimetersToTwip(15) } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "- ", size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: " -", size: 16 })] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

function htmlForBlocks(blocks) {
  return blocks.map((block) => {
    if (typeof block === "string") return `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`;
    if (block?.subheading) return `<h3>${escapeHtml(block.subheading)}</h3>`;
    if (Array.isArray(block?.list)) return `<ul>${block.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    if (block?.table?.headers?.length) {
      const head = `<tr>${block.table.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>`;
      const rows = block.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
    }
    return "";
  }).join("\n");
}

function generateHtmlExport(scan, crops, result) {
  const scanUrl = `data:image/png;base64,${scan.buffer.toString("base64")}`;
  const cropHtml = crops.length ? `<section><h2>감지된 원본 그림</h2><div class="gallery">${crops.map((crop, index) => `<figure><img src="data:image/png;base64,${crop.buffer.toString("base64")}" alt="${escapeHtml(crop.name)}"><figcaption>그림 ${index + 1}. ${escapeHtml(crop.annotation || crop.name)}</figcaption></figure>`).join("")}</div></section>` : "";
  const confidence = Number(result.confidence?.average);
  return Buffer.from(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(scan.filename)} OCR</title>
<style>:root{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#172033;background:#eef2f7}*{box-sizing:border-box}body{margin:0}.page{width:min(960px,calc(100% - 28px));margin:24px auto;padding:44px;background:#fff;box-shadow:0 12px 36px #17203318}h1{margin:0 0 8px;text-align:center}h2{margin-top:36px;border-bottom:2px solid #dce5f2;padding-bottom:8px}h3{margin-top:26px}p,li{line-height:1.75;white-space:pre-wrap}.meta{text-align:center;color:#667085}.scan{display:block;max-width:100%;height:auto;margin:24px auto;border:1px solid #dce2ea}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #b8c2d1;padding:7px 9px;text-align:left;vertical-align:top}th{background:#eef3fa}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.gallery figure{margin:0;padding:10px;border:1px solid #dce2ea}.gallery img{width:100%;height:auto;object-fit:contain}figcaption{margin-top:7px;color:#667085;font-size:12px}@media print{:root{background:#fff}.page{width:auto;margin:0;padding:12mm;box-shadow:none}.scan{break-after:page}}@media(max-width:640px){.page{padding:22px}}</style></head>
<body><main class="page"><h1>${escapeHtml(scan.filename)} OCR</h1><p class="meta">${Number.isFinite(confidence) ? `신뢰도 ${Math.round(confidence * 100)}% · ` : ""}원본 스캔과 편집 가능한 텍스트를 함께 보존한 자체 포함 HTML</p>
<section><h2>원본 스캔</h2><img class="scan" src="${scanUrl}" alt="${escapeHtml(scan.filename)} 원본 스캔"></section>
<section><h2>OCR 텍스트</h2>${htmlForBlocks(markdownToBlocks(result.text))}</section>${cropHtml}</main></body></html>`, "utf8");
}

function hwpxSafeBlocks(blocks) {
  return blocks.map((block) => {
    if (typeof block === "string") return block.replace(/\{\{\s*EQ/gi, "{ {EQ");
    return block;
  });
}

async function generateHwpxExport(scan, crops, result) {
  const photos = [
    { name: `${scan.filename}.png`, mimetype: "image/png", buffer: scan.buffer },
    ...crops.map((crop, index) => ({ name: `${scan.filename}-image-${index + 1}.png`, mimetype: "image/png", buffer: crop.buffer })),
  ];
  const sections = [
    { heading: "원본 스캔", blocks: [{ image: { photo_indices: [0], caption: "원본 스캔 (시각 손실 없는 PNG)" } }] },
    { heading: "OCR 텍스트", blocks: hwpxSafeBlocks(markdownToBlocks(result.text)) },
  ];
  if (crops.length) sections.push({
    heading: "감지된 원본 그림",
    blocks: [{ image: { photo_indices: crops.map((_crop, index) => index + 1), caption: "원본 스캔에서 감지한 그림", photo_captions: crops.map((crop) => crop.annotation || crop.name) } }],
  });
  return generateHwpx({
    title: `${scan.filename} OCR`,
    subtitle: "원본 스캔 + 편집 가능한 OCR 텍스트",
    font_face: "Malgun Gothic",
    __fontFace: "Malgun Gothic",
    __allowHighlights: false,
    __photos: photos,
    sections,
  });
}

async function createOcrExport(file, resultInput, format) {
  const selectedFormat = String(format || "").toLowerCase();
  if (!new Set(["docx", "hwpx", "html", "txt"]).has(selectedFormat)) {
    throw new OcrExportError("DOCX, HWPX, HTML, TXT 형식만 내보낼 수 있습니다.");
  }
  const result = normalizeResult(resultInput);
  const scan = await prepareScanImage(file);
  const crops = await extractDetectedImages(scan, result.pages);
  const outputs = {
    docx: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      build: () => generateDocxExport(scan, crops, result),
    },
    hwpx: {
      mimeType: "application/vnd.hancom.hwpx",
      build: () => generateHwpxExport(scan, crops, result),
    },
    html: { mimeType: "text/html; charset=utf-8", build: () => generateHtmlExport(scan, crops, result) },
    txt: { mimeType: "text/plain; charset=utf-8", build: async () => Buffer.from(`\uFEFF${markdownToPlain(result.text)}\n`, "utf8") },
  };
  const buffer = await outputs[selectedFormat].build();
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new OcrExportError("내보내기 파일을 생성하지 못했습니다.", 500);
  return {
    buffer,
    mimeType: outputs[selectedFormat].mimeType,
    filename: `${scan.filename}_OCR.${selectedFormat}`,
    sourceImageEmbedded: selectedFormat !== "txt",
    detectedImagesEmbedded: selectedFormat === "txt" ? 0 : crops.length,
  };
}

module.exports = {
  OcrExportError,
  createOcrExport,
  markdownToBlocks,
  markdownToPlain,
  normalizeResult,
};
