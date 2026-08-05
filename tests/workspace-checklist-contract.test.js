"use strict";

// 워크스페이스 필수 항목 체크리스트 계약.
//
// REPORT_WORKFLOWS 의 requirement 는 forms/common.js updateSubmitReadiness 가
// 제출 버튼 활성화 조건으로 쓰므로, selector 가 폼 안의 실제 컨트롤과 어긋나면
// 체크리스트 항목이 영원히 미완료로 남고 생성 버튼이 잠긴다.
// (회귀 사례: 독서록 rlFormat 이 hidden input 이라 checked() 가 항상 false —
//  화면에는 고를 것이 없는데 '출력 형식 필수'가 미완료로 표시되고 버튼이 비활성.)

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

// 두 모듈 모두 자급자족 ESM(import문·최상위 DOM 접근 없음)이지만 패키지가 CJS라
// 파일 경로 import 가 CJS로 파싱된다. quilo-integration.test.js 와 같은 방식으로
// data: URL 로 ESM 강제 로드해 실제 export 를 검증한다.
function importEsm(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

async function loadModules() {
  const workflow = await importEsm("public/workspace/report-workflow.js");
  const registry = await importEsm("public/workspace/report-registry.js");
  return { workflow, registry };
}

// <form id="..."> ... </form> 블록만 잘라 그 폼 소유 컨트롤로 검사 범위를 좁힌다
// (requirementComplete 는 form.querySelectorAll 이므로 다른 폼의 동명 컨트롤은 무효).
function formBlock(formId) {
  const start = html.indexOf(`id="${formId}"`);
  assert.ok(start >= 0, `index.html 에 form id="${formId}" 가 있어야 한다`);
  const end = html.indexOf("</form>", start);
  assert.ok(end > start, `form id="${formId}" 는 닫혀 있어야 한다`);
  return html.slice(start, end);
}

function selectorNames(selector) {
  return [...String(selector).matchAll(/input\[name="([^"]+)"\]/g)].map((m) => m[1]);
}

function selectorIds(selector) {
  return [...String(selector).matchAll(/#([A-Za-z][\w-]*)/g)].map((m) => m[1]);
}

test("모든 활성 보고서의 checked 요구는 폼 안의 라디오/체크박스와 연결된다", async () => {
  const { workflow, registry } = await loadModules();
  const { REPORT_WORKFLOWS } = workflow;
  const { CORE_REPORTS } = registry;

  for (const [type, meta] of Object.entries(CORE_REPORTS)) {
    const flow = REPORT_WORKFLOWS[type];
    assert.ok(flow, `REPORT_WORKFLOWS 에 ${type} 이 있어야 한다`);
    const block = formBlock(meta.formId);

    for (const requirement of flow.requirements) {
      const selectors =
        requirement.kind === "any" ? requirement.selectors : [requirement.selector];

      if (requirement.kind === "checked") {
        for (const selector of selectors) {
          const names = selectorNames(selector);
          assert.ok(
            names.length,
            `${type} "${requirement.label}" checked selector 는 input[name=...] 이어야 한다: ${selector}`,
          );
          for (const name of names) {
            assert.match(
              block,
              new RegExp(`<input type="(radio|checkbox)"[^>]*name="${name}"`),
              `${type} "${requirement.label}": ${meta.formId} 안에 체크 가능한 name="${name}" 컨트롤이 있어야 한다 ` +
                "(hidden/text 는 checked() 를 절대 만족하지 못해 버튼이 잠긴다)",
            );
          }
        }
        continue;
      }

      // value/file/any: selector 의 id 가 폼 안에 실제로 존재해야 완료 판정이 가능하다.
      for (const selector of selectors) {
        for (const id of selectorIds(selector)) {
          assert.ok(
            block.includes(`id="${id}"`),
            `${type} "${requirement.label}": ${meta.formId} 안에 #${id} 가 있어야 한다`,
          );
        }
      }
    }
  }
});

test("독서록 출력 형식은 .hwpx 고정 라디오가 기본 선택 상태여야 한다", async () => {
  const { workflow } = await loadModules();
  const requirement = workflow.REPORT_WORKFLOWS["reading-log"].requirements.find(
    (entry) => entry.label === "출력 형식",
  );
  assert.ok(requirement, "독서록 체크리스트에 출력 형식 항목이 있어야 한다");
  assert.equal(requirement.kind, "checked");

  const block = formBlock("readingLogForm");
  // 단일 고정 옵션이라 기본 checked 가 없으면 사용자는 영원히 만족시킬 수 없다.
  assert.match(
    block,
    /<input type="radio" name="rlFormat" value="hwpx" checked/,
    "readingLogForm 에 기본 선택된 rlFormat=hwpx 라디오가 보여야 한다",
  );
  assert.doesNotMatch(
    block,
    /type="hidden"[^>]*name="rlFormat"|name="rlFormat"[^>]*type="hidden"/,
    "rlFormat 을 hidden input 으로 되돌리면 안 된다",
  );
});
