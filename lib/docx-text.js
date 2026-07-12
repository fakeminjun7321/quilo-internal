// DOCX(Word) 본문 텍스트 추출기.
//
// 사전보고서를 PDF 대신 .docx로 올린 경우 Claude에 본문을 text 블록으로 전달하기
// 위해 사용한다. mammoth 같은 신규 의존성 없이, 저장소가 이미 쓰는 jszip으로
// ZIP을 열어 word/document.xml의 <w:t> 텍스트 노드를 순서대로 이어 붙인다.
//
// 규칙:
// - 문단(<w:p>) 경계는 개행으로 구분한다. 표 셀 안의 문단도 한 줄씩 나온다.
// - <w:tab/>은 탭으로, <w:br/>·<w:cr/>은 문단 내 개행으로 바꾼다.
// - <w:pPr>/<w:rPr> 속성 블록 안의 탭 스타일 정의(<w:tab w:val=.../>)는 무시한다.
// - 변경 추적으로 삭제된 텍스트(<w:delText>)는 포함하지 않는다.

const JSZip = require("jszip");

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlEntities(s) {
  return String(s).replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g,
    (match, hex, dec, named) => {
      if (named) return NAMED_ENTITIES[named];
      const code = parseInt(hex != null ? hex : dec, hex != null ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    },
  );
}

// 문단 XML 하나에서 텍스트·탭·줄바꿈 토큰을 순서대로 이어 붙인다.
function extractParagraphText(paraXml) {
  // 스타일 정의(<w:pPr>, <w:rPr>) 안의 <w:tab .../>을 본문 탭으로 오인하지 않게 먼저 제거.
  const body = String(paraXml)
    .replace(/<w:pPr\b[^>]*\/>/g, "")
    .replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g, "")
    .replace(/<w:rPr\b[^>]*\/>/g, "")
    .replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g, "");
  let text = "";
  // <w:t ...>내용</w:t> | <w:tab/> | <w:br/>·<w:cr/> 순서 보존 스캔.
  // <w:t 뒤에 공백/'>'만 허용하므로 <w:delText>(삭제된 변경 추적 텍스트)는 매칭되지 않는다.
  const tokenRe =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g;
  let m;
  while ((m = tokenRe.exec(body)) !== null) {
    if (m[1] !== undefined) text += decodeXmlEntities(m[1]);
    else if (m[0].startsWith("<w:tab")) text += "\t";
    else text += "\n";
  }
  return text;
}

/**
 * docx Buffer에서 본문 텍스트를 추출한다.
 * 열기 실패·document.xml 부재 시 throw. 호출부가 catch해서 graceful fallback 한다.
 *
 * @param {Buffer} buffer  .docx 파일 버퍼
 * @returns {Promise<string>}  문단 경계가 개행으로 구분된 본문 텍스트 (양끝 trim)
 */
async function extractDocxText(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e) {
    throw new Error(`docx 파일을 열 수 없습니다: ${e.message}`);
  }
  // 본문 파트는 표준적으로 word/document.xml. 변형된 이름이면 word/ 아래 document*.xml을 찾는다.
  const docFile =
    zip.file("word/document.xml") || zip.file(/^word\/document[^/]*\.xml$/i)[0];
  if (!docFile) {
    throw new Error("word/document.xml이 없습니다. 올바른 .docx 파일인지 확인하세요.");
  }
  const xml = await docFile.async("string");

  const paragraphs = [];
  // 자기닫힘 <w:p/>(빈 문단)를 먼저 매칭해야 뒤따르는 문단 내용을 삼키지 않는다.
  const paraRe = /<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    paragraphs.push(m[1] !== undefined ? extractParagraphText(m[1]) : "");
  }
  // 문단 구조를 못 찾는 비정형 XML이면 <w:t>만이라도 이어 붙인다.
  if (paragraphs.length === 0) {
    const flat = extractParagraphText(xml);
    if (flat.trim()) paragraphs.push(flat);
  }

  return paragraphs
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // 빈 문단 연속은 한 줄 공백으로 정리
    .trim();
}

module.exports = { extractDocxText };
