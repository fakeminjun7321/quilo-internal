const { spawn } = require("child_process");
const path = require("path");

const PY_SCRIPT = path.join(__dirname, "hwpx-gen.py");
const PYTHON = process.env.PYTHON_BIN || "python3";

/**
 * Generate an HWPX buffer from report content by spawning hwpx-gen.py.
 *
 * The python script reads JSON from stdin and writes raw HWPX bytes to
 * stdout. Stderr carries python-hwpx's manifest fallback notices — they
 * are non-fatal and only logged when the process exits non-zero.
 *
 * @param {Object} content  Report JSON (same shape as docx-gen.js consumes)
 * @returns {Promise<Buffer>}
 */
function generateHwpx(content) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [PY_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    proc.on("error", (err) => {
      reject(
        new Error(
          `hwpx-gen.py 실행 실패: ${err.message} (PYTHON_BIN=${PYTHON})`,
        ),
      );
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(
          new Error(
            `hwpx-gen.py 종료 코드 ${code}\n${stderr.slice(0, 1000)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    // feed the JSON to stdin
    try {
      proc.stdin.write(JSON.stringify(content));
      proc.stdin.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateHwpx };
