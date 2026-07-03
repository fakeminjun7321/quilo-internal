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
function isFieldHeader(s) {
  return /분야|영역|과목|구분|field|category|subject|area/i.test(s);
}

// 엑셀 '분야' 텍스트 → index.html 영역 select 값(generate.js DOMAIN_MAP 키).
const FIELD_DOMAIN_MAP = {
  수학: "major-math",
  물리: "major-physics",
  화학: "major-chemistry",
  생물: "major-biology",
  생명: "major-biology",
  생명과학: "major-biology",
  지구: "major-earth",
  지구과학: "major-earth",
  정보: "major-cs",
  정보과학: "major-cs",
  컴퓨터: "major-cs",
  교양: "general-philosophy",
  철학: "general-philosophy",
  종교: "general-philosophy",
  "교양·철학·종교": "general-philosophy",
  사회: "general-social",
  사회과학: "general-social",
  "과학·예술·언어": "general-science-art",
  예술: "general-science-art",
  언어: "general-science-art",
  문학: "general-literature",
  역사: "general-history",
  고전: "general-classics",
};
// 분야 문자열 → 영역 코드. 정확 일치 우선, 없으면 부분 포함으로 추정. 모르면 "".
function fieldToDomain(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (FIELD_DOMAIN_MAP[s]) return FIELD_DOMAIN_MAP[s];
  const compact = s.replace(/\s|·|\/|,/g, "");
  for (const [k, v] of Object.entries(FIELD_DOMAIN_MAP)) {
    const kc = k.replace(/\s|·|\/|,/g, "");
    if (compact.includes(kc) || kc.includes(compact)) return v;
  }
  return "";
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

  // 헤더 행 탐지: 책/출판/작가(+분야) 키워드가 보이면 그 행을 헤더로, 열 인덱스 매핑.
  let fieldCol = -1,
    bookCol = 0,
    pubCol = 1,
    authCol = 2,
    dataStart = 0;
  const head = rows[0].map(norm);
  const headerLooks =
    head.some(isBookHeader) ||
    head.some(isPublisherHeader) ||
    head.some(isAuthorHeader) ||
    head.some(isFieldHeader);
  if (headerLooks) {
    const findCol = (pred, fallback) => {
      const i = head.findIndex((c) => pred(c));
      return i >= 0 ? i : fallback;
    };
    fieldCol = findCol(isFieldHeader, -1);
    bookCol = findCol(isBookHeader, fieldCol >= 0 ? 1 : 0);
    pubCol = findCol(isPublisherHeader, bookCol + 1);
    authCol = findCol(isAuthorHeader, bookCol + 2);
    dataStart = 1;
  } else if (
    (rows[0] || []).length >= 4 &&
    fieldToDomain(norm((rows[0] || [])[0])) &&
    !fieldToDomain(norm((rows[0] || [])[1]))
  ) {
    // 머리글 없이 [분야, 책이름, 출판사, 작가] 형태로 보이면 한 칸씩 밀어서 인식.
    fieldCol = 0;
    bookCol = 1;
    pubCol = 2;
    authCol = 3;
  }

  const books = [];
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const bookTitle = norm(row[bookCol]).slice(0, 200);
    if (!bookTitle) continue; // 책 제목 없는 행은 건너뜀
    const field = fieldCol >= 0 ? norm(row[fieldCol]).slice(0, 40) : "";
    books.push({
      bookTitle,
      publisher: norm(row[pubCol]).slice(0, 200),
      author: norm(row[authCol]).slice(0, 200),
      field, // 엑셀 '분야' 원문 (있으면)
      fieldDomain: fieldToDomain(field), // 영역 코드로 매핑 (모르면 "")
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
    recordArea = "auto",
    subject = "",
    enrolledSubjects = "",
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

  // 대량 생성 균질화 방지: 책마다 선택 계기 유형을 회전 주입(모델이 부자연스러우면 무시 가능).
  // 단일 프롬프트로 수십 권을 돌릴 때 계기 서사가 복제되는 것을 막는다.
  const REASON_SEEDS = [
    "수업·과제에서 생긴 의문의 연장",
    "진행 중이던 탐구·R&E에서 막힌 지점",
    "앞서 읽은 다른 책·영상에서 이어진 궁금증",
    "언론·유튜브에서 본 논쟁의 원전 확인",
    "친구·선생님의 추천을 반신반의하며",
    "도서관 서가에서 목차의 특정 장에 끌려서",
  ];

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
      enrolledSubjects,
      // 엑셀 '분야' 열이 있으면 책마다 그 영역을, 없으면 폼에서 일괄 지정한 영역을 사용.
      domain: b.fieldDomain || domain,
      borrowed,
      startDate: intervals[i].start,
      endDate: intervals[i].end,
      reasonSeed: REASON_SEEDS[i % REASON_SEEDS.length],
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

  // 파일명 규칙: 학번이름_도서명.hwpx (예: 2402구민준_코스모스.hwpx).
  const who = safeName(`${studentId}${userName}`);
  const usedNames = new Set();
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
    const titlePart = safeName(bookContent.book_title || `독서록${i + 1}`);
    let base = who ? `${who}_${titlePart}` : titlePart;
    let fname = `${base}.hwpx`;
    // 동명이서(같은 학생·같은 제목) 충돌 시 일련번호를 붙여 덮어쓰기 방지.
    let dup = 2;
    while (usedNames.has(fname)) {
      fname = `${base} (${dup++}).hwpx`;
    }
    usedNames.add(fname);
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
