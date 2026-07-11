/* Quilo AI 도우미 위젯 — 사용법 도움 + 메모 작성 도우미(무거운 모델) + 답변 액션바.
   서버에 CHAT_API_KEY가 없으면(/api/chat/status enabled=false) 위젯/버튼을 표시하지 않는다. */
(function () {
  "use strict";
  window.Quilo = window.Quilo || {};
  if (window.__quiloChatLoaded) return;
  window.__quiloChatLoaded = true;

  var HELP_GREETING =
    "안녕하세요! Quilo 사용을 도와드리는 AI예요. 보고서 작성·기능·크레딧 등 궁금한 걸 물어보세요.";
  var HELP_SUGGESTIONS = [
    "사전보고서랑 결과보고서 차이가 뭐야?",
    "HWPX 파일이 안 열려요",
    "크레딧은 어떻게 충전해요?",
  ];
  var HOME_IDLE_PLACEHOLDER = "실험 자료를 분석해줘";
  var HOME_IDLE_SUGGESTIONS = [
    "보고서",
    "탐구·리서치",
    "데이터 분석",
    "API 플랫폼",
    "앱",
  ];
  var DEFAULT_INPUT_PLACEHOLDER = "메시지를 입력하세요…";
  var INLINE_HELP_PLACEHOLDER = "Quilo 기능과 사용법을 물어보세요";
  var MEMO_GREETING =
    "실험 내용을 알려주시면 보고서에 넣을 'AI 참고 메모' 초안을 만들어드려요. 무엇을 측정했고, 어떤 결과·경향이었나요? 특이사항이 있었나요?";
  var MEMO_SUGGESTIONS = [
    "오늘 한 실험을 설명할게",
    "측정값이 이론값과 달랐어",
    "실험 중 특이사항이 있었어",
  ];
  var STYLE_GREETING =
    "내 글 '문체'를 정리해드려요. 평소 어떻게 쓰는지(말투·설명 방식·소제목·수식 표기 등)를 알려주시거나, 예전에 쓴 글을 붙여넣어 주세요. '스타일 메모'로 정리해드릴게요.";
  var STYLE_SUGGESTIONS = [
    "영어 소제목 + 구어체로 직관 먼저 쓰는 스타일이야",
    "예전에 쓴 글을 붙여넣을게",
    "사람들이 헷갈리는 지점을 짚는 편이야",
  ];

  var messages = [];
  var busy = false;
  var openedOnce = false;
  var currentMode = "help"; // 'help' | 'memo' | 'style'
  var memoTarget = null; // 메모/스타일을 넣을 textarea id (폼/설정에서 열었을 때)
  var memoReportType = ""; // 메모를 어느 보고서 폼에서 열었는지(종류별 안내용)

  // textarea id 접두사 → 보고서 종류 매핑
  function reportTypeFromTarget(id) {
    id = String(id || "");
    if (id.indexOf("pre") === 0) return "chem-pre";
    if (id.indexOf("cr") === 0) return "chem-result";
    if (id.indexOf("pr") === 0) return "phys-result";
    if (id.indexOf("pi") === 0) return "phys-inquiry";
    if (id.indexOf("mi") === 0) return "math-inquiry";
    return "";
  }
  var waEnabled = false; // 유료 글쓰기 도우미(Sonnet/GPT) + 로그인 사용 가능
  var helpEnabled = false; // 일반 사용법 도우미(Groq)
  var waModels = []; // [{id,label}]
  var waModel = null; // 선택된 모델 id
  var panel, msgsEl, chipsEl, inputEl, sendBtn, micBtn, voiceStatusEl, modelSel, inlineMount;
  var recognition = null;
  var listening = false;
  var voiceBaseValue = "";
  var composingInput = false;

  function isAssist() {
    return currentMode === "memo" || currentMode === "style";
  }

  function isHomeInlineIdle() {
    return !!(
      currentMode === "help" &&
      panel &&
      panel.classList.contains("qc-inline") &&
      panel.classList.contains("qc-idle")
    );
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function pageContext() {
    try {
      return (document.title || "Quilo") + " (" + location.pathname + ")";
    } catch (e) {
      return "";
    }
  }
  function save() {
    try {
      sessionStorage.setItem(
        "quiloChat",
        JSON.stringify({ m: messages, mode: currentMode })
      );
    } catch (e) {}
  }
  function load() {
    try {
      var s = JSON.parse(sessionStorage.getItem("quiloChat") || "null");
      if (s && Array.isArray(s.m)) {
        messages = s.m;
        if (s.mode === "memo" || s.mode === "help") currentMode = s.mode;
        return true;
      }
    } catch (e) {}
    return false;
  }
  function restoreConversation() {
    msgsEl.innerHTML = "";
    chipsEl.style.display = "none";
    updateModebar();
    var isMemo = isAssist();
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === "user") {
        addUserRow(m.content);
      } else {
        var ai = addAiRow();
        ai.bubble.textContent = m.content;
        attachBar(
          ai.row,
          messages.slice(0, i),
          (messages[i - 1] || {}).content || "",
          m.content,
          false,
          isMemo
        );
      }
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function injectStyles() {
    var css =
      "#qc-launch{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(37,99,235,.35);font-size:24px;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .08s}" +
      "#qc-launch:hover{transform:translateY(-2px)}" +
      "#qc-panel{position:fixed;right:20px;bottom:88px;width:420px;max-width:calc(100vw - 32px);height:640px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #e5e7eb;border-radius:20px;z-index:2147483000;display:none;flex-direction:column;overflow:hidden;box-shadow:0 24px 72px rgba(15,23,42,.18);font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard','Segoe UI',system-ui,sans-serif}" +
      "#qc-panel.open{display:flex}" +
      "#qc-head{background:#fff;color:#111827;padding:15px 17px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #eef0f3}" +
      "#qc-head b{font-size:15px}#qc-head .qc-sub{font-size:11px;color:#94a3b8;margin-left:auto;margin-right:8px}" +
      "#qc-close{width:30px;height:30px;background:transparent;border:none;border-radius:8px;color:#64748b;font-size:22px;cursor:pointer;line-height:1;padding:0}#qc-close:hover{background:#f3f4f6;color:#111827}" +
      "#qc-modebar{display:none;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;background:#eef1fc;border-bottom:1px solid #dfe4fb;font-size:12.5px;color:#2563eb;font-weight:600}" +
      "#qc-modebar button{background:#fff;border:1px solid #c9d2f7;color:#2563eb;border-radius:7px;font-size:11.5px;padding:3px 9px;cursor:pointer;font-family:inherit;font-weight:500}" +
      "#qc-modebar button:hover{background:#e4e9fc}" +
      "#qc-model{background:#fff;border:1px solid #c9d2f7;color:#2563eb;border-radius:7px;font-size:11.5px;padding:3px 6px;font-family:inherit;cursor:pointer}" +
      "#qc-msgs{flex:1;overflow-y:auto;padding:22px 18px;background:#fff;display:flex;flex-direction:column;gap:20px;scrollbar-gutter:stable}" +
      ".qc-row{display:flex;min-width:0}.qc-row.me{justify-content:flex-end}.qc-row.ai{display:grid;grid-template-columns:28px minmax(0,1fr);column-gap:10px;align-items:start}" +
      ".qc-row.ai:before{content:'Q';display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;font-weight:750;line-height:1}" +
      ".qc-b{font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word}" +
      ".qc-row.ai .qc-b{max-width:100%;padding:2px 4px 0 0;background:transparent;border:0;color:#111827}" +
      ".qc-row.me .qc-b{max-width:78%;padding:10px 14px;border-radius:18px;background:#f2f3f5;color:#111827}" +
      ".qc-b.err{color:#b42318}" +
      ".qc-bar{grid-column:2;display:flex;gap:2px;align-items:center;flex-wrap:wrap;margin-top:4px;opacity:0;transition:opacity .15s}" +
      ".qc-row.ai:hover .qc-bar,.qc-row.ai:focus-within .qc-bar{opacity:1}" +
      ".qc-bar button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;background:transparent;border:0;border-radius:7px;font-size:13px;color:#64748b;cursor:pointer;line-height:1;font-family:inherit}" +
      ".qc-bar button:hover,.qc-bar button:focus-visible{background:#f1f3f5;color:#111827;outline:none}.qc-bar button.on{background:#eef2ff;color:#2563eb}" +
      ".qc-bar button.prim{width:auto;padding:0 8px;border:1px solid #dfe4eb;color:#2563eb;font-size:11.5px}" +
      ".qc-fb{grid-column:2;display:none;flex-direction:column;gap:7px;margin-top:7px;max-width:420px}.qc-fb.open{display:flex}" +
      ".qc-fb textarea{border:1px solid #d7dbe2;border-radius:10px;padding:8px 10px;font:inherit;font-size:12.5px;resize:none;outline:none}.qc-fb textarea:focus{border-color:#9ca3af}" +
      ".qc-fb .frow{display:flex;gap:6px;justify-content:flex-end}.qc-fb .frow button{font-size:11.5px;border-radius:8px;padding:5px 10px;cursor:pointer;border:0;background:#f1f3f5;font-family:inherit}.qc-fb .frow .send{background:#111827;color:#fff}" +
      ".qc-note{font-size:11px;color:#16a34a;margin-top:4px}" +
      "#qc-chips{display:flex;flex-wrap:wrap;gap:7px;padding:0 18px 14px;background:#fff}" +
      ".qc-chip{font-size:12px;color:#334155;background:#fff;border:1px solid #dfe3ea;border-radius:999px;padding:7px 11px;cursor:pointer;font-family:inherit}.qc-chip:hover{background:#f8fafc;border-color:#b8c1ce}" +
      "#qc-foot{padding:10px 12px 12px;background:#fff}" +
      "#qc-inrow{display:flex;gap:6px;align-items:flex-end;padding:6px 7px 6px 13px;border:1px solid #d7dbe2;border-radius:24px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.05)}#qc-inrow:focus-within{border-color:#9ca3af;box-shadow:0 0 0 3px rgba(37,99,235,.08)}" +
      "#qc-in{flex:1;resize:none;border:0;padding:8px 2px;font:inherit;font-size:14px;line-height:1.5;max-height:110px;outline:none;background:transparent;color:#111827}" +
      "#qc-mic,#qc-send{flex:0 0 auto;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;padding:0;cursor:pointer}" +
      "#qc-mic{background:transparent;color:#64748b}#qc-mic:hover:not(:disabled){background:#f1f3f5;color:#111827}#qc-mic.listening{background:#fee2e2;color:#dc2626;animation:qc-pulse 1.25s ease-in-out infinite}#qc-mic:disabled{color:#cbd5e1;cursor:not-allowed}" +
      "#qc-mic svg,#qc-send svg{width:19px;height:19px;pointer-events:none}" +
      "#qc-send{background:#111827;color:#fff}#qc-send:hover:not(:disabled){background:#000}#qc-send:disabled{background:#d1d5db;cursor:default}" +
      ".qc-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}" +
      "@keyframes qc-pulse{50%{box-shadow:0 0 0 5px rgba(220,38,38,.11)}}" +
      "#qc-disc{font-size:10.5px;color:#94a3b8;text-align:center;margin-top:6px}";
    css +=
      "#qc-panel.qc-inline{position:relative!important;inset:auto!important;width:100%!important;max-width:none!important;height:auto;max-height:none;background:transparent;border:0;border-radius:0;box-shadow:none;z-index:1;display:flex;overflow:visible}" +
      "#qc-panel.qc-inline #qc-head,#qc-panel.qc-inline #qc-modebar,#qc-panel.qc-inline #qc-disc{display:none!important}" +
      "#qc-panel.qc-inline:not(.qc-idle){overflow:hidden;border:1px solid #e2e5ea;border-radius:24px;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.06)}" +
      "#qc-panel.qc-inline #qc-msgs{order:1;flex:none;max-height:410px;min-height:0;margin:0;padding:26px 26px 18px;border:0;border-radius:0;background:#fff;text-align:left}" +
      "#qc-panel.qc-inline.qc-idle #qc-msgs{display:none}" +
      "#qc-panel.qc-inline #qc-foot{order:2;padding:0 20px 20px;border:0;background:#fff}" +
      "#qc-panel.qc-inline #qc-inrow{min-height:54px;padding:7px 8px 7px 16px;border-color:#d5d8de;border-radius:28px;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.06)}" +
      "#qc-panel.qc-inline #qc-in{min-height:24px;max-height:120px;padding:8px 2px;border:0;background:transparent;color:#111318;font-size:15px;line-height:1.5;box-shadow:none}" +
      "#qc-panel.qc-inline #qc-in:focus{border:0;box-shadow:none}" +
      "#qc-panel.qc-inline.qc-idle #qc-foot{padding:0;background:transparent}" +
      "#qc-panel.qc-inline.qc-idle #qc-inrow{min-height:158px;gap:8px;align-items:flex-end;padding:24px;border:1px solid #d5d8de;border-radius:28px;background:#fff;box-shadow:0 14px 38px rgba(15,23,42,.07)}" +
      "#qc-panel.qc-inline.qc-idle #qc-in{min-height:94px;max-height:150px;padding:8px 10px;font-size:21px;line-height:1.55}" +
      "#qc-panel.qc-inline.qc-idle #qc-mic,#qc-panel.qc-inline.qc-idle #qc-send{width:50px;height:50px}" +
      "#qc-panel.qc-inline #qc-chips{order:3;justify-content:center;gap:9px;padding:22px 0 0;background:transparent}" +
      "#qc-panel.qc-inline .qc-chip{min-height:42px;padding:9px 15px;border-color:#d7dbe3;background:#fff;color:#5f6670;font-size:13px}" +
      "#qc-panel.qc-inline .qc-chip:hover{border-color:#9db7f4;background:#f3f6ff;color:#1f57d6}" +
      "html[data-theme='dark'] #qc-panel.qc-inline #qc-inrow{border-color:#363c47;background:#14171d}" +
      "html[data-theme='dark'] #qc-panel.qc-inline #qc-in{color:#e7ebf2}" +
      "html[data-theme='dark'] #qc-panel.qc-inline #qc-msgs{border-color:#272c35;background:#1a1e26}" +
      "html[data-theme='dark'] #qc-panel.qc-inline .qc-chip{border-color:#363c47;background:#14171d;color:#b5bdc9}" +
      "@media(max-width:700px){#qc-panel.qc-inline.qc-idle #qc-inrow{min-height:132px;padding:18px;border-radius:22px}#qc-panel.qc-inline.qc-idle #qc-in{min-height:76px;font-size:17px}#qc-panel.qc-inline.qc-idle #qc-mic,#qc-panel.qc-inline.qc-idle #qc-send{width:44px;height:44px}#qc-panel.qc-inline #qc-chips{justify-content:center;overflow:visible;flex-wrap:wrap}#qc-panel.qc-inline .qc-chip{white-space:nowrap}}";
    var s = el("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  function addUserRow(text) {
    var row = el("div", "qc-row me");
    row.appendChild(el("div", "qc-b", text));
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return row;
  }
  function addAiRow() {
    var row = el("div", "qc-row ai");
    var b = el("div", "qc-b");
    row.appendChild(b);
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return { row: row, bubble: b };
  }

  function sendFeedback(p) {
    p.pageUrl = location.href;
    fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).catch(function () {});
  }

  function extractMemo(t) {
    t = t || "";
    // "메모 초안:" 또는 "스타일 메모:" 뒤 본문만 추출(폼 칸에 넣기 좋게)
    var markers = ["메모 초안", "스타일 메모"];
    for (var k = 0; k < markers.length; k++) {
      var i = t.indexOf(markers[k]);
      if (i >= 0) {
        var rest = t
          .slice(i)
          .replace(/^(메모\s*초안|스타일\s*메모)\s*[:：]?\s*/, "");
        return rest.trim() || t.trim();
      }
    }
    return t.trim();
  }

  // 모드 바: 메모/스타일 모드에서만 보이고 라벨·모델 선택을 갱신
  function updateModebar() {
    var mb = document.getElementById("qc-modebar");
    if (!mb) return;
    mb.style.display = isAssist() ? "flex" : "none";
    var lbl = document.getElementById("qc-modelabel");
    if (lbl)
      lbl.textContent = currentMode === "style" ? "✍️ 글 스타일 도우미" : "📝 메모 작성 도우미";
    if (modelSel) {
      modelSel.style.display = waEnabled && waModels.length ? "" : "none";
    }
  }

  function attachBar(row, snapshot, question, answer, isError, isMemo) {
    var bar = el("div", "qc-bar");
    if (!isError) {
      if (isMemo) {
        var copy = el("button", "prim", "📋 복사");
        copy.onclick = function () {
          try {
            navigator.clipboard.writeText(extractMemo(answer));
            copy.textContent = "복사됨!";
            setTimeout(function () {
              copy.textContent = "📋 복사";
            }, 1200);
          } catch (e) {}
        };
        bar.appendChild(copy);
        if (memoTarget) {
          var ins = el("button", "prim", "↧ 입력칸에 넣기");
          ins.onclick = function () {
            var ta = document.getElementById(memoTarget);
            if (ta) {
              ta.value = extractMemo(answer);
              ta.dispatchEvent(new Event("input", { bubbles: true }));
              row.appendChild(el("div", "qc-note", "입력칸에 넣었어요 ✓"));
            }
          };
          bar.appendChild(ins);
        }
      } else {
        var up = el("button", null, "👍");
        var down = el("button", null, "👎");
        up.title = "도움이 됐어요";
        down.title = "별로예요";
        up.setAttribute("aria-label", "도움이 됐어요");
        down.setAttribute("aria-label", "별로예요");
        up.onclick = function () {
          up.classList.add("on");
          down.classList.remove("on");
          sendFeedback({ rating: "up", question: question, answer: answer });
        };
        down.onclick = function () {
          down.classList.add("on");
          up.classList.remove("on");
          sendFeedback({ rating: "down", question: question, answer: answer });
        };
        bar.appendChild(up);
        bar.appendChild(down);
      }
    }
    var regen = el("button", null, "↻");
    regen.title = "다시 시도";
    regen.setAttribute("aria-label", "다시 시도");
    regen.onclick = function () {
      if (busy) return;
      regenerate(row, snapshot);
    };
    bar.appendChild(regen);

    if (!isError) {
      var opin = el("button", null, "✎");
      opin.title = "의견 보내기";
      opin.setAttribute("aria-label", "의견 보내기");
      bar.appendChild(opin);
      row.appendChild(bar);
      var fb = el("div", "qc-fb");
      var ta2 = el("textarea");
      ta2.rows = 2;
      ta2.placeholder = "버그·개선 의견을 적어주세요";
      var frow = el("div", "frow");
      var cancel = el("button", null, "취소");
      var sendb = el("button", "send", "보내기");
      cancel.onclick = function () {
        fb.classList.remove("open");
      };
      sendb.onclick = function () {
        var c = (ta2.value || "").trim();
        if (!c) return;
        sendFeedback({
          rating: "comment",
          comment: c,
          question: question,
          answer: answer,
        });
        fb.classList.remove("open");
        opin.style.display = "none";
        row.appendChild(el("div", "qc-note", "의견을 보냈어요."));
      };
      opin.onclick = function () {
        fb.classList.toggle("open");
        if (fb.classList.contains("open")) ta2.focus();
      };
      frow.appendChild(cancel);
      frow.appendChild(sendb);
      fb.appendChild(ta2);
      fb.appendChild(frow);
      row.appendChild(fb);
    } else {
      row.appendChild(bar);
    }
  }

  function regenerate(row, snapshot) {
    messages = snapshot.slice();
    var n = row;
    var rm = [];
    while (n) {
      rm.push(n);
      n = n.nextElementSibling;
    }
    rm.forEach(function (x) {
      x.remove();
    });
    streamAssistant();
  }

  function streamAssistant() {
    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    var snapshot = messages.slice();
    var question = (snapshot[snapshot.length - 1] || {}).content || "";
    var isMemo = isAssist();
    var ai = addAiRow();
    ai.bubble.textContent = "…";

    var body = {
      messages: snapshot.slice(-8),
      mode: isAssist() ? "memo" : currentMode,
      context: pageContext(),
    };
    if (currentMode === "memo" && memoReportType) body.reportType = memoReportType;
    // 메모/스타일 모드 + 유료 도우미 사용 가능 → Sonnet/GPT 라우팅
    if (isAssist()) {
      body.assistKind = currentMode === "style" ? "style" : "memo";
      if (waEnabled && waModel) body.model = waModel;
    }

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
            if (r.done) return acc;
            acc += dec.decode(r.value, { stream: true });
            ai.bubble.textContent = acc;
            msgsEl.scrollTop = msgsEl.scrollHeight;
            return pump();
          });
        }
        return pump();
      })
      .then(function (acc) {
        if (!acc || !acc.trim()) {
          ai.bubble.textContent = "(응답이 없습니다. 다시 시도해 주세요.)";
          attachBar(ai.row, snapshot, question, "", true, isMemo);
        } else {
          messages.push({ role: "assistant", content: acc });
          attachBar(ai.row, snapshot, question, acc, false, isMemo);
          save();
        }
      })
      .catch(function (e) {
        ai.bubble.classList.add("err");
        ai.bubble.textContent = e.message || "오류가 발생했어요.";
        attachBar(ai.row, snapshot, question, "", true, isMemo);
      })
      .then(function () {
        busy = false;
        if (sendBtn) sendBtn.disabled = false;
        if (inputEl) inputEl.focus();
        msgsEl.scrollTop = msgsEl.scrollHeight;
      });
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    var wasInlineIdle = !!(panel && panel.classList.contains("qc-inline") && panel.classList.contains("qc-idle"));
    if (wasInlineIdle && msgsEl) msgsEl.innerHTML = "";
    if (wasInlineIdle && inputEl) inputEl.placeholder = INLINE_HELP_PLACEHOLDER;
    if (panel) panel.classList.remove("qc-idle");
    if (chipsEl) chipsEl.style.display = "none";
    addUserRow(text);
    messages.push({ role: "user", content: text });
    save();
    inputEl.value = "";
    inputEl.style.height = "auto";
    streamAssistant();
  }

  function setVoiceStatus(active, message) {
    listening = !!active;
    if (micBtn) {
      micBtn.classList.toggle("listening", listening);
      micBtn.setAttribute("aria-pressed", listening ? "true" : "false");
      micBtn.setAttribute("aria-label", listening ? "음성 입력 중지" : "음성으로 입력");
      micBtn.title = listening ? "듣고 있어요. 누르면 중지합니다." : "음성으로 입력";
    }
    if (voiceStatusEl) voiceStatusEl.textContent = message || "";
  }

  function setupVoiceInput() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!micBtn) return;
    if (!SpeechRecognition) {
      micBtn.disabled = true;
      micBtn.title = "이 브라우저에서는 음성 입력을 지원하지 않습니다.";
      micBtn.setAttribute("aria-label", "음성 입력을 지원하지 않는 브라우저입니다");
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = function () {
      setVoiceStatus(true, "듣고 있어요. 말씀해 주세요.");
    };
    recognition.onresult = function (event) {
      var transcript = "";
      for (var i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      var prefix = voiceBaseValue && !/\s$/.test(voiceBaseValue) ? voiceBaseValue + " " : voiceBaseValue;
      inputEl.value = prefix + transcript.trim();
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    };
    recognition.onerror = function (event) {
      var denied = event && (event.error === "not-allowed" || event.error === "service-not-allowed");
      setVoiceStatus(false, denied ? "마이크 권한이 필요합니다." : "음성을 인식하지 못했어요. 다시 눌러 주세요.");
    };
    recognition.onend = function () {
      setVoiceStatus(false, inputEl && inputEl.value.trim() ? "음성이 입력되었습니다. 내용을 확인한 뒤 전송하세요." : "음성 입력이 종료되었습니다.");
      if (inputEl) inputEl.focus();
    };
    micBtn.onclick = function () {
      if (listening) {
        recognition.stop();
        return;
      }
      voiceBaseValue = inputEl.value || "";
      try {
        recognition.start();
      } catch (e) {
        setVoiceStatus(false, "음성 입력을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    };
  }

  function renderChips(list) {
    chipsEl.innerHTML = "";
    list.forEach(function (q) {
      var c = el("button", "qc-chip", q);
      c.onclick = function () {
        send(q);
      };
      chipsEl.appendChild(c);
    });
    chipsEl.style.display = "flex";
  }

  function showIntro() {
    msgsEl.innerHTML = "";
    var greet =
      currentMode === "style"
        ? STYLE_GREETING
        : currentMode === "memo"
          ? MEMO_GREETING
          : HELP_GREETING;
    var chips = isHomeInlineIdle()
      ? HOME_IDLE_SUGGESTIONS
      : currentMode === "style"
        ? STYLE_SUGGESTIONS
        : currentMode === "memo"
          ? MEMO_SUGGESTIONS
          : HELP_SUGGESTIONS;
    addAiRow().bubble.textContent = greet;
    renderChips(chips);
  }

  function setMode(mode) {
    if (busy) return;
    currentMode = mode;
    if (mode === "help") memoTarget = null;
    updateModebar();
    messages = [];
    showIntro();
    save();
  }

  function buildPanel() {
    inlineMount = helpEnabled ? document.getElementById("quiloBotMount") : null;
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

    // 메모/스타일 모드일 때만 보이는 안내 바(모델 선택 + 일반 도움말로 돌아가기).
    var modebar = el("div");
    modebar.id = "qc-modebar";
    var mlabel = el("span", null, "📝 메모 작성 도우미");
    mlabel.id = "qc-modelabel";
    modebar.appendChild(mlabel);
    var mright = el("div");
    mright.style.display = "flex";
    mright.style.alignItems = "center";
    mright.style.gap = "6px";
    modelSel = el("select");
    modelSel.id = "qc-model";
    modelSel.title = "AI 모델 선택";
    modelSel.style.display = "none";
    modelSel.onchange = function () {
      waModel = modelSel.value;
      try {
        localStorage.setItem("quiloWaModel", waModel);
      } catch (e) {}
    };
    mright.appendChild(modelSel);
    var mback = el("button", null, "일반 도움말 ✕");
    mback.onclick = function () {
      if (helpEnabled) setMode("help");
      else toggle();
    };
    mright.appendChild(mback);
    modebar.appendChild(mright);
    panel.appendChild(modebar);

    msgsEl = el("div");
    msgsEl.id = "qc-msgs";
    panel.appendChild(msgsEl);

    chipsEl = el("div");
    chipsEl.id = "qc-chips";
    panel.appendChild(chipsEl);

    var foot = el("div");
    foot.id = "qc-foot";
    var inrow = el("div");
    inrow.id = "qc-inrow";
    inputEl = el("textarea");
    inputEl.id = "qc-in";
    inputEl.rows = 1;
    inputEl.placeholder = DEFAULT_INPUT_PLACEHOLDER;
    inputEl.addEventListener("input", function () {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + "px";
    });
    inputEl.addEventListener("compositionstart", function () {
      composingInput = true;
    });
    inputEl.addEventListener("compositionend", function () {
      composingInput = false;
    });
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        // Korean/Japanese/Chinese IMEs use Enter to confirm the active
        // composition. Sending during that keydown leaves the final syllable
        // behind in the textarea (for example, "안녕" sends but "녕" remains).
        if (composingInput || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        send(inputEl.value);
      }
    });
    micBtn = el("button");
    micBtn.id = "qc-mic";
    micBtn.type = "button";
    micBtn.setAttribute("aria-label", "음성으로 입력");
    micBtn.setAttribute("aria-pressed", "false");
    micBtn.title = "음성으로 입력";
    micBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.75 11.5V12a6.25 6.25 0 0 0 12.5 0v-.5M12 18.25V22M8.5 22h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    sendBtn = el("button");
    sendBtn.id = "qc-send";
    sendBtn.type = "button";
    sendBtn.setAttribute("aria-label", "메시지 전송");
    sendBtn.title = "메시지 전송";
    sendBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (inlineMount) {
      inputEl.placeholder = HOME_IDLE_PLACEHOLDER;
    }
    sendBtn.onclick = function () {
      send(inputEl.value);
    };
    inrow.appendChild(inputEl);
    inrow.appendChild(micBtn);
    inrow.appendChild(sendBtn);
    foot.appendChild(inrow);
    voiceStatusEl = el("div", "qc-sr");
    voiceStatusEl.id = "qc-voice-status";
    voiceStatusEl.setAttribute("role", "status");
    voiceStatusEl.setAttribute("aria-live", "polite");
    foot.appendChild(voiceStatusEl);
    var disc = el(
      "div",
      null,
      "AI 도우미 · 부정확할 수 있어요. 중요한 건 직접 확인하세요."
    );
    disc.id = "qc-disc";
    foot.appendChild(disc);
    panel.appendChild(foot);

    if (inlineMount) {
      panel.classList.add("qc-inline", "open", "qc-idle");
      inlineMount.replaceChildren(panel);
    } else {
      document.body.appendChild(panel);
    }
    setupVoiceInput();
  }

  function switchToFloating() {
    if (!panel || !panel.classList.contains("qc-inline")) return;
    var wasInlineIdle = panel.classList.contains("qc-idle");
    panel.classList.remove("qc-inline", "qc-idle");
    panel.classList.remove("open");
    if (inputEl) inputEl.placeholder = DEFAULT_INPUT_PLACEHOLDER;
    if (wasInlineIdle && currentMode === "help" && !messages.length) showIntro();
    document.body.appendChild(panel);
  }

  function toggle() {
    var opening = !panel.classList.contains("open");
    panel.classList.toggle("open");
    if (opening && !openedOnce) {
      openedOnce = true;
      if (messages.length) restoreConversation();
      else showIntro();
    }
    if (opening) setTimeout(function () { inputEl.focus(); }, 50);
  }

  function init() {
    injectStyles();
    // 홈에서는 중앙 Bot을 쓰고, 로그인 후 작업 화면으로 전환되면 같은 패널을 런처로 연다.
    if (helpEnabled) {
      var launch = el("button", null, "💬");
      launch.id = "qc-launch";
      if (document.getElementById("quiloBotMount")) launch.classList.add("qc-home-launch");
      launch.setAttribute("aria-label", "Quilo 도우미 열기");
      launch.onclick = function () {
        switchToFloating();
        toggle();
      };
      document.body.appendChild(launch);
    }
    buildPanel();
    load();
    if (inlineMount) {
      openedOnce = true;
      if (messages.length) {
        panel.classList.remove("qc-idle");
        inputEl.placeholder = currentMode === "help" ? INLINE_HELP_PLACEHOLDER : DEFAULT_INPUT_PLACEHOLDER;
        restoreConversation();
      } else {
        showIntro();
      }
    }
    // 모델 셀렉터 채우기 (Sonnet / GPT-5.4-mini)
    if (modelSel) {
      modelSel.innerHTML = "";
      waModels.forEach(function (m) {
        var o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.label;
        modelSel.appendChild(o);
      });
      var saved = null;
      try {
        saved = localStorage.getItem("quiloWaModel");
      } catch (e) {}
      if (saved && waModels.some(function (m) { return m.id === saved; })) waModel = saved;
      else if (waModels[0]) waModel = waModels[0].id;
      if (waModel) modelSel.value = waModel;
    }
    // 폼/설정의 'AI 메모/스타일 작성 도움' 버튼들 노출
    var btns = document.querySelectorAll(".qc-memo-btn, .qc-style-btn");
    for (var i = 0; i < btns.length; i++) btns[i].style.display = "";
  }

  // 폼/설정에서 호출: 메모 또는 스타일 모드로 패널 열기. kind: "memo"(기본) | "style"
  window.Quilo.openMemo = function (targetId, kind) {
    if (!panel) return; // 위젯이 꺼져 있으면 무시
    switchToFloating();
    memoTarget = targetId || null;
    memoReportType = kind === "style" ? "" : reportTypeFromTarget(targetId);
    openedOnce = true;
    panel.classList.add("open");
    setMode(kind === "style" ? "style" : "memo");
    setTimeout(function () {
      if (inputEl) inputEl.focus();
    }, 60);
  };
  window.Quilo.openStyle = function (targetId) {
    window.Quilo.openMemo(targetId, "style");
  };

  Promise.all([
    fetch("/api/chat/status")
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; }),
    fetch("/api/write-assist/models")
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; }),
  ])
    .then(function (arr) {
      var cs = arr[0] || {};
      var wa = arr[1] || {};
      helpEnabled = !!cs.enabled;
      waEnabled = !!(wa.enabled && wa.loggedIn);
      waModels = (wa.models || []).map(function (m) {
        return { id: m.id, label: m.label };
      });
      if (helpEnabled || waEnabled) {
        if (document.readyState === "loading")
          document.addEventListener("DOMContentLoaded", init);
        else init();
      }
    })
    .catch(function () {});
})();
