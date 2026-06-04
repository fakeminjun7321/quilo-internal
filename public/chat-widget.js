/* Quilo AI 도우미 위젯 — 자체 포함(스타일+DOM+스트리밍).
   서버에 CHAT_API_KEY가 없으면(/api/chat/status enabled=false) 아무것도 표시하지 않는다. */
(function () {
  "use strict";
  if (window.__quiloChatLoaded) return;
  window.__quiloChatLoaded = true;

  var GREETING =
    "안녕하세요! Quilo 사용을 도와드리는 AI예요. 보고서 작성·기능·크레딧 등 궁금한 걸 물어보세요.";
  var SUGGESTIONS = [
    "사전보고서랑 결과보고서 차이가 뭐야?",
    "HWPX 파일이 안 열려요",
    "크레딧은 어떻게 충전해요?",
  ];

  var messages = []; // {role, content}
  var busy = false;
  var openedOnce = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function injectStyles() {
    var css =
      "#qc-launch{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;" +
      "background:#243ba2;color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(36,59,162,.35);" +
      "font-size:24px;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .08s}" +
      "#qc-launch:hover{transform:translateY(-2px)}" +
      "#qc-panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 32px);height:520px;" +
      "max-height:calc(100vh - 120px);background:#fff;border:1px solid #e6e8f0;border-radius:16px;z-index:2147483000;" +
      "display:none;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,.22);" +
      "font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard','Segoe UI',system-ui,sans-serif}" +
      "#qc-panel.open{display:flex}" +
      "#qc-head{background:#243ba2;color:#fff;padding:13px 16px;display:flex;align-items:center;gap:8px}" +
      "#qc-head b{font-size:15px}#qc-head .qc-sub{font-size:11px;opacity:.8;margin-left:auto;margin-right:8px}" +
      "#qc-close{background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0 2px}" +
      "#qc-msgs{flex:1;overflow-y:auto;padding:14px;background:#f6f7fb;display:flex;flex-direction:column;gap:10px}" +
      ".qc-row{display:flex}.qc-row.me{justify-content:flex-end}" +
      ".qc-b{max-width:84%;padding:9px 12px;border-radius:13px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}" +
      ".qc-row.ai .qc-b{background:#fff;border:1px solid #e6e8f0;color:#0f172a;border-bottom-left-radius:4px}" +
      ".qc-row.me .qc-b{background:#243ba2;color:#fff;border-bottom-right-radius:4px}" +
      ".qc-b.err{background:#fff4f4;border-color:#f3c0c0;color:#9b2c2c}" +
      "#qc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;background:#f6f7fb}" +
      ".qc-chip{font-size:12px;color:#243ba2;background:#eef1fc;border:1px solid #dfe4fb;border-radius:999px;" +
      "padding:6px 10px;cursor:pointer}.qc-chip:hover{background:#e4e9fc}" +
      "#qc-foot{border-top:1px solid #eef0f6;padding:8px;background:#fff}" +
      "#qc-inrow{display:flex;gap:8px;align-items:flex-end}" +
      "#qc-in{flex:1;resize:none;border:1px solid #d7dbe8;border-radius:10px;padding:9px 11px;font:inherit;font-size:13.5px;max-height:96px;outline:none}" +
      "#qc-in:focus{border-color:#243ba2}" +
      "#qc-send{flex:0 0 auto;background:#243ba2;color:#fff;border:none;border-radius:10px;padding:0 14px;height:38px;cursor:pointer;font-weight:600;font-size:13px}" +
      "#qc-send:disabled{background:#aab2d6;cursor:default}" +
      "#qc-disc{font-size:10.5px;color:#94a3b8;text-align:center;margin-top:6px}";
    var s = el("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  var panel, msgsEl, chipsEl, inputEl, sendBtn;

  function addBubble(role, text, isErr) {
    var row = el("div", "qc-row " + (role === "user" ? "me" : "ai"));
    var b = el("div", "qc-b" + (isErr ? " err" : ""), text || "");
    row.appendChild(b);
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return b;
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (chipsEl) chipsEl.style.display = "none";
    addBubble("user", text);
    messages.push({ role: "user", content: text });
    inputEl.value = "";
    inputEl.style.height = "auto";

    busy = true;
    sendBtn.disabled = true;
    var bubble = addBubble("ai", "…");

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages.slice(-8) }),
    })
      .then(function (resp) {
        if (!resp.ok || !resp.body) {
          return resp
            .json()
            .catch(function () {
              return {};
            })
            .then(function (j) {
              throw new Error(j.error || "오류가 발생했어요. 잠시 후 다시 시도하세요.");
            });
        }
        var reader = resp.body.getReader();
        var dec = new TextDecoder();
        var acc = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            acc += dec.decode(r.value, { stream: true });
            bubble.textContent = acc;
            msgsEl.scrollTop = msgsEl.scrollHeight;
            return pump();
          });
        }
        return pump().then(function () {
          if (!acc.trim()) bubble.textContent = "(응답이 없습니다. 다시 시도해 주세요.)";
          else messages.push({ role: "assistant", content: acc });
        });
      })
      .catch(function (e) {
        bubble.classList.add("err");
        bubble.textContent = e.message || "오류가 발생했어요.";
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  function buildPanel() {
    panel = el("div");
    panel.id = "qc-panel";

    var head = el("div");
    head.id = "qc-head";
    head.appendChild(el("b", null, "Quilo 도우미"));
    head.appendChild(el("span", "qc-sub", "AI"));
    var close = el("button", null, "×");
    close.id = "qc-close";
    close.setAttribute("aria-label", "닫기");
    close.onclick = toggle;
    head.appendChild(close);
    panel.appendChild(head);

    msgsEl = el("div");
    msgsEl.id = "qc-msgs";
    panel.appendChild(msgsEl);

    chipsEl = el("div");
    chipsEl.id = "qc-chips";
    SUGGESTIONS.forEach(function (q) {
      var c = el("button", "qc-chip", q);
      c.onclick = function () {
        send(q);
      };
      chipsEl.appendChild(c);
    });
    panel.appendChild(chipsEl);

    var foot = el("div");
    foot.id = "qc-foot";
    var inrow = el("div");
    inrow.id = "qc-inrow";
    inputEl = el("textarea");
    inputEl.id = "qc-in";
    inputEl.rows = 1;
    inputEl.placeholder = "메시지를 입력하세요…";
    inputEl.addEventListener("input", function () {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + "px";
    });
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(inputEl.value);
      }
    });
    sendBtn = el("button", null, "전송");
    sendBtn.id = "qc-send";
    sendBtn.onclick = function () {
      send(inputEl.value);
    };
    inrow.appendChild(inputEl);
    inrow.appendChild(sendBtn);
    foot.appendChild(inrow);
    foot.appendChild(
      el("div", null, "AI 도우미 · 부정확할 수 있어요. 중요한 건 직접 확인하세요.")
    ).id = "qc-disc";
    panel.appendChild(foot);

    document.body.appendChild(panel);
  }

  function toggle() {
    var opening = !panel.classList.contains("open");
    panel.classList.toggle("open");
    if (opening && !openedOnce) {
      openedOnce = true;
      addBubble("ai", GREETING);
    }
    if (opening) setTimeout(function () { inputEl.focus(); }, 50);
  }

  function init() {
    injectStyles();
    var launch = el("button", null, "💬");
    launch.id = "qc-launch";
    launch.setAttribute("aria-label", "Quilo 도우미 열기");
    launch.onclick = toggle;
    document.body.appendChild(launch);
    buildPanel();
  }

  // 서버에 챗이 켜져 있을 때만 위젯을 띄운다.
  fetch("/api/chat/status")
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      if (j && j.enabled) {
        if (document.readyState === "loading")
          document.addEventListener("DOMContentLoaded", init);
        else init();
      }
    })
    .catch(function () {});
})();
