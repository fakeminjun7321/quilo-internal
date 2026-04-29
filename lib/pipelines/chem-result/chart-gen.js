// Claude가 응답에 포함한 charts JSON spec을 받아 PNG buffer로 렌더.
// chartjs-node-canvas + chart.js 사용 (Node-only, native canvas 의존).
//
// 지원 차트 타입: bar, line, scatter
// 참값 라인은 horizontal line dataset으로 표현 (annotation plugin 불필요)
//
// 한글 폰트: Render 리눅스 컨테이너에는 CJK 폰트가 없어 한글이 □로 렌더된다.
// repo에 NanumGothic-Regular.ttf를 포함하고 startup에서 등록.

const path = require("path");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const WIDTH = 800;
const HEIGHT = 500;
const KOREAN_FONT_FAMILY = "NanumGothic";
const KOREAN_FONT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "fonts",
  "NanumGothic-Regular.ttf",
);

const canvas = new ChartJSNodeCanvas({
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

function buildConfig(spec) {
  const labels = cleanLabels(spec.x_values);
  const series = Array.isArray(spec.series) ? spec.series : [];

  const datasets = series.map((s, i) => {
    const color = COLORS[i % COLORS.length];
    const base = {
      label: stripMarkers(s.label || `series ${i + 1}`),
      data: Array.isArray(s.values) ? s.values : [],
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
        showLine: false,
        backgroundColor: color,
        borderColor: color,
        pointRadius: 5,
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
    data: { labels, datasets },
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
async function renderChart(spec) {
  try {
    const config = buildConfig(spec);
    return await canvas.renderToBuffer(config);
  } catch (e) {
    console.warn("[chart-gen] render error:", e.message);
    return null;
  }
}

module.exports = { renderChart };
