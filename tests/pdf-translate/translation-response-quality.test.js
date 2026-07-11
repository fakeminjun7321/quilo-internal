const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findUntranslatedEnglishProse,
  findUnsupportedTargetCodePoints,
  translateBatch,
  translateBlocksWithRetries,
  validateTranslationCandidate,
  validateTranslationMap,
} = require("../../lib/pipelines/pdf-translate/translate");

function reasonCodes(result) {
  return result.reasons.map((reason) => reason.code);
}

test("translation prompt uses batch-wide document context and domain-sensitive terminology", async () => {
  let captured;
  const blocks = [
    { id: 101, text: "Regression fixture" },
    { id: 102, text: "The physical fixture holds the sample." },
  ];
  const { map } = await translateBatch(async (request) => {
    captured = request;
    return {
      text: JSON.stringify({
        t: {
          101: "회귀 테스트 픽스처",
          102: "물리적 고정구가 시료를 고정한다.",
        },
      }),
      usage: {},
    };
  }, blocks);

  assert.deepEqual(Object.keys(map).sort(), ["101", "102"]);
  assert.match(captured.system, /Read ALL segments in the batch as parts of one document/);
  assert.match(captured.system, /IDs are separate only for output mapping and completeness checks/);
  assert.doesNotMatch(captured.system, /Translate each id independently/i);
  assert.match(captured.system, /born-digital.*디지털 원본.*처음부터 디지털로 생성된/);
  assert.match(captured.system, /reflow text\/prose.*재배치.*줄바꿈 재조정.*never 재흐름/);
  assert.match(captured.system, /internal jump.*문서 내 이동 링크.*never 내부 점프/);
  assert.match(captured.system, /heading.*제목.*표제.*header\/머리글/);
  assert.match(captured.system, /test\/regression fixture.*테스트 픽스처.*never 고정물.*실험 템플릿/);
  assert.match(captured.system, /measurement ledger.*측정값 기록부.*측정값 목록/);
  assert.match(captured.system, /physical\/mechanical fixture.*장치.*고정구/);
  assert.match(captured.system, /해라체 or 하십시오체.*do not mix/);
  assert.match(captured.system, /Still translate lowercase English common nouns such as fixture and page/);
});

test("repeated fixture segments retain every output ID without correction-reason leakage", async () => {
  const calls = [];
  const blocks = [
    { id: 201, text: "Regression fixture" },
    { id: 202, text: "The regression fixture is reusable." },
    { id: 203, text: "The physical fixture holds the sample." },
  ];
  const suppliedByFakeModel = {
    201: "회귀 테스트 픽스처",
    202: "회귀 테스트 픽스처는 재사용할 수 있다.",
    203: "물리적 고정구는 시료를 고정한다.",
  };
  const caller = async (request) => {
    calls.push(request);
    // The test supplies a fake model result; production JavaScript does not synthesize or
    // assert that these Korean phrases are the one true translation.
    return { text: JSON.stringify({ t: suppliedByFakeModel }), usage: {} };
  };

  const result = await translateBlocksWithRetries({
    blocks,
    caller,
    retrySizes: [],
    verbose: false,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result.translations, suppliedByFakeModel);
  for (const id of [201, 202, 203]) assert.match(calls[0].user, new RegExp(`"id":${id}`));
  assert.doesNotMatch(calls[0].user, /targeted correction retry|previous answers were rejected/i);
  assert.doesNotMatch(calls[0].user, /^- ID \d+:/m);
});

test("rejects lowercase untranslated prose outside a Korean parenthetical gloss", () => {
  const source = "This born-digital page contains an ordinary paragraph.";

  const hyphenated = validateTranslationCandidate(
    { id: 1, text: source },
    "이 born-digital 페이지에는 일반 문단이 있습니다.",
  );
  assert.equal(hyphenated.ok, false);
  assert.deepEqual(hyphenated.reasons[0].phrases, ["born-digital"]);

  const multiword = validateTranslationCandidate(
    { id: 1, text: source },
    "이 디지털 원본 페이지에는 ordinary paragraph가 있습니다.",
  );
  assert.equal(multiword.ok, false);
  assert.deepEqual(multiword.reasons[0].phrases, ["ordinary paragraph"]);

  assert.deepEqual(
    findUntranslatedEnglishProse(source, "이 디지털 원본 페이지에는 일반 문단이 있습니다."),
    [],
  );
});

test("allows URLs, code, formulas, units, IDs, acronyms, proper nouns, and parenthetical glosses", () => {
  const cases = [
    [
      "Attention improves the residual connection.",
      "어텐션(attention)은 잔차 연결(residual connection)을 개선합니다.",
    ],
    [
      "OpenAI API model XG-42 uses 12 kg at https://example.com/v1?q=2.",
      "OpenAI API 모델 XG-42는 https://example.com/v1?q=2에서 12 kg을 사용합니다.",
    ],
    ["Run `npm install foo bar` now.", "이제 `npm install foo bar`를 실행합니다."],
    ["npm install foo bar", "npm install foo bar"],
    ["The sample ID abc-def is valid.", "샘플 ID abc-def는 유효합니다."],
    ["New York uses numpy.", "New York에서는 numpy를 사용합니다."],
    ["10 kg m s", "10 kg m s"],
    [
      "H<sub>2</sub>O has energy E<sup>2</sup>.",
      "H<sub>2</sub>O의 에너지는 E<sup>2</sup>입니다.",
    ],
  ];

  for (const [source, target] of cases) {
    assert.deepEqual(
      validateTranslationCandidate({ id: "allowed", text: source }, target),
      { ok: true, reasons: [] },
      `${source} -> ${target}`,
    );
  }
});

test("rejects changed sub/sup literals, tag order, numbers, and URLs", () => {
  const source =
    "H<sub>2</sub><sup>+</sup> has 1,234.50 states; see https://example.com/v2?q=7.";

  const changed = validateTranslationCandidate(
    { id: 7, text: source },
    "H<sup>+</sup><sub>3</sub>에는 1,234.5개 상태가 있습니다. https://example.com/v3?q=7을 참조하세요.",
  );
  assert.equal(changed.ok, false);
  assert.deepEqual(reasonCodes(changed), [
    "scientific_markup_changed",
    "preserved_numbers_changed",
    "preserved_urls_changed",
  ]);

  const exact = validateTranslationCandidate(
    { id: 7, text: source },
    "H<sub>2</sub><sup>+</sup>에는 1,234.50개 상태가 있습니다. https://example.com/v2?q=7을 참조하세요.",
  );
  assert.deepEqual(exact, { ok: true, reasons: [] });
});

test("allows supported Korean/Latin/Common text and source-retained BMP scripts", () => {
  const cases = [
    ["API 결과는 3개입니다.", "API 결과는 3개입니다."],
    [
      "The α<sub>1</sub> term equals 2πr.",
      "α<sub>1</sub> 항은 2πr과 같습니다.",
    ],
    [
      "Москва has 2 labs in 東京.",
      "Москва에는 東京에 2개의 실험실이 있습니다.",
    ],
    [
      "H<sub>2</sub><sup>+</sup> = 4.5 eV.",
      "H<sub>2</sub><sup>+</sup> = 4.5 eV입니다.",
    ],
  ];
  for (const [source, target] of cases) {
    assert.deepEqual(findUnsupportedTargetCodePoints(source, target), []);
    assert.deepEqual(validateTranslationCandidate({ id: "script-ok", text: source }, target), {
      ok: true,
      reasons: [],
    });
  }
});

test("rejects source-absent scripts and all non-BMP characters using code points only", () => {
  const source = "This page is visible.";
  const cases = [
    ["이 페이지에 टनो가 섞였습니다.", ["U+091F", "U+0928", "U+094B"]],
    ["이 페이지에 Б가 섞였습니다.", ["U+0411"]],
    ["이 페이지에 漢이 섞였습니다.", ["U+6F22"]],
    ["이 페이지에 😀가 섞였습니다.", ["U+1F600"]],
  ];

  for (const [target, expected] of cases) {
    const result = validateTranslationCandidate({ id: "script-bad", text: source }, target);
    assert.equal(result.ok, false);
    const reason = result.reasons.find((entry) => entry.code === "unsupported_target_characters");
    assert.deepEqual(reason.codePoints, expected);
    assert.equal(expected.every((code) => reason.message.includes(code)), true);
    for (const char of ["ट", "न", "ो", "Б", "漢", "😀"]) {
      assert.equal(JSON.stringify(reason).includes(char), false, "reason must not expose target text");
    }
  }

  // Even a source-retained emoji is rejected: current bundled-font rendering is BMP-only.
  assert.deepEqual(findUnsupportedTargetCodePoints("Status 😀", "상태 😀"), ["U+1F600"]);

  // Raw code-point comparison is intentional: canonical decomposition must not inherit the
  // source allow-list through normalization (Й U+0419 != И U+0418 + breve U+0306).
  assert.deepEqual(findUnsupportedTargetCodePoints("Name Й", "이름 И\u0306"), ["U+0418"]);
});

test("validateTranslationMap accepts only candidates that pass deterministic checks", () => {
  const result = validateTranslationMap(
    [
      { id: 1, text: "An ordinary paragraph." },
      { id: 2, text: "There are 42 samples." },
      { id: 3, text: "A missing answer." },
    ],
    {
      1: "ordinary paragraph입니다.",
      2: "샘플은 42개입니다.",
    },
  );

  assert.deepEqual(result.accepted, { 2: "샘플은 42개입니다." });
  assert.equal(result.rejected["1"].reasons[0].code, "untranslated_english_prose");
  assert.equal(result.rejected["3"].reasons[0].code, "missing_response");
});

test("targeted retry sends only rejected IDs with deterministic correction reasons", async () => {
  const calls = [];
  const caller = async ({ user }) => {
    calls.push(user);
    if (calls.length === 1) {
      return {
        text: JSON.stringify({
          t: {
            1: "이 born-digital 페이지는 일반 문단입니다.",
            2: "샘플은 42개입니다.",
          },
        }),
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }
    return {
      text: JSON.stringify({ t: { 1: "이 디지털 원본 페이지는 일반 문단입니다." } }),
      usage: { input_tokens: 4, output_tokens: 3 },
    };
  };

  const result = await translateBlocksWithRetries({
    blocks: [
      { id: 1, text: "This born-digital page is an ordinary paragraph." },
      { id: 2, text: "There are 42 samples." },
    ],
    caller,
    retrySizes: [1],
    verbose: false,
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1], /targeted correction retry/i);
  assert.match(calls[1], /keep terminology, domain meaning, and Korean ending style consistent/i);
  assert.match(calls[1], /ID 1: .*미번역 영어 prose/);
  assert.match(calls[1], /"id":1/);
  assert.doesNotMatch(calls[1], /"id":2/);
  assert.deepEqual(result.translations, {
    1: "이 디지털 원본 페이지는 일반 문단입니다.",
    2: "샘플은 42개입니다.",
  });
  assert.equal(result.usage.input_tokens, 14);
  assert.equal(result.usage.output_tokens, 8);
});

test("retry exhaustion remains fail-closed through assertCompleteTranslations", async () => {
  const calls = [];
  const caller = async ({ user }) => {
    calls.push(user);
    return {
      text: JSON.stringify({ t: { 9: "이 born-digital 페이지입니다." } }),
      usage: {},
    };
  };

  await assert.rejects(
    translateBlocksWithRetries({
      blocks: [{ id: 9, text: "This born-digital page is visible." }],
      caller,
      retrySizes: [1, 1],
      verbose: false,
    }),
    (error) => {
      assert.equal(error.code, "PDF_TRANSLATION_QUALITY_FAILURE");
      assert.equal(error.details.kind, "missing_translations");
      assert.deepEqual(error.details.missingIds, ["9"]);
      return true;
    },
  );

  assert.equal(calls.length, 3);
  assert.match(calls[2], /이전 품질 거부 응답을 그대로 반복함/);
});

test("unexpected-script rejection targets only that ID and accepts corrected Korean", async () => {
  const calls = [];
  const caller = async ({ user }) => {
    calls.push(user);
    if (calls.length === 1) {
      return {
        text: JSON.stringify({
          t: {
            1: "이 페이지에 टनो가 표시됩니다.",
            2: "샘플은 7개입니다.",
          },
        }),
        usage: {},
      };
    }
    return { text: JSON.stringify({ t: { 1: "이 페이지가 표시됩니다." } }), usage: {} };
  };

  const result = await translateBlocksWithRetries({
    blocks: [
      { id: 1, text: "This page is displayed." },
      { id: 2, text: "There are 7 samples." },
    ],
    caller,
    retrySizes: [1],
    verbose: false,
  });

  assert.deepEqual(result.translations, {
    1: "이 페이지가 표시됩니다.",
    2: "샘플은 7개입니다.",
  });
  assert.match(calls[1], /U\+091F/);
  assert.match(calls[1], /U\+0928/);
  assert.match(calls[1], /U\+094B/);
  assert.doesNotMatch(calls[1], /ट|न|ो/);
  assert.match(calls[1], /"id":1/);
  assert.doesNotMatch(calls[1], /"id":2/);
});

test("repeated unexpected-script output exhausts retries and fails closed", async () => {
  const calls = [];
  const caller = async ({ user }) => {
    calls.push(user);
    return {
      text: JSON.stringify({ t: { 4: "이 페이지에 Б가 섞였습니다." } }),
      usage: {},
    };
  };

  await assert.rejects(
    translateBlocksWithRetries({
      blocks: [{ id: 4, text: "This page is valid." }],
      caller,
      retrySizes: [1, 1],
      verbose: false,
    }),
    (error) => {
      assert.equal(error.code, "PDF_TRANSLATION_QUALITY_FAILURE");
      assert.equal(error.details.kind, "missing_translations");
      assert.deepEqual(error.details.missingIds, ["4"]);
      return true;
    },
  );
  assert.equal(calls.length, 3);
  assert.match(calls[1], /U\+0411/);
  assert.doesNotMatch(calls[1], /Б/);
  assert.match(calls[2], /이전 품질 거부 응답을 그대로 반복함/);
});
