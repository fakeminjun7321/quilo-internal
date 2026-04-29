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

// ── data/*.tmp format detection & decoders ─────────────────────────────────
const MAX_VALUES_PER_DATASET = 200000;

// 첫 non-zero uint32(LE)로 포맷 추정.
//   1 → 12-byte record 시계열  (tag=1 = 유효 샘플)
//   2 → TLV 사용자 입력 표      (type=2 = UTF-16LE 문자열)
//   그 외 → unknown / empty
function detectTmpFormat(buf) {
  for (let off = 0; off + 4 <= buf.length; off += 4) {
    const v = buf.readUInt32LE(off);
    if (v === 1) return "timeseries";
    if (v === 2) return "userdata";
    if (v !== 0) return "unknown";
  }
  return "empty";
}

function decodeTimeseries(buf) {
  const RECORD = 12;
  const totalRecords = Math.floor(buf.length / RECORD);
  const n = Math.min(totalRecords, MAX_VALUES_PER_DATASET);
  const valid = [];
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const off = i * RECORD;
    const tag = buf.readUInt32LE(off);
    if (tag !== 1) continue;
    const v = buf.readDoubleLE(off + 4);
    if (!Number.isFinite(v)) continue;
    valid.push(v);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return {
    kind: valid.length ? "numeric" : "empty",
    raw_count: totalRecords,
    valid_count: valid.length,
    truncated: totalRecords > MAX_VALUES_PER_DATASET,
    values: valid,
    string_values: [],
    min: valid.length ? mn : 0,
    max: valid.length ? mx : 0,
    sample: valid.slice(0, 10),
  };
}

const NUMERIC_RE = /^[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?$/;

function decodeUserData(buf) {
  // 1) TLV 시퀀셜 워크. 빈 record(type=0,len=0)는 스킵.
  //    유효하지 않은 헤더가 나오면 마지막으로 본 length로 buffer 끝까지 같은
  //    크기 chunk로 잘라 디코드 (compact-repeat sub-form).
  const rawStrings = [];
  let off = 0;
  let lastLen = 0;
  while (off + 8 <= buf.length) {
    const type = buf.readUInt32LE(off);
    const length = buf.readUInt32LE(off + 4);
    if (type === 0 && length === 0) {
      off += 8;
      continue;
    }
    if (
      type === 2 &&
      length > 0 &&
      length <= 4096 &&
      length % 2 === 0 &&
      off + 8 + length <= buf.length
    ) {
      rawStrings.push(buf.toString("utf16le", off + 8, off + 8 + length));
      off += 8 + length;
      lastLen = length;
      continue;
    }
    if (lastLen > 0 && off + lastLen <= buf.length) {
      while (off + lastLen <= buf.length) {
        rawStrings.push(buf.toString("utf16le", off, off + lastLen));
        off += lastLen;
      }
    }
    break;
  }

  // 2) null/공백 정리
  const cleaned = [];
  for (const s of rawStrings) {
    const t = s.replace(/\u0000/g, "").trim();
    if (t.length > 0 && t.length < 200) cleaned.push(t);
  }

  // 3) numeric / label 분류
  const numbers = [];
  const labels = [];
  for (const s of cleaned) {
    if (NUMERIC_RE.test(s)) {
      const v = parseFloat(s);
      if (Number.isFinite(v)) numbers.push(v);
      else labels.push(s);
    } else {
      labels.push(s);
    }
  }

  let mn = Infinity;
  let mx = -Infinity;
  for (const v of numbers) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }

  let kind;
  if (numbers.length === 0 && labels.length === 0) kind = "empty";
  else if (numbers.length > 0 && labels.length === 0) kind = "numeric";
  else if (labels.length > 0 && numbers.length === 0) kind = "string";
  else kind = numbers.length >= labels.length ? "numeric" : "string";

  return {
    kind,
    raw_count: rawStrings.length,
    valid_count: numbers.length + labels.length,
    truncated: false,
    values: numbers,
    string_values: labels,
    min: numbers.length ? mn : 0,
    max: numbers.length ? mx : 0,
    sample: numbers.slice(0, 10),
  };
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

  // 5) DataSource 메타정보 + 자식 DataSet → FileName 매핑
  // PASCO Capstone에서 DataSource 안에 DataSet이 직접 들어있고, DataSet의
  // DependentStorageElement.FileName이 data/*.tmp 파일을 가리킨다. 따라서
  // FileName → DataSource.MeasurementName 매핑을 만들면 익명 dataset에
  // 의미를 부여할 수 있다.
  result.dataset_to_measurement = {}; // basename(.tmp) → measurement 메타
  for (const ds of iterAll(xmlDoc, "DataSource")) {
    const name = attr(ds, "MeasurementName");
    const long_name = attr(ds, "LongName");
    if (name || long_name) {
      result.data_sources.push({
        name,
        long_name,
        short_name: attr(ds, "ShortName"),
        type: attr(ds, "DataMeasSourceType"),
        euid: attr(ds, "EUID"),
        symbol: attr(ds, "SymbolName"),
      });
    }
    // 이 DataSource 아래 모든 DependentStorageElement.FileName 수집
    for (const dep of iterAll(ds, "DependentStorageElement")) {
      const fname = attr(dep, "FileName");
      if (fname) {
        const base = String(fname).replace(/^.*[\\/]/, "");
        result.dataset_to_measurement[base] = {
          measurement_name: name || long_name || "",
          short_name: attr(ds, "ShortName"),
          symbol: attr(ds, "SymbolName"),
          unit: attr(ds, "BaseUnit"),
          dependent: true, // Y축 (값)
        };
      }
    }
    for (const ind of iterAll(ds, "IndependentStorageElement")) {
      const fname = attr(ind, "FileName");
      if (fname) {
        const base = String(fname).replace(/^.*[\\/]/, "");
        result.dataset_to_measurement[base] = {
          measurement_name: (name || long_name || "") + " (시간축)",
          short_name: attr(ds, "ShortName"),
          symbol: "t",
          unit: "s",
          dependent: false, // X축 (시간)
        };
      }
    }
  }

  // 6) data/*.tmp 측정 데이터
  //
  // PASCO Capstone .cap의 .tmp 파일은 두 가지 포맷이 섞여 있다:
  //
  //  (A) 센서 시계열 — 12-byte record [4-byte tag, 8-byte LE double]
  //      tag=1 → 유효 샘플. 첫 4-byte가 0x00000001로 시작.
  //      예: Force/Velocity/Position 센서 측정 (Atwood, Centripetal Force 등)
  //
  //  (B) 사용자 입력 표 — TLV [4-byte type=2, 4-byte length, UTF-16LE data]
  //      Capstone 안에서 사용자가 표에 직접 입력한 값/라벨.
  //      두 sub-form:
  //       (B1) 가변 길이: [type=2,len=A,strA][type=2,len=B,strB]...
  //            예: Pendulum Type → "Disk", "Disk with Hole", ...
  //       (B2) 고정 길이 반복: [zeros][type=2,len=L][strL][strL][strL]...
  //            예: Mass → 5×"0.0632"
  //
  // 첫 4-byte로 자동 감지 후 별도 디코더로 처리. (이전엔 (A)만 알았기 때문에
  // Physical Pendulum 같이 사용자 표 위주 실험은 dataset 0개로 인식되어
  // 보고서에 측정값이 들어가지 않았다.)
  for (const path of Object.keys(zip.files)) {
    if (!path.startsWith("data/") || !path.endsWith(".tmp")) continue;
    const file = zip.files[path];
    if (file.dir) continue;
    const buf = await file.async("nodebuffer");
    const fmt = detectTmpFormat(buf);
    let decoded;
    if (fmt === "timeseries") {
      decoded = decodeTimeseries(buf);
    } else if (fmt === "userdata") {
      decoded = decodeUserData(buf);
    } else {
      continue; // empty / unknown — skip
    }
    if (!decoded || decoded.kind === "empty") continue;
    if (decoded.valid_count < 3) continue; // 노이즈 필터
    const fname = path.replace("data/", "");
    result.datasets[fname] = decoded;
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
    // 1) measurement 이름으로 그룹핑 (DataSource→FileName 매핑 사용).
    //    numeric/string은 별도 그룹으로 분리해서 따로 출력한다.
    const numericGroups = {};
    const stringGroups = {};
    for (const fname of datasetKeys) {
      const d = parsed.datasets[fname];
      const meta = (parsed.dataset_to_measurement || {})[fname] || {};
      if (meta.dependent === false) continue; // 시간축 약식
      const key = (meta.measurement_name || "(미상)").trim();
      if (d.kind === "string") {
        if (!stringGroups[key]) stringGroups[key] = [];
        stringGroups[key].push({ fname, d, meta });
      } else {
        if (!numericGroups[key]) numericGroups[key] = [];
        numericGroups[key].push({ fname, d, meta });
      }
    }

    // 2) 의미 없는 짧은 dataset (count<3)이나 절대값 항상 0인 건 스킵
    //    물리 실험은 5~6회 측정이 흔하므로 임계값 5는 너무 높다 → 3으로.
    const cleaned = {};
    for (const [name, arr] of Object.entries(numericGroups)) {
      const filtered = arr.filter(
        (x) =>
          x.d.valid_count >= 3 &&
          (Math.abs(x.d.min) > 1e-9 || Math.abs(x.d.max) > 1e-9),
      );
      if (filtered.length) cleaned[name] = filtered;
    }

    // 3) 각 measurement별 통계 (mean, std, count, min/max + 균등 sampling)
    const computeStats = (vals) => {
      let s = 0,
        s2 = 0,
        mn = Infinity,
        mx = -Infinity;
      for (const v of vals) {
        s += v;
        s2 += v * v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const n = vals.length;
      const mean = s / n;
      const variance = Math.max(0, s2 / n - mean * mean);
      return { n, mean, std: Math.sqrt(variance), min: mn, max: mx };
    };
    const sampleEvenly = (vals, k) => {
      if (vals.length <= k) return vals;
      const out = [];
      for (let i = 0; i < k; i++) {
        out.push(vals[Math.round((i * (vals.length - 1)) / (k - 1))]);
      }
      return out;
    };

    // 3-1) 캡스톤 사용자 입력 표 (가장 중요한 데이터)
    //    같은 row index = 같은 측정 회차(시편)이라는 가정 하에 column 정렬한 표.
    //    조건: single run + count 3~20 (사용자가 표에 직접 입력한 값들)
    //    → 보고서의 측정 데이터 표는 이 값들을 그대로 사용해야 함.
    const tableNumericCols = [];
    const tableStringCols = [];
    for (const [name, arr] of Object.entries(cleaned)) {
      if (arr.length !== 1) continue;
      const d = arr[0].d;
      if (d.values.length < 3 || d.values.length > 20) continue;
      // 값 변동폭이 비정상적으로 큰 column은 캡스톤 hidden/손상 column일
      // 가능성이 높음. 같은 측정량이라면 보통 ±1~10배 안. 100배 넘으면 제외.
      const absVals = d.values.map(Math.abs).filter((v) => v > 1e-12);
      if (absVals.length >= 2) {
        const mn = Math.min(...absVals);
        const mx = Math.max(...absVals);
        if (mx / mn > 100) continue;
      }
      tableNumericCols.push({ name, values: d.values });
    }
    for (const [name, arr] of Object.entries(stringGroups)) {
      // 가장 긴 dataset 사용 (사용자가 더 많이 적은 쪽이 최신)
      const best = arr.slice().sort((a, b) => (b.d.string_values?.length || 0) - (a.d.string_values?.length || 0))[0];
      const labs = best?.d?.string_values || [];
      if (labs.length < 3 || labs.length > 20) continue;
      tableStringCols.push({ name, values: labs });
    }
    if (tableNumericCols.length + tableStringCols.length >= 2) {
      // 같은 row index가 같은 시편을 가리킨다고 가정. row 수는 column 중 최댓값.
      const cols = [...tableStringCols, ...tableNumericCols]; // 라벨을 앞에 두면 가독성 좋음
      const maxRows = Math.max(...cols.map((c) => c.values.length));
      lines.push(`## 캡스톤 사용자 입력 표 (보고서 측정 데이터 표의 원본)`);
      lines.push(`⚠️ **각 행이 한 시편(측정 회차)에 해당.** 행 순서를 그대로 보고서 표에 쓰세요.`);
      lines.push(`⚠️ Ipivot/Icm 같은 계산 column은 캡스톤이 아래 값들로 자동 계산한 것 — 보고서에선 직접 다시 계산하세요.`);
      lines.push("");
      const fmt = (v) =>
        typeof v === "number"
          ? Math.abs(v) > 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6)
            ? v.toExponential(3)
            : String(v)
          : String(v);
      lines.push(`| # | ${cols.map((c) => c.name).join(" | ")} |`);
      lines.push(`|---|${cols.map(() => "---").join("|")}|`);
      for (let i = 0; i < maxRows; i++) {
        const row = [String(i + 1)];
        for (const c of cols) row.push(i < c.values.length ? fmt(c.values[i]) : "—");
        lines.push(`| ${row.join(" | ")} |`);
      }
      lines.push("");
    }

    // 3-2) 일반 measurement별 상세 (시계열·다회차·표 외 데이터)
    lines.push(
      `## 측정 데이터 상세 (${datasetKeys.length}개 raw dataset → ${Object.keys(cleaned).length}개 measurement)`,
    );
    lines.push(
      "각 measurement는 여러 회차(run)의 시계열로 구성됨. dataset 파일명은 의미 없음 — measurement 이름과 통계로만 판단할 것.",
    );
    lines.push("");

    for (const [mname, arr] of Object.entries(cleaned)) {
      const sortedRuns = arr.slice().sort((a, b) => {
        const score = (n) =>
          n >= 30 && n <= 500 ? 0 : Math.abs(n - 100); // 50~200이 최적
        return score(a.d.valid_count) - score(b.d.valid_count);
      });
      const MAX_RUNS = 20;
      const shown = sortedRuns.slice(0, MAX_RUNS);
      const skipped = arr.length - shown.length;

      lines.push(`### ${mname} — ${arr.length}개 run` + (skipped > 0 ? ` (대표 ${shown.length}개 표시)` : ""));
      shown.forEach((x, i) => {
        const stats = computeStats(x.d.values);
        // n이 작으면(≤30) 모든 값 그대로 표시. 크면 균등 sampling.
        const showVals = x.d.values.length <= 30 ? x.d.values : sampleEvenly(x.d.values, 5);
        const samp = showVals.map((v) => v.toPrecision(4)).join(", ");
        lines.push(
          `  run ${i + 1}: n=${stats.n}, mean=${stats.mean.toPrecision(4)}, std=${stats.std.toPrecision(3)}, range=[${stats.min.toPrecision(4)}, ${stats.max.toPrecision(4)}], values=[${samp}]`,
        );
      });
      lines.push("");
    }

    // 4) 문자열 라벨 dataset (사용자가 표에 입력한 측정 조건/카테고리)
    //    예: Pendulum Type → "Disk", "Disk with Hole", "Thin Ring", ...
    //    이 라벨들은 보통 표의 행 레이블로 들어가므로 Claude에게 전달.
    const labelMeasurements = [];
    for (const [mname, arr] of Object.entries(stringGroups)) {
      const allLabels = [];
      for (const x of arr) {
        for (const lab of x.d.string_values || []) {
          if (!allLabels.includes(lab)) allLabels.push(lab);
        }
      }
      if (allLabels.length) labelMeasurements.push({ mname, labels: allLabels });
    }
    if (labelMeasurements.length) {
      lines.push(`## 측정 조건/카테고리 라벨 (사용자가 캡스톤 표에 입력)`);
      for (const { mname, labels: labs } of labelMeasurements) {
        lines.push(`- ${mname}: ${labs.slice(0, 30).join(", ")}`);
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
