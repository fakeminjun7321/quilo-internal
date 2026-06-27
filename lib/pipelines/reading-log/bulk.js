// 독서록 대량 생성 (reading-log-bulk)
//
// 입력: 엑셀/CSV(책이름·출판사·작가 행) + 영역·과목·대출여부·기간(일괄 지정).
// 흐름: 엑셀 파싱 → 책 수만큼 기간(예: 3/3~7/2) 순차 분배 → 책마다 reading-log
//       generateReportContent 호출 → 책마다 독서활동 기록지 .hwpx → JSZip 묶음.
// 출력: ZIP (outputKind: "zip" — server.js 의 generateBundle 계약).

const XLSX = require("xlsx");
const JSZip = require("jszip");
const { generateReportContent } = require("./generate");
const { generateHwpx } = require("./hwpx-gen");

const MAX_BOOKS = 60; // 한 번에 처리할 최대 권수(과도한 비용·시간 방지)
const GEN_CONCURRENCY = 3; // AI 생성 동시 호출 수(속도/안정 균형)

// ── 엑셀/CSV → [{ bookTitle, publisher, author }] ────────────────────────
function norm(v) {
  return String(v == null ? "" : v).trim();
}
function isBookHeader(s) {
  return /책|도서|제목|title|book/i.test(s);
}
function isPublisherHeader(s) {
  return /출판|publisher/i.test(s);
}
function isAuthorHeader(s) {
  return /작가|저자|지은이|author|writer/i.test(s);
}

function parseBooks(buffer, ext) {
  let wb;
  try {
    wb =
      ext === "csv"
        ? XLSX.read(buffer.toString("utf8"), { type: "string" })
        : XLSX.read(buffer, { type: "buffer" });
  } catch (e) {
    throw new Error(`엑셀/CSV 파싱 실패: ${e.message}`);
  }
  const sheetName = (wb.SheetNames || [])[0];
  if (!sheetName) throw new Error("엑셀에 시트가 없습니다.");
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (!rows.length) throw new Error("엑셀이 비어 있습니다.");

  // 헤더 행 탐지: 책/출판/작가 키워드가 보이면 그 행을 헤더로, 열 인덱스 매핑.
  let bookCol = 0,
    pubCol = 1,
    authCol = 2,
    dataStart = 0;
  const head = rows[0].map(norm);
  const headerLooks =
    head.some(isBookHeader) || head.some(isPublisherHeader) || head.some(isAuthorHeader);
  if (headerLooks) {
    const findCol = (pred, fallback) => {
      const i = head.findIndex((c) => pred(c));
      return i >= 0 ? i : fallback;
    };
    bookCol = findCol(isBookHeader, 0);
    pubCol = findCol(isPublisherHeader, 1);
    authCol = findCol(isAuthorHeader, 2);
    dataStart = 1;
  }

  const books = [];
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const bookTitle = norm(row[bookCol]).slice(0, 200);
    if (!bookTitle) continue; // 책 제목 없는 행은 건너뜀
    books.push({
      bookTitle,
      publisher: norm(row[pubCol]).slice(0, 200),
      author: norm(row[authCol]).slice(0, 200),
    });
    if (books.length >= MAX_BOOKS) break;
  }
  if (!books.length) {
    throw new Error(
      "엑셀에서 책을 찾지 못했습니다. 첫 열에 책 이름이 있는지 확인하세요(책이름·출판사·작가 순).",
    );
  }
  return books;
}

// ── 기간(YYYY-MM-DD ~ YYYY-MM-DD)을 n권에 순차·비중복 분배 ──────────────
function pad(n) {
  return String(n).padStart(2, "0");
}
function toISO(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function parseISO(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function splitPeriod(startISO, endISO, n) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  const DAY = 86400000;
  if (start == null || end == null || end < start || n <= 0) {
    // 분배 불가 시 전부 빈 날짜(양식에 일시 미기재).
    return Array.from({ length: Math.max(0, n) }, () => ({ start: "", end: "" }));
  }
  const totalDays = Math.floor((end - start) / DAY) + 1; // 포함 일수
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = start + Math.floor((i * totalDays) / n) * DAY;
    // 다음 구간 시작 하루 전까지(마지막 권은 end 까지) — 비중복 연속 구간.
    const nextStart = start + Math.floor(((i + 1) * totalDays) / n) * DAY;
    let e = nextStart - DAY;
    if (e < s) e = s; // 구간이 1일 미만이면 같은 날
    if (i === n - 1) e = end;
    out.push({ start: toISO(new Date(s)), end: toISO(new Date(e)) });
  }
  return out;
}

// 동시성 제한 map (순서 보존).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function safeName(s) {
  return String(s || "독서록")
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// ── generateContent (대량) — server.js runGeneration 이 호출 ─────────────
async function generateReadingLogBulk(input) {
  const {
    books = [],
    domain = "",
    recordArea = "",
    subject = "",
    borrowed = "no",
    periodStart = "",
    periodEnd = "",
    fontFace,
    model = null,
    signal,
    onProgress = () => {},
  } = input;

  if (!books.length) throw new Error("처리할 책이 없습니다.");
  const intervals = splitPeriod(periodStart, periodEnd, books.length);

  onProgress(`📚 총 ${books.length}권 독서록 생성 시작 (모델: ${model || "기본"})`);
  let done = 0;
  const contents = await mapLimit(books, GEN_CONCURRENCY, async (b, i) => {
    if (signal?.aborted) throw new Error("생성이 중단되었습니다.");
    const c = await generateReportContent({
      bookTitle: b.bookTitle,
      author: b.author,
      publisher: b.publisher,
      recordArea,
      subject,
      domain,
      borrowed,
      startDate: intervals[i].start,
      endDate: intervals[i].end,
      fontFace,
      model,
      signal,
      // 개별 책 진행로그는 과도하니 콘텐츠 단계에선 조용히.
      onProgress: () => {},
    });
    done += 1;
    onProgress(`📖 (${done}/${books.length}) ${b.bookTitle} 작성 완료`);
    return c;
  });

  return { __isBulk: true, __fontFace: fontFace, books: contents };
}

// ── generateBundle — 책마다 .hwpx → ZIP (outputKind: "zip") ──────────────
async function generateBundle(content, ctx = {}) {
  const { studentId = "", userName = "", signal, onProgress = () => {} } = ctx;
  const books = Array.isArray(content && content.books) ? content.books : [];
  if (!books.length) throw new Error("묶을 독서록이 없습니다.");

  const zip = new JSZip();
  for (let i = 0; i < books.length; i++) {
    if (signal?.aborted) throw new Error("생성이 중단되었습니다.");
    const bookContent = {
      ...books[i],
      student_id: studentId,
      student_name: userName,
      __fontFace: books[i].__fontFace || content.__fontFace,
      __style: "default",
    };
    onProgress(
      `📦 (${i + 1}/${books.length}) 「${bookContent.book_title || ""}」 양식 채우는 중…`,
    );
    const buf = await generateHwpx(bookContent, { signal });
    const fname = `${pad(i + 1)}_${safeName(bookContent.book_title)}.hwpx`;
    zip.file(fname, buf);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return { buffer, filename: `독서활동기록지_${books.length}권.zip` };
}

module.exports = {
  parseBooks,
  splitPeriod,
  generateReadingLogBulk,
  generateBundle,
};
