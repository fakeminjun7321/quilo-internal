// Gemini 2.5 Flash Image ("Nano Banana") — image generation.
// 환경변수 GEMINI_API_KEY 필요.

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const TIMEOUT_MS = 60000;

async function generateImage(prompt, { signal } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 환경변수가 없습니다.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };

  const userSignal = signal;
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const combinedSignal = userSignal
    ? AbortSignal.any([userSignal, timeoutSignal])
    : timeoutSignal;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: combinedSignal,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${txt.slice(0, 200)}`);
  }

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!imagePart) {
    throw new Error("Gemini 응답에 이미지가 없습니다.");
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, "base64"),
    contentType: imagePart.inlineData.mimeType || "image/png",
  };
}

module.exports = { generateImage };
