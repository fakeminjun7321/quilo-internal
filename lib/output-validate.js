const ZIP_FAMILY = new Set(["docx", "hwpx", "zip"]);
const PDF_MAGIC = Buffer.from("%PDF-");

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function assertGeneratedOutputMagic(value, kind, label = "generated output") {
  const buffer = asBuffer(value);
  const normalizedKind = String(kind || "").replace(/^\./, "").toLowerCase();

  if (!buffer || buffer.length === 0) {
    throw new Error(`${label} validation failed: output is empty.`);
  }

  if (ZIP_FAMILY.has(normalizedKind)) {
    if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error(
        `${label} validation failed: expected ${normalizedKind} output to start with PK.`,
      );
    }
    return buffer;
  }

  if (normalizedKind === "pdf") {
    if (
      buffer.length < PDF_MAGIC.length ||
      !buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
    ) {
      throw new Error(
        `${label} validation failed: expected PDF output to start with %PDF-.`,
      );
    }
    return buffer;
  }

  throw new Error(
    `${label} validation failed: unsupported output kind "${kind}".`,
  );
}

module.exports = { assertGeneratedOutputMagic };
