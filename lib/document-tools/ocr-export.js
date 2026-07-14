"use strict";

const path = require("node:path");
const JSZip = require("jszip");
const sharp = require("sharp");
const { generateDocx: generateFormDocx } = require("../pipelines/form-maker/docx-gen");
const { generateHwpx: generateFormHwpx } = require("../pipelines/form-maker/hwpx-gen");
const { normalizeModelLatex } = require("../pipelines/form-maker/generate");

const MAX_IMAGE_PIXELS = Math.max(1, parseInt(process.env.IMAGE_OCR_MAX_PIXELS || "80000000", 10));
const MAX_RESULT_JSON = 4 * 1024 * 1024;
const MAX_OCR_TEXT = 600_000;
const MAX_EXTRACTED_IMAGES = 16;

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

function htmlAttributeInt(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Math.max(1, Math.min(100, Number(match[1]) || 1)) : 1;
}

function parseHtmlTableToForm(value) {
  const tableMatch = String(value || "").match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;
  const parsedRows = [];
  for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const text = markdownToPlain(cellMatch[3]).replace(/\n+/g, " ").trim();
      const colspan = htmlAttributeInt(cellMatch[2], "colspan");
      const rowspan = htmlAttributeInt(cellMatch[2], "rowspan");
      const header = cellMatch[1].toLowerCase() === "th";
      cells.push({ text, colspan, rowspan, header });
    }
    if (cells.length) parsedRows.push(cells);
  }
  if (!parsedRows.length) return null;
  const simpleHeader = parsedRows[0].every((cell) => cell.header && cell.colspan === 1 && cell.rowspan === 1);
  const toCell = (cell) => {
    if (!cell.header && cell.colspan === 1 && cell.rowspan === 1) return cell.text;
    return {
      text: cell.text,
      ...(cell.colspan > 1 ? { colspan: cell.colspan } : {}),
      ...(cell.rowspan > 1 ? { rowspan: cell.rowspan } : {}),
      ...(cell.header ? { bold: true, fill: "#E8EEF8", align: "center" } : {}),
    };
  };
  return {
    type: "table",
    headers: simpleHeader ? parsedRows[0].map((cell) => cell.text) : [],
    rows: parsedRows.slice(simpleHeader ? 1 : 0).map((row) => row.map(toCell)),
    header_fill: "#E8EEF8",
  };
}

function isExamViewText(value) {
  const text = markdownToPlain(value);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return /(?:<|\[|［)\s*보기\s*(?:>|\]|］)/.test(value)
    || /^\s*보\s*기\s*$/m.test(text)
    || lines.filter((line) => /^[ㄱ-ㅎ][.．)\]]\s*/.test(line)).length >= 2;
}

function examViewBlock(value) {
  const text = markdownToPlain(value)
    .replace(/(?:<|\[|［)\s*보기\s*(?:>|\]|］)/g, "")
    .replace(/^\s*보\s*기\s*$/gm, "")
    .trim();
  const body = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return { type: "summary_box", label: "<보기>", body: body.length ? body : [""] };
}

function formBlocksFromMarkdown(markdown) {
  const out = [];
  for (const block of markdownToBlocks(markdown)) {
    if (typeof block === "string") {
      out.push(isExamViewText(block)
        ? examViewBlock(block)
        : { type: "paragraph", text: block, align: "left" });
    } else if (block?.subheading) {
      const text = String(block.subheading);
      out.push({ type: "heading", level: /^\s*\d+[.)]/.test(text) ? 2 : 1, text });
    } else if (Array.isArray(block?.list)) {
      const text = block.list.join("\n");
      if (isExamViewText(text)) out.push(examViewBlock(text));
      else block.list.forEach((item) => out.push({ type: "paragraph", text: `• ${item}`, align: "left" }));
    } else if (block?.table?.headers?.length) {
      out.push({ type: "table", headers: block.table.headers, rows: block.table.rows || [] });
    }
  }
  return out;
}

function equationMarker(value) {
  let text = String(value || "").trim();
  if (/^\{\{EQN?(?:-LATEX)?:/i.test(text)) return text;
  text = text
    .replace(/^\$\$([\s\S]*?)\$\$$/, "$1")
    .replace(/^\$([^$]*)\$$/, "$1")
    .replace(/^\\\[([\s\S]*?)\\\]$/, "$1")
    .replace(/^\\\(([\s\S]*?)\\\)$/, "$1")
    .trim()
    .replace(/\}\}/g, "} }");
  return text ? `{{EQ-LATEX:${text}}}` : "";
}

function cropKey(page, id) {
  return `${Number(page) || 1}:${String(id || "")}`;
}

function structuredBlocksFromPages(result, crops) {
  const blocks = [];
  const usedPhotos = new Set();
  const cropMap = new Map();
  crops.forEach((crop, index) => {
    cropMap.set(cropKey(crop.page, crop.sourceId), index + 1);
    if (!cropMap.has(String(crop.sourceId))) cropMap.set(String(crop.sourceId), index + 1);
  });

  (result.pages || []).forEach((page, pageIndex) => {
    if (pageIndex > 0) blocks.push({ type: "pagebreak" });
    const tables = new Map((page.tables || []).map((table) => [String(table.id), table]));
    const pageBlocks = Array.isArray(page.blocks) ? [...page.blocks].sort((a, b) => a.order - b.order) : [];
    if (!pageBlocks.length) {
      blocks.push(...formBlocksFromMarkdown(page.markdown || ""));
      return;
    }
    for (const block of pageBlocks) {
      const type = String(block.type || "text").toLowerCase();
      const content = String(block.content || "").trim();
      if (type === "header" || type === "footer") continue;
      if (type === "table") {
        const table = tables.get(String(block.tableId || ""));
        const parsed = parseHtmlTableToForm(table?.content || content);
        if (parsed) blocks.push(parsed);
        else blocks.push(...formBlocksFromMarkdown(table?.content || content));
        continue;
      }
      if (type === "image" || type === "signature") {
        const photoIndex = cropMap.get(cropKey(page.page, block.imageId)) || cropMap.get(String(block.imageId || ""));
        if (photoIndex != null) {
          usedPhotos.add(photoIndex);
          blocks.push({ type: "figure", photo_indices: [photoIndex], caption: content });
        } else if (content) {
          blocks.push({ type: "paragraph", text: content, align: "center" });
        }
        continue;
      }
      if (!content) continue;
      if (type === "title") {
        blocks.push({ type: "heading", level: /^\s*\d+[.)]/.test(content) ? 2 : 1, text: markdownToPlain(content) });
      } else if (type === "equation") {
        const equation = equationMarker(content);
        if (equation) blocks.push({ type: "paragraph", text: equation, align: "center" });
      } else if (isExamViewText(content) || type === "aside_text" && /보기/.test(content)) {
        blocks.push(examViewBlock(content));
      } else if (type === "list") {
        const plain = markdownToPlain(content);
        const lines = plain.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        (lines.length ? lines : [plain]).forEach((line) => blocks.push({ type: "paragraph", text: line, align: "left" }));
      } else {
        blocks.push({ type: "paragraph", text: markdownToPlain(content), align: type === "caption" ? "center" : "left" });
      }
    }
  });
  return { blocks, usedPhotos };
}

function buildReconstructionContent(scan, crops, result) {
  const edited = !!result.sourceText && result.sourceText !== result.text;
  const structured = edited
    ? { blocks: formBlocksFromMarkdown(result.text), usedPhotos: new Set() }
    : structuredBlocksFromPages(result, crops);
  const editableBlocks = structured.blocks.length ? structured.blocks : formBlocksFromMarkdown(result.text);
  const blocks = [
    { type: "figure", photo_indices: [0], full_page: true, caption: "" },
    { type: "pagebreak" },
    { type: "heading", level: 1, text: "편집 가능한 구조 복원본" },
    ...editableBlocks,
  ];
  const unused = crops.map((_crop, index) => index + 1).filter((index) => !structured.usedPhotos.has(index));
  if (unused.length) {
    blocks.push({ type: "heading", level: 2, text: "감지된 원본 그림" });
    unused.forEach((index) => blocks.push({
      type: "figure",
      photo_indices: [index],
      caption: crops[index - 1]?.annotation || crops[index - 1]?.name || "",
    }));
  }
  normalizeModelLatex(blocks, true, { count: 0 });
  const content = {
    doc_type: "ocr-reconstruction",
    title: "",
    __hideTitle: true,
    font_face: "Malgun Gothic",
    __fontFace: "Malgun Gothic",
    __allowHighlights: false,
    __layoutMode: "clean",
    __photos: [
      { name: `${scan.filename}.png`, mimetype: "image/png", buffer: scan.buffer },
      ...crops.map((crop, index) => ({ name: `${scan.filename}-image-${index + 1}.png`, mimetype: "image/png", buffer: crop.buffer })),
    ],
    blocks,
  };
  return { content, layoutBlocks: editableBlocks.length, editedFallback: edited };
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
  const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const pages = Array.isArray(result.pages) ? result.pages.slice(0, 8).map((page) => ({
    page: Number(page?.page) || 1,
    markdown: String(page?.markdown || "").slice(0, MAX_OCR_TEXT),
    dimensions: page?.dimensions && typeof page.dimensions === "object" ? {
      width: finite(page.dimensions.width),
      height: finite(page.dimensions.height),
      dpi: finite(page.dimensions.dpi),
    } : null,
    images: Array.isArray(page?.images) ? page.images.slice(0, MAX_EXTRACTED_IMAGES).map((image, index) => ({
      id: String(image?.id || `image-${index + 1}`).slice(0, 180),
      topLeftX: finite(image?.topLeftX ?? image?.top_left_x),
      topLeftY: finite(image?.topLeftY ?? image?.top_left_y),
      bottomRightX: finite(image?.bottomRightX ?? image?.bottom_right_x),
      bottomRightY: finite(image?.bottomRightY ?? image?.bottom_right_y),
      annotation: String(image?.annotation || image?.image_annotation || "").slice(0, 4000),
    })) : [],
    tables: Array.isArray(page?.tables) ? page.tables.slice(0, 80).map((table, index) => ({
      id: String(table?.id || table?.tableId || table?.table_id || `table-${index + 1}`).slice(0, 180),
      content: String(table?.content || table?.html || table?.markdown || "").slice(0, 300_000),
      format: String(table?.format || "").slice(0, 20),
    })) : [],
    blocks: Array.isArray(page?.blocks) ? page.blocks.slice(0, 800).map((block, index) => ({
      type: String(block?.type || "text").trim().toLowerCase().slice(0, 40),
      content: String(block?.content || "").slice(0, 120_000),
      topLeftX: finite(block?.topLeftX ?? block?.top_left_x),
      topLeftY: finite(block?.topLeftY ?? block?.top_left_y),
      bottomRightX: finite(block?.bottomRightX ?? block?.bottom_right_x),
      bottomRightY: finite(block?.bottomRightY ?? block?.bottom_right_y),
      tableId: String(block?.tableId || block?.table_id || "").slice(0, 180),
      imageId: String(block?.imageId || block?.image_id || "").slice(0, 180),
      order: Number.isFinite(Number(block?.order)) ? Number(block.order) : index,
    })) : [],
  })) : [];
  return {
    text,
    sourceText: String(result.sourceText || "").slice(0, MAX_OCR_TEXT).trim(),
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
  for (const [pageIndex, page] of (pages || []).entries()) {
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
          sourceId: String(image?.id || `image-${found.length + 1}`).slice(0, 180),
          page: Number(page?.page) || pageIndex + 1,
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

async function generateDocxExport(reconstruction) {
  return generateFormDocx(reconstruction.content);
}

function htmlForFormBlocks(blocks, photos) {
  return (blocks || []).map((block) => {
    if (!block || typeof block !== "object") return `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`;
    const type = String(block.type || "").toLowerCase();
    if (type === "heading") {
      const level = Math.max(2, Math.min(4, Number(block.level) + 1 || 2));
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
    }
    if (type === "paragraph") return `<p>${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
    if (type === "summary_box") {
      return `<aside class="exam-view"><strong>${escapeHtml(block.label || "<보기>")}</strong>${(block.body || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</aside>`;
    }
    if (type === "table") {
      const head = block.headers?.length ? `<thead><tr>${block.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>` : "";
      const rows = (block.rows || []).map((row) => `<tr>${row.map((raw) => {
        const cell = raw && typeof raw === "object" ? raw : { text: raw };
        const span = `${Number(cell.rowspan) > 1 ? ` rowspan="${Math.min(100, Number(cell.rowspan))}"` : ""}${Number(cell.colspan) > 1 ? ` colspan="${Math.min(100, Number(cell.colspan))}"` : ""}`;
        return `<td${span}>${escapeHtml(cell.text)}</td>`;
      }).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table>${head}<tbody>${rows}</tbody></table></div>`;
    }
    if (type === "figure") {
      return (block.photo_indices || []).map((index) => {
        const photo = photos[index];
        if (!photo?.buffer) return "";
        return `<figure><img src="data:image/png;base64,${photo.buffer.toString("base64")}" alt="${escapeHtml(block.caption || "OCR 그림")}">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
      }).join("");
    }
    if (type === "pagebreak") return `<div class="page-break" aria-hidden="true"></div>`;
    return "";
  }).join("\n");
}

function generateHtmlExport(scan, result, reconstruction) {
  const scanUrl = `data:image/png;base64,${scan.buffer.toString("base64")}`;
  const confidence = Number(result.confidence?.average);
  return Buffer.from(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(scan.filename)} OCR</title>
<style>:root{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#172033;background:#eef2f7}*{box-sizing:border-box}body{margin:0}.page{width:min(960px,calc(100% - 28px));margin:24px auto;padding:44px;background:#fff;box-shadow:0 12px 36px #17203318}h1{margin:0 0 8px;text-align:center}h2{margin-top:36px;border-bottom:2px solid #dce5f2;padding-bottom:8px}h3{margin-top:26px}p,li{line-height:1.75;white-space:pre-wrap}.meta{text-align:center;color:#667085}.scan{display:block;max-width:100%;height:auto;margin:24px auto;border:1px solid #dce2ea}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #19202b;padding:7px 9px;text-align:left;vertical-align:middle}th{background:#eef3fa}.exam-view{margin:18px 0;padding:14px 20px;border:1px solid #111}.exam-view>strong{display:block;text-align:center;font-size:1.08rem}.exam-view p{margin:7px 0}figure{margin:18px auto;text-align:center}figure img{max-width:100%;height:auto;object-fit:contain}figcaption{margin-top:7px;color:#667085;font-size:12px}.page-break{break-after:page;border-top:1px dashed #d2d8e2;margin:32px 0}@media print{:root{background:#fff}.page{width:auto;margin:0;padding:12mm;box-shadow:none}.scan{break-after:page}.page-break{border:0}}@media(max-width:640px){.page{padding:22px}}</style></head>
<body><main class="page"><h1>${escapeHtml(scan.filename)} OCR</h1><p class="meta">${Number.isFinite(confidence) ? `신뢰도 ${Math.round(confidence * 100)}% · ` : ""}원본 스캔과 편집 가능한 텍스트를 함께 보존한 자체 포함 HTML</p>
<section><h2>원본 스캔</h2><img class="scan" src="${scanUrl}" alt="${escapeHtml(scan.filename)} 원본 스캔"></section>
<section><h2>편집 가능한 구조 복원본</h2>${htmlForFormBlocks(reconstruction.content.blocks.slice(3), reconstruction.content.__photos)}</section></main></body></html>`, "utf8");
}

async function generateHwpxExport(reconstruction) {
  return generateFormHwpx(reconstruction.content);
}

function contentHasMergedTable(blocks) {
  return (blocks || []).some((block) => {
    if (!block || typeof block !== "object") return false;
    if (block.type === "table" && (block.rows || []).some((row) => row.some((cell) => cell && typeof cell === "object" && (Number(cell.colspan) > 1 || Number(cell.rowspan) > 1)))) return true;
    if (block.type === "columns") return (block.columns || []).some((column) => contentHasMergedTable(column));
    return false;
  });
}

function textProbe(value) {
  const candidates = markdownToPlain(value).match(/[가-힣A-Za-z0-9]{2,}/g) || [];
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

async function verifyOcrExport(buffer, format, result, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new OcrExportError("내보내기 파일이 비어 있습니다.", 500);
  const expectedImages = Number(options.expectedImages) || 0;
  const probe = textProbe(result.text);
  const merged = !!options.hasMergedTable;
  const details = { format, expectedImages, textProbe: probe, mergedTable: merged };

  if (format === "docx") {
    let zip;
    try { zip = await JSZip.loadAsync(buffer); }
    catch { throw new OcrExportError("생성된 Word 파일의 ZIP 구조가 손상되었습니다.", 500); }
    const xmlFile = zip.file("word/document.xml");
    if (!xmlFile || !zip.file("[Content_Types].xml")) throw new OcrExportError("생성된 Word 파일에 필수 문서 항목이 없습니다.", 500);
    const xml = await xmlFile.async("string");
    const media = Object.keys(zip.files).filter((name) => /^word\/media\/[^/]+$/.test(name)).length;
    if (media < expectedImages) throw new OcrExportError(`Word 이미지 검증 실패: ${expectedImages}개 중 ${media}개만 포함되었습니다.`, 500);
    if (probe && !xml.includes(probe)) throw new OcrExportError("Word 편집 텍스트 검증에 실패했습니다.", 500);
    if (/\{\{EQN?(?:-LATEX)?:|�/.test(xml)) throw new OcrExportError("Word 파일에 변환되지 않은 수식 또는 손상 문자가 남았습니다.", 500);
    if (merged && !/(?:w:gridSpan|w:vMerge)/.test(xml)) throw new OcrExportError("Word 병합 표 복원 검증에 실패했습니다.", 500);
    details.embeddedImages = media;
  } else if (format === "hwpx") {
    let zip;
    try { zip = await JSZip.loadAsync(buffer); }
    catch { throw new OcrExportError("생성된 한글 파일의 ZIP 구조가 손상되었습니다.", 500); }
    const mimetype = zip.file("mimetype");
    const previewFile = zip.file("Preview/PrvText.txt");
    const sectionNames = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/.test(name));
    if (!mimetype || !previewFile || !zip.file("Contents/content.hpf") || !sectionNames.length) throw new OcrExportError("생성된 한글 파일에 필수 패키지 항목이 없습니다.", 500);
    const mime = (await mimetype.async("string")).trim();
    if (mime !== "application/hwp+zip") throw new OcrExportError("생성된 한글 파일의 mimetype이 올바르지 않습니다.", 500);
    const preview = await previewFile.async("string");
    const sections = (await Promise.all(sectionNames.map((name) => zip.file(name).async("string")))).join("\n");
    const binaries = Object.keys(zip.files).filter((name) => /^BinData\/[^/]+$/.test(name) && !zip.files[name].dir).length;
    if (binaries < expectedImages) throw new OcrExportError(`한글 이미지 검증 실패: ${expectedImages}개 중 ${binaries}개만 포함되었습니다.`, 500);
    if (probe && !preview.includes(probe) && !sections.includes(probe)) throw new OcrExportError("한글 편집 텍스트 검증에 실패했습니다.", 500);
    if (/\{\{EQN?(?:-LATEX)?:|�/.test(preview + sections)) throw new OcrExportError("한글 파일에 변환되지 않은 수식 또는 손상 문자가 남았습니다.", 500);
    if (merged && !/(?:colSpan|rowSpan)="[2-9]\d*"/.test(sections)) throw new OcrExportError("한글 병합 표 복원 검증에 실패했습니다.", 500);
    details.embeddedImages = binaries;
  } else if (format === "html") {
    const source = buffer.toString("utf8");
    const images = (source.match(/data:image\/png;base64,/g) || []).length;
    if (!/^<!doctype html>/i.test(source) || images < expectedImages) throw new OcrExportError("HTML 이미지 또는 문서 구조 검증에 실패했습니다.", 500);
    if (probe && !source.includes(escapeHtml(probe))) throw new OcrExportError("HTML 편집 텍스트 검증에 실패했습니다.", 500);
    if (/<script\b[^>]*>\s*(?:alert|eval|document\.)/i.test(source)) throw new OcrExportError("HTML 안전성 검증에 실패했습니다.", 500);
    details.embeddedImages = images;
  } else if (format === "txt") {
    const source = buffer.toString("utf8");
    if (!source.startsWith("\uFEFF") || !source.slice(1).trim()) throw new OcrExportError("TXT UTF-8 또는 텍스트 검증에 실패했습니다.", 500);
  }
  return { passed: true, ...details };
}

async function createOcrExport(file, resultInput, format) {
  const selectedFormat = String(format || "").toLowerCase();
  if (!new Set(["docx", "hwpx", "html", "txt"]).has(selectedFormat)) {
    throw new OcrExportError("DOCX, HWPX, HTML, TXT 형식만 내보낼 수 있습니다.");
  }
  const result = normalizeResult(resultInput);
  const scan = await prepareScanImage(file);
  const crops = await extractDetectedImages(scan, result.pages);
  const reconstruction = buildReconstructionContent(scan, crops, result);
  const outputs = {
    docx: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      build: () => generateDocxExport(reconstruction),
    },
    hwpx: {
      mimeType: "application/vnd.hancom.hwpx",
      build: () => generateHwpxExport(reconstruction),
    },
    html: { mimeType: "text/html; charset=utf-8", build: () => generateHtmlExport(scan, result, reconstruction) },
    txt: { mimeType: "text/plain; charset=utf-8", build: async () => Buffer.from(`\uFEFF${markdownToPlain(result.text)}\n`, "utf8") },
  };
  let buffer;
  let verification;
  const attempts = selectedFormat === "hwpx" ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      buffer = await outputs[selectedFormat].build();
      verification = await verifyOcrExport(buffer, selectedFormat, result, {
        expectedImages: selectedFormat === "txt" ? 0 : 1 + crops.length,
        hasMergedTable: contentHasMergedTable(reconstruction.content.blocks),
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return {
    buffer,
    mimeType: outputs[selectedFormat].mimeType,
    filename: `${scan.filename}_OCR.${selectedFormat}`,
    sourceImageEmbedded: selectedFormat !== "txt",
    detectedImagesEmbedded: selectedFormat === "txt" ? 0 : crops.length,
    verification,
    layoutBlocks: reconstruction.layoutBlocks,
    editedFallback: reconstruction.editedFallback,
  };
}

module.exports = {
  OcrExportError,
  createOcrExport,
  markdownToBlocks,
  markdownToPlain,
  normalizeResult,
  parseHtmlTableToForm,
  verifyOcrExport,
};
