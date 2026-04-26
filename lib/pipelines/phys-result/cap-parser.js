// PASCO Capstone (.cap) 파일 파서 (Node 구현).
// .cap = ZIP 아카이브:
//   ├── main.xml         (실험 전체 정보, Workbook 페이지, 센서, 텍스트)
//   ├── data/Z_*.tmp     (little-endian double 배열, 측정값)
//   └── images/*.png     (캡스톤 내장 이미지)

const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");

// ── HTML utilities ─────────────────────────────────────────────────────────
function htmlUnescape(s) {
  if (!s) return "";
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&nbsp;/g, " ");
}

function stripHtml(s) {
  if (!s) return "";
  // <br>, <p> 등 블록 태그를 줄바꿈으로
  return String(s)
    .replace(/<\s*\/?\s*(p|div|br|li|tr|h[1-6])\s*[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── XML helpers ────────────────────────────────────────────────────────────
// fast-xml-parser는 element를 nested object로 만듦.
// `iterAll(root, "WorkbookPage")` 형태로 깊이 순회 (Python의 iter()와 동등)
function* iterAll(node, tagName) {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === tagName) {
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) yield v;
    }
    if (typeof value === "object") {
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) yield* iterAll(v, tagName);
    }
  }
}

// XML 속성 가져오기 (fast-xml-parser는 기본적으로 @_ 접두사 붙임)
function attr(node, name) {
  if (!node) return "";
  return node[`@_${name}`] || "";
}

// ── Main parse ─────────────────────────────────────────────────────────────
async function parseCap(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  // 1) main.xml 추출
  const mainXmlFile = zip.file("main.xml");
  if (!mainXmlFile) {
    throw new Error(".cap 파일 안에 main.xml이 없습니다.");
  }
  const xmlString = await mainXmlFile.async("string");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: false,
  });
  let xmlDoc;
  try {
    xmlDoc = parser.parse(xmlString);
  } catch (e) {
    throw new Error(`main.xml 파싱 실패: ${e.message}`);
  }

  const result = {
    pages: [],
    sensors: [],
    text_content: {},
    data_sources: [],
    datasets: {},
    images: [],
  };

  // 2) WorkbookPage 목록
  for (const wp of iterAll(xmlDoc, "WorkbookPage")) {
    const name = String(attr(wp, "Name") || "").trim();
    if (name && !result.pages.includes(name)) result.pages.push(name);
  }

  // 3) Sensor 정보
  for (const sensor of iterAll(xmlDoc, "Sensor")) {
    const measurements = [];
    for (const m of iterAll(sensor, "Measurement")) {
      const mname = String(attr(m, "Name") || "");
      if (mname && !mname.startsWith("?")) {
        measurements.push({
          name: mname,
          id: attr(m, "ID"),
          euid: attr(m, "EUID"),
        });
      }
    }
    const sname = String(attr(sensor, "Name") || "");
    if (sname) {
      result.sensors.push({
        name: sname,
        id: attr(sensor, "ID"),
        sample_period: attr(sensor, "SamplePeriod"),
        measurements,
      });
    }
  }

  // 4) 텍스트 콘텐츠 (페이지별 CSTextEdit + DisplayTitle)
  for (const wp of iterAll(xmlDoc, "WorkbookPage")) {
    const pageName = String(attr(wp, "Name") || "").trim();
    if (!pageName) continue;
    const texts = [];

    for (const te of iterAll(wp, "CSTextEdit")) {
      const rawHtml = attr(te, "HTML");
      if (!rawHtml) continue;
      const decoded = htmlUnescape(rawHtml);
      const text = stripHtml(decoded);
      if (text && text.length > 10) texts.push(text);
    }

    for (const dt of iterAll(wp, "DisplayTitle")) {
      const raw = attr(dt, "DisplayTitleText");
      if (!raw) continue;
      const decoded = htmlUnescape(raw);
      const text = stripHtml(decoded);
      if (text && text.length > 3 && !text.includes("Enter title here")) {
        texts.push(`[Title] ${text}`);
      }
    }

    if (texts.length) result.text_content[pageName] = texts;
  }

  // 5) DataSource 메타정보
  for (const ds of iterAll(xmlDoc, "DataSource")) {
    const name = attr(ds, "MeasurementName");
    const long_name = attr(ds, "LongName");
    if (name || long_name) {
      result.data_sources.push({
        name,
        long_name,
        type: attr(ds, "DataMeasSourceType"),
        euid: attr(ds, "EUID"),
      });
    }
  }

  // 6) data/*.tmp 측정 데이터 (binary little-endian double)
  // 안전 한도: dataset당 최대 100K 값 (사용자 측정 데이터로는 충분, 메모리 보호)
  const MAX_VALUES_PER_DATASET = 100000;
  for (const path of Object.keys(zip.files)) {
    if (!path.startsWith("data/") || !path.endsWith(".tmp")) continue;
    const file = zip.files[path];
    if (file.dir) continue;
    const buf = await file.async("nodebuffer");
    const n = Math.min(Math.floor(buf.length / 8), MAX_VALUES_PER_DATASET);
    if (n === 0) continue;
    // 유의미한 값만 추출하면서 동시에 min/max 계산 (별도 Math.min(...arr) 안 씀 — 큰 배열 stack overflow 방지)
    const valid = [];
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = buf.readDoubleLE(i * 8);
      if (Math.abs(v) > 1e-100 && Math.abs(v) < 1e100 && Number.isFinite(v)) {
        valid.push(v);
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    if (valid.length >= 3) {
      const fname = path.replace("data/", "");
      result.datasets[fname] = {
        raw_count: Math.floor(buf.length / 8), // 원래 raw count (truncate 표시용)
        valid_count: valid.length,
        truncated: Math.floor(buf.length / 8) > MAX_VALUES_PER_DATASET,
        values: valid,
        min: minV,
        max: maxV,
        sample: valid.slice(0, 10),
      };
    }
  }

  // 7) images/* 이미지 목록 (buffer 포함)
  for (const path of Object.keys(zip.files)) {
    if (!path.startsWith("images/")) continue;
    const file = zip.files[path];
    if (file.dir) continue;
    const lower = path.toLowerCase();
    if (!/\.(png|jpe?g)$/.test(lower)) continue;
    const buf = await file.async("nodebuffer");
    result.images.push({
      filename: path.replace("images/", ""),
      mime: lower.endsWith(".png") ? "image/png" : "image/jpeg",
      buffer: buf,
      size_bytes: buf.length,
    });
  }

  return result;
}

// 파싱 결과를 Claude 프롬프트용 텍스트로 요약
function summarizeForPrompt(parsed) {
  const lines = [];

  if (parsed.pages.length) {
    lines.push(`## 워크북 페이지 (${parsed.pages.length}개)`);
    parsed.pages.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  }

  if (parsed.sensors.length) {
    lines.push(`## 센서 (${parsed.sensors.length}개)`);
    for (const s of parsed.sensors) {
      lines.push(`- ${s.name} (sample_period=${s.sample_period || "N/A"})`);
      for (const m of s.measurements) {
        lines.push(`  └ ${m.name}`);
      }
    }
    lines.push("");
  }

  const tc = parsed.text_content || {};
  const pageNames = Object.keys(tc);
  if (pageNames.length) {
    lines.push(`## 페이지별 텍스트 콘텐츠`);
    for (const pname of pageNames) {
      lines.push(`### [${pname}]`);
      for (const t of tc[pname]) {
        // 너무 긴 단락은 자름 (token 절약)
        const trimmed = t.length > 800 ? t.slice(0, 800) + "..." : t;
        lines.push(trimmed);
        lines.push("");
      }
    }
  }

  const datasetKeys = Object.keys(parsed.datasets);
  if (datasetKeys.length) {
    lines.push(`## 측정 데이터 (${datasetKeys.length}개 dataset)`);
    for (const fname of datasetKeys) {
      const d = parsed.datasets[fname];
      lines.push(
        `### ${fname} — ${d.valid_count} values, range [${d.min.toExponential(4)}, ${d.max.toExponential(4)}]`,
      );
      // 처음 20개 값만 sample로
      const sample = d.values.slice(0, 20).map((v) => v.toPrecision(6)).join(", ");
      lines.push(`sample (first 20): ${sample}`);
      if (d.values.length > 20) {
        lines.push(`(전체 ${d.values.length}개 중 첫 20개만 표시)`);
      }
      lines.push("");
    }
  }

  if (parsed.images.length) {
    lines.push(`## 캡스톤 내장 이미지 (${parsed.images.length}개)`);
    parsed.images.forEach((img) => {
      lines.push(`- ${img.filename} (${Math.round(img.size_bytes / 1024)}KB)`);
    });
    lines.push("(이 이미지들은 캡스톤 내장 — 보고서엔 사용자가 별도 업로드한 실험 사진을 우선 사용)");
  }

  return lines.join("\n");
}

module.exports = { parseCap, summarizeForPrompt };
