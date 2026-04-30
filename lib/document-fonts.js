const FONT_OPTIONS = [
  {
    id: "hamchorom-batang",
    label: "함초롬바탕",
    aliases: ["함초롬바탕", "함초롱바탕", "hamchorom-batang"],
    face: "함초롬바탕",
  },
  {
    id: "malgun-gothic",
    label: "맑은 고딕",
    aliases: ["맑은 고딕", "Malgun Gothic", "malgun-gothic"],
    face: "Malgun Gothic",
  },
  {
    id: "nanum-myeongjo",
    label: "나눔명조",
    aliases: ["나눔명조", "나눔 명조", "Nanum Myeongjo", "nanum-myeongjo"],
    face: "Nanum Myeongjo",
  },
];

const DEFAULT_FONT_FACE = "Malgun Gothic";

function normalizeFontFace(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_FONT_FACE;
  const found = FONT_OPTIONS.find((opt) =>
    opt.aliases.some((alias) => alias.toLowerCase() === raw.toLowerCase()),
  );
  return found ? found.face : DEFAULT_FONT_FACE;
}

function fontLabelForFace(face) {
  const normalized = normalizeFontFace(face);
  return FONT_OPTIONS.find((opt) => opt.face === normalized)?.label || "맑은 고딕";
}

module.exports = {
  DEFAULT_FONT_FACE,
  FONT_OPTIONS,
  fontLabelForFace,
  normalizeFontFace,
};
