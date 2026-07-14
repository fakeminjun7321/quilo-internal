"use strict";

const express = require("express");
const multer = require("multer");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { convertHwpxEquations } = require("./hwpx-equations");
const { extractImageText } = require("./image-ocr");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function createDocumentToolRouter({ requireAuth, requirePro, analyzePdf, getSessionUser, rateLimit }) {
  const router = express.Router();

  router.post("/pdf/analyze", requireAuth, upload.single("pdf"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "PDF 파일이 필요합니다." });
    if (!/\.pdf$/i.test(req.file.originalname || "") && req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "PDF 파일만 분석할 수 있습니다." });
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quilo-pdf-analysis-"));
    const pdfPath = path.join(tempDir, "input.pdf");
    try {
      await fs.writeFile(pdfPath, req.file.buffer);
      const analysis = await analyzePdf(pdfPath, {});
      return res.json({ analysis, filename: req.file.originalname, requestId: req.apiRequestId || null });
    } catch (error) {
      return res.status(422).json({ error: error.message || "PDF를 분석하지 못했습니다." });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  router.post("/hwpx/equations", requireAuth, upload.single("hwpx"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "HWPX 파일이 필요합니다." });
    try {
      const converted = await convertHwpxEquations(req.file.buffer, {
        filename: req.file.originalname,
        mode: String(req.body.mode || "all"),
      });
      res.set({
        "Content-Type": "application/vnd.hancom.hwpx",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(converted.filename)}`,
        "X-Quilo-Equations": String(converted.stats.equations),
        "X-Quilo-Detected": String(converted.stats.detected),
      });
      return res.send(converted.buffer);
    } catch (error) {
      return res.status(422).json({ error: error.message || "HWPX 수식을 변환하지 못했습니다." });
    }
  });

  router.post("/images/ocr", requirePro, upload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "이미지 파일이 필요합니다." });
    if (req.file.size > 20 * 1024 * 1024) return res.status(413).json({ error: "이미지는 20MB 이하만 지원합니다." });
    const requestId = req.apiRequestId || null;
    const startedAt = Date.now();
    try {
      const result = await extractImageText(req.file, {
        includeBlocks: String(req.body.includeBlocks || "true") !== "false",
        tableFormat: String(req.body.tableFormat || "markdown") === "html" ? "html" : "markdown",
        mode: String(req.body.mode || "accurate") === "fast" ? "fast" : "accurate",
      });
      const user = getSessionUser(req);
      if (user?.id && !user.isAdmin) rateLimit.recordBetaUsage(user.id, "image-ocr");
      return res.json({ ...result, requestId });
    } catch (error) {
      const status = Number(error?.status) || (error?.name === "OcrInputError" ? 422 : 502);
      console.error("[image-ocr] request failed", {
        requestId,
        status,
        code: error?.code || "OCR_UNKNOWN",
        elapsedMs: Date.now() - startedAt,
        message: String(error?.message || "이미지 OCR에 실패했습니다.").slice(0, 300),
      });
      return res.status(status).json({
        error: error.message || "이미지 OCR에 실패했습니다.",
        code: error?.code || "OCR_UNKNOWN",
        requestId,
      });
    }
  });

  return router;
}

module.exports = { createDocumentToolRouter };
