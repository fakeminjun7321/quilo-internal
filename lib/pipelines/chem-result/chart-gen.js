// Claude가 응답에 포함한 charts JSON spec을 받아 PNG buffer로 렌더.
// chartjs-node-canvas + chart.js 사용 (Node-only, native canvas 의존).
//
// 지원 차트 타입: bar, line, scatter
// 참값 라인은 horizontal line dataset으로 표현 (annotation plugin 불필요)
//
// 한글 폰트: Render 리눅스 컨테이너에는 CJK 폰트가 없어 한글이 □로 렌더된다.
// repo에 NanumGothic-Regular.ttf를 포함하고 startup에서 등록.

const path = require("path");
const { fork } = require("child_process");

const WIDTH = 800;
const HEIGHT = 500;
const KOREAN_FONT_FAMILY = "NanumGothic";
const CHART_WORKER_TIMEOUT_MS = Number(process.env.CHART_WORKER_TIMEOUT_MS || 15000);
const KOREAN_FONT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "fonts",
  "NanumGothic-Regular.ttf",
);

let canvas = null;

function getCanvas() {
  if (canvas) return canvas;
  const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
  canvas = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    backgroundColour: "white",
    // Chart.js 전역 기본 폰트를 한글로 지정 → title·legend·ticks 모두 적용.
    chartCallback: (ChartJS) => {
      ChartJS.defaults.font.family = KOREAN_FONT_FAMILY;
    },
  });

  // node-canvas의 registerFont는 process 첫 사용 전에 호출돼야 한다.
  // chartjs-node-canvas 인스턴스에 wrapper가 있어 그걸 사용.
  try {
    canvas.registerFont(KOREAN_FONT_PATH, { family: KOREAN_FONT_FAMILY });
  } catch (e) {
    console.warn(
      `[chart-gen] 한글 폰트 등록 실패 (${KOREAN_FONT_PATH}): ${e.message}. 차트 한글이 □로 렌더될 수 있음.`,
    );
  }
  return canvas;
}

const COLORS = [
  "#4a90e2",
  "#e94e77",
  "#43b97f",
  "#f5a623",
  "#9013fe",
  "#50e3c2",
];

// 차트는 plain text만 받으므로 *italic*, **bold**, _{sub}, ^{sup} 마커를
// 그대로 두면 raw 문자가 노출됨. 마커를 벗겨 plain text로 변환.
//   `*I*_pivot` → `I_pivot`,  `H_{2}O` → `H2O`,  `m^{3}` → `m3`
function stripMarkers(s) {
  return String(s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_\{([^}]+)\}/g, "$1")
    .replace(/\^\{([^}]+)\}/g, "$1");
}

function cleanLabels(arr) {
  return Array.isArray(arr) ? arr.map(stripMarkers) : [];
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePoint(point, fallbackX = null) {
  if (Array.isArray(point) && point.length >= 2) {
    const x = toNumberOrNull(point[0]);
    const y = toNumberOrNull(point[1]);
    return x == null || y == null ? null : { x, y };
  }
  if (point && typeof point === "object") {
    const x = toNumberOrNull(point.x);
    const y = toNumberOrNull(point.y);
    return x == null || y == null ? null : { x, y };
  }
  const y = toNumberOrNull(point);
  const x = toNumberOrNull(fallbackX);
  return x == null || y == null ? null : { x, y };
}

function scatterPoints(spec, seriesItem) {
  const rawPoints = Array.isArray(seriesItem.points)
    ? seriesItem.points
    : Array.isArray(seriesItem.data)
      ? seriesItem.data
      : null;
  if (rawPoints) {
    return rawPoints
      .map((point, i) => normalizePoint(point, spec.x_values?.[i] ?? i))
      .filter(Boolean);
  }

  const values = Array.isArray(seriesItem.values) ? seriesItem.values : [];
  return values
    .map((y, i) => normalizePoint(y, spec.x_values?.[i] ?? i))
    .filter(Boolean);
}

function pointDomain(datasets) {
  const xs = [];
  for (const ds of datasets) {
    for (const point of ds.data || []) {
      if (point && typeof point === "object" && Number.isFinite(point.x)) {
        xs.push(point.x);
      }
    }
  }
  if (xs.length === 0) return null;
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

function trendlineDataset(spec, datasets) {
  const trend = spec.trendline || spec.fit_line || spec.regression_line;
  if (!trend || typeof trend !== "object") return null;

  const color = trend.color || "#d0021b";
  let data = null;
  if (Array.isArray(trend.points)) {
    data = trend.points.map(normalizePoint).filter(Boolean);
  } else {
    const slope = toNumberOrNull(trend.slope ?? trend.m);
    const intercept = toNumberOrNull(trend.intercept ?? trend.b);
    const domain = pointDomain(datasets);
    const xMin = toNumberOrNull(trend.x_min ?? trend.xMin) ?? domain?.min;
    const xMax = toNumberOrNull(trend.x_max ?? trend.xMax) ?? domain?.max;
    if (slope != null && intercept != null && xMin != null && xMax != null) {
      data = [
        { x: xMin, y: slope * xMin + intercept },
        { x: xMax, y: slope * xMax + intercept },
      ];
    }
  }
  if (!data || data.length < 2) return null;

  return {
    label: stripMarkers(trend.label || "회귀선"),
    data,
    showLine: true,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: trend.dashed === false ? undefined : [6, 4],
    pointRadius: 0,
    fill: false,
    order: -1,
  };
}

function buildConfig(spec) {
  const labels = cleanLabels(spec.x_values);
  const series = Array.isArray(spec.series) ? spec.series : [];
  const isScatter = spec.type === "scatter";

  const datasets = series.map((s, i) => {
    const color = COLORS[i % COLORS.length];
    const base = {
      label: stripMarkers(s.label || `series ${i + 1}`),
      data: isScatter ? scatterPoints(spec, s) : (Array.isArray(s.values) ? s.values : []),
    };
    if (spec.type === "line") {
      return {
        ...base,
        borderColor: color,
        backgroundColor: color + "33",
        fill: false,
        tension: 0.1,
      };
    }
    if (spec.type === "scatter") {
      return {
        ...base,
        showLine: s.showLine === true || s.show_line === true,
        backgroundColor: color,
        borderColor: color,
        pointRadius: 5,
        borderWidth: 2,
        fill: false,
      };
    }
    // 기본: bar
    return {
      ...base,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
    };
  });

  if (isScatter) {
    const fit = trendlineDataset(spec, datasets);
    if (fit) datasets.push(fit);
  }

  // 참값 라인 — horizontal line dataset
  if (
    spec.reference_line &&
    typeof spec.reference_line.value === "number" &&
    labels.length > 0
  ) {
    datasets.push({
      label: stripMarkers(spec.reference_line.label || "참값"),
      type: "line",
      data: labels.map(() => spec.reference_line.value),
      borderColor: "#d0021b",
      borderDash: [6, 4],
      borderWidth: 2,
      fill: false,
      pointRadius: 0,
      order: -1, // 다른 dataset 위에
    });
  }

  return {
    type: spec.type === "scatter" ? "scatter" : spec.type === "line" ? "line" : "bar",
    data: spec.type === "scatter" ? { datasets } : { labels, datasets },
    options: {
      responsive: false,
      plugins: {
        title: spec.title
          ? { display: true, text: stripMarkers(spec.title), font: { size: 16, weight: "bold" } }
          : { display: false },
        legend: { display: datasets.length > 1, position: "top" },
      },
      scales: {
        x: {
          title: spec.x_label
            ? { display: true, text: stripMarkers(spec.x_label) }
            : undefined,
        },
        y: {
          title: spec.y_label
            ? { display: true, text: stripMarkers(spec.y_label) }
            : undefined,
          beginAtZero: spec.begin_at_zero === true,
        },
      },
    },
  };
}

/**
 * Chart spec을 PNG buffer로 렌더.
 * spec 형식 예시:
 * {
 *   "title": "기구별 평균 부피 비교",
 *   "type": "bar",         // bar | line | scatter
 *   "x_label": "기구",
 *   "y_label": "평균 부피 (mL)",
 *   "x_values": ["피펫", "뷰렛"],
 *   "series": [
 *     { "label": "평균값", "values": [10.0090, 10.0234] }
 *   ],
 *   "reference_line": { "value": 10.0, "label": "이론값" }
 * }
 *
 * 실패하면 null 반환 (보고서 전체는 계속).
 */
async function renderChartDirect(spec) {
  try {
    const config = buildConfig(spec);
    return await getCanvas().renderToBuffer(config);
  } catch (e) {
    console.warn("[chart-gen] render error:", e.message);
    return null;
  }
}

async function renderChartBestEffort(spec) {
  if (process.env.CHART_RENDER_ENGINE !== "chartjs") {
    const { renderChartSvg } = require("./svg-chart-gen");
    const svgBuffer = await renderChartSvg(spec);
    if (svgBuffer) return svgBuffer;
  }
  return renderChartDirect(spec);
}

function renderChartInWorker(spec) {
  return new Promise((resolve) => {
    const child = fork(__filename, ["--chart-worker"], {
      env: { ...process.env, CHART_RENDER_WORKER: "1" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false;
    let stderr = "";

    const finish = (buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(buffer || null);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      stderr = `${stderr}\nworker timeout after ${CHART_WORKER_TIMEOUT_MS}ms`;
      child.kill("SIGKILL");
      console.warn(`[chart-gen] worker timeout:${stderr.slice(-500)}`);
      finish(null);
    }, CHART_WORKER_TIMEOUT_MS);

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on("message", (msg) => {
      if (!msg || msg.type !== "chart-result") return;
      if (msg.ok && msg.base64) {
        finish(Buffer.from(msg.base64, "base64"));
      } else {
        if (msg.error || stderr) {
          console.warn(
            `[chart-gen] worker render error: ${(msg.error || stderr).slice(0, 500)}`,
          );
        }
        finish(null);
      }
      child.disconnect?.();
    });

    child.on("error", (e) => {
      console.warn(`[chart-gen] worker spawn error: ${e.message}`);
      finish(null);
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      console.warn(
        `[chart-gen] worker exited before result (code=${code}, signal=${signal})${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
      );
      finish(null);
    });

    try {
      child.send({ type: "render-chart", spec });
    } catch (e) {
      console.warn(`[chart-gen] worker send error: ${e.message}`);
      finish(null);
    }
  });
}

async function renderChart(spec) {
  if (process.env.CHART_RENDER_WORKER === "1" || process.env.CHART_RENDER_INLINE === "1") {
    return renderChartBestEffort(spec);
  }
  return renderChartInWorker(spec);
}

if (process.argv.includes("--chart-worker")) {
  process.on("message", async (msg) => {
    if (!msg || msg.type !== "render-chart") return;
    const buf = await renderChartBestEffort(msg.spec);
    if (buf) {
      process.send?.({ type: "chart-result", ok: true, base64: buf.toString("base64") });
    } else {
      process.send?.({ type: "chart-result", ok: false, error: "render returned null" });
    }
    process.exit(0);
  });
} else {
  module.exports = { renderChart };
}
