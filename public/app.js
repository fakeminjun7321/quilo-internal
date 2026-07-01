/* Quilo frontend app. Extracted from index.html; keep server form field contracts stable. */
let currentStudentId = "";
      const USE_POLICY_NOTE =
        "학습 보조 초안입니다. 권한 있는 파일만 업로드하고, 학교·교사 기준을 확인한 뒤 직접 검토·수정해 사용하세요. 그대로 제출하면 안 됩니다.";

      function normalizeStudentId(value) {
        return String(value || "").trim().slice(0, 20);
      }

      function setStudentIdUi(value) {
        currentStudentId = normalizeStudentId(value);
        document.getElementById("settingsStudentId").textContent =
          currentStudentId || "미설정";
        document.getElementById("settingsStudentIdInput").value = currentStudentId;
        // 학번 변경 시 학번 안내 배너 갱신.
        if (typeof updateStudentIdBanners === "function") updateStudentIdBanners();
      }

      // ── 학번 안내 배너 (학번 필수 폼) ────────────────────────────────────
      // 물리 결과·물리/수학 수행평가는 표지에 학번이 들어간다. 저장된 학번이 없으면
      // 폼 상단에 '설정에서 추가' 인라인 배너를 띄운다. (기존 alert 검증은 유지.)
      const STUDENT_ID_FORMS = ["phys-result", "phys-inquiry", "math-inquiry"];
      function ensureStudentIdBanner(formEl) {
        if (!formEl) return null;
        let banner = formEl.querySelector(":scope > .studentid-banner");
        if (banner) return banner;
        banner = document.createElement("div");
        banner.className = "notice studentid-banner";
        banner.hidden = true;
        banner.style.cssText = "margin:0 0 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap";
        const txt = document.createElement("span");
        txt.innerHTML = "🎓 표지에 들어갈 <b>학번</b>이 없어요. 저장하면 보고서 표지·파일명에 자동으로 들어갑니다.";
        const link = document.createElement("button");
        link.type = "button";
        link.className = "link-button studentid-banner-link";
        link.textContent = "설정에서 학번 추가 →";
        link.style.cssText = "font-size:13px;color:var(--accent-text);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0";
        link.addEventListener("click", () => {
          if (typeof showTab === "function") showTab("settings");
          const input = document.getElementById("settingsStudentIdInput");
          if (input) { try { input.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} input.focus(); }
        });
        banner.append(txt, link);
        // flow-steps 다음(폼 최상단)에 삽입.
        const flow = formEl.querySelector(":scope > .form-flow-steps");
        if (flow && flow.nextSibling) formEl.insertBefore(banner, flow.nextSibling);
        else formEl.insertBefore(banner, formEl.firstChild);
        return banner;
      }
      function updateStudentIdBanners() {
        const missing = !currentStudentId;
        STUDENT_ID_FORMS.forEach((type) => {
          const formEl = document.querySelector('[data-report-form="' + type + '"]');
          if (!formEl) return;
          const banner = ensureStudentIdBanner(formEl);
          if (banner) banner.hidden = !missing;
        });
      }

      function getLocalStudentId() {
        try {
          return normalizeStudentId(localStorage.getItem("studentId") || "");
        } catch (_) {
          return "";
        }
      }

      // ── 비로그인 클릭 의도 보존 (pendingReportType) ──────────────────────
      // 로그아웃 상태에서 보고서 종류를 누르면 sessionStorage 에 저장해 두고,
      // 로그인/초기화 후 해당 종류를 자동 선택한 뒤 제거한다.
      const PENDING_REPORT_KEY = "pendingReportType";
      function setPendingReportType(type) {
        try {
          if (type) sessionStorage.setItem(PENDING_REPORT_KEY, String(type));
        } catch (_) { /* private mode 등 */ }
      }
      // ── 마지막 선택 기억 (lastReportPrefs) ───────────────────────────────
      // 마지막으로 '성공 생성'한 reportType·model·format·fontFace 를 이 브라우저에
      // 저장하고, 페이지 로드 시 폼에 복원한다. 기존 prefModel/prefStyle(명시 기본값)이
      // 있으면 그쪽이 우선이므로, 이 복원은 그 전에 적용한다.
      const LAST_PREFS_KEY = "lastReportPrefs";
      let _pendingGenPrefs = null; // submit 시점 캡처 → done 에서 저장
      function readLastPrefs() {
        try { return JSON.parse(localStorage.getItem(LAST_PREFS_KEY) || "{}") || {}; }
        catch (_) { return {}; }
      }
      function saveLastPrefs(p) {
        if (!p) return;
        try {
          const clean = {};
          if (p.type) clean.type = String(p.type);
          if (p.model) clean.model = String(p.model);
          if (p.format) clean.format = String(p.format);
          if (p.fontFace) clean.fontFace = String(p.fontFace);
          localStorage.setItem(LAST_PREFS_KEY, JSON.stringify(clean));
        } catch (_) { /* private mode 등 */ }
      }
      // submit 직전 FormData 에서 정규화된 값(type/model/format/fontFace)을 캡처.
      function capturePendingGenPrefs(formData) {
        try {
          _pendingGenPrefs = {
            type: formData.get("type") || "",
            model: formData.get("model") || "",
            format: formData.get("format") || "",
            fontFace: formData.get("fontFace") || "",
          };
        } catch (_) { _pendingGenPrefs = null; }
      }
      // 생성 성공(done) 시 호출 — 캡처해 둔 값을 저장한다.
      function commitLastGenPrefs() {
        if (_pendingGenPrefs) saveLastPrefs(_pendingGenPrefs);
      }
      // 페이지 로드 시: 폼의 model/format/fontFace 를 마지막 값으로 복원.
      // reportType 은 더 보수적으로 — 이미 선택된 것/딥링크/pending 이 없을 때만 복원한다.
      function restoreLastPrefs() {
        const p = readLastPrefs();
        if (!p || !Object.keys(p).length) return;
        try {
          if (p.model) {
            // 모델 라디오는 폼마다 기본값(Opus)이 이미 checked 라서, 마지막 모델이
            // 그 폼의 선택지로 존재하면 그 라디오로 교체한다(기본값 덮어쓰기).
            document
              .querySelectorAll('input[type="radio"][name$="odel"], input[type="radio"][name="model"]')
              .forEach((r) => {
                const nm = r.name || "";
                if (!/^model$|Model$/.test(nm)) return; // model, crModel, prModel ...
                if (r.value !== p.model || r.disabled) return;
                const lbl = r.closest("label");
                if (lbl && (lbl.hidden || lbl.style.display === "none")) return; // 숨김/제한된 선택지 제외
                r.checked = true;
              });
          }
          if (p.format) {
            document
              .querySelectorAll('input[name="format"], input[name="crFormat"], input[name="prFormat"], input[name="frFormat"], input[name="piFormat"], input[name="miFormat"]')
              .forEach((r) => { if (r.value === p.format && !r.disabled) r.checked = true; });
          }
          if (p.fontFace) {
            ["fontFace", "crFontFace", "prFontFace", "frFontFace", "piFontFace", "miFontFace"].forEach((id) => {
              const sel = document.getElementById(id);
              if (sel && [...sel.options].some((o) => o.value === p.fontFace && !o.disabled && !o.hidden)) {
                sel.value = p.fontFace;
              }
            });
          }
          if (typeof updateAllOptionalSummaries === "function") updateAllOptionalSummaries();
        } catch (_) { /* 복원 실패는 무시 */ }
      }

      // 로그인한 재방문자에게 마지막으로 만든 보고서 종류를 자동 선택해 준다.
      // 단, URL 딥링크(?report=)·pending·이미 선택된 종류가 있으면 양보한다.
      function restoreLastReportType() {
        if (document.body.dataset.auth === "out") return;
        try {
          if (new URLSearchParams(location.search).get("report")) return;
          if (sessionStorage.getItem(PENDING_REPORT_KEY)) return;
        } catch (_) { /* 무시 */ }
        if (document.querySelector('input[name="reportType"]:checked')) return;
        const p = readLastPrefs();
        if (!p || !p.type) return;
        const radio = document.querySelector('input[name="reportType"][value="' + p.type + '"]');
        if (!radio || radio.disabled) return;
        const label = radio.closest("label");
        if (label && label.style.display === "none") return; // 차단된 종류면 무시
        radio.checked = true;
        if (typeof updateReportTypeView === "function") updateReportTypeView();
      }

      function consumePendingReportType() {
        let type = "";
        try { type = sessionStorage.getItem(PENDING_REPORT_KEY) || ""; } catch (_) { return; }
        if (!type) return;
        // 로그인 상태에서만, 해당 라디오가 존재하고 선택 가능할 때 자동 선택.
        if (document.body.dataset.auth === "out") return;
        const radio = document.querySelector('input[name="reportType"][value="' + type + '"]');
        try { sessionStorage.removeItem(PENDING_REPORT_KEY); } catch (_) {}
        if (!radio || radio.disabled) return;
        const label = radio.closest("label");
        if (label && label.style.display === "none") return; // 차단된 종류면 무시
        radio.checked = true;
        if (typeof showTab === "function") showTab("reports");
        if (typeof updateReportTypeView === "function") updateReportTypeView({ scroll: true });
      }

      function getLocalStyleNote() {
        try { return localStorage.getItem("quiloStyleNote") || ""; } catch (_) { return ""; }
      }
      function saveLocalStyleNote(value) {
        try { localStorage.setItem("quiloStyleNote", value || ""); } catch (_) {}
      }
      function applySavedStyleNote(serverNote) {
        var note = serverNote != null && serverNote !== "" ? serverNote : getLocalStyleNote();
        if (note) saveLocalStyleNote(note);
        var s = document.getElementById("settingsStyleNote");
        if (s && !s.value) s.value = note;
        // 모든 보고서 폼의 문체 메모 칸에 저장된 스타일 노트를 채운다(비어 있을 때만).
        ["cpStyleNote", "crStyleNote", "prStyleNote", "piStyleNote", "miStyleNote", "frStyleNote"].forEach(function (id) {
          var el = document.getElementById(id);
          if (el && !el.value) el.value = note;
        });
      }
      function saveLocalStudentId(value) {
        try {
          localStorage.setItem("studentId", normalizeStudentId(value));
        } catch (_) { /* private mode etc. */ }
      }

      function appendPolicyAcknowledgements(fd) {
        fd.append("copyrightAccepted", "true");
        fd.append("academicIntegrityAccepted", "true");
        fd.append("policyAcceptedAt", new Date().toISOString());
      }

      // 로그인 전/후 같은 페이지(같은 골격). 로그아웃이면 리다이렉트 대신
      // 상단 '로그인' 드롭다운을 띄우고, 로그인하면 그 자리를 계정 메뉴로 바꾼다.
      // 차단된 보고서 종류 카드를 숨긴다(서버에서도 강제 — 이건 UX용).
      function applyReportTypeAccess(blocked) {
        const set = new Set(Array.isArray(blocked) ? blocked : []);
        document.querySelectorAll('input[name="reportType"]').forEach((radio) => {
          const label = radio.closest("label");
          if (!label) return;
          const hide = set.has(radio.value);
          label.style.display = hide ? "none" : "";
          if (hide && radio.checked) radio.checked = false;
        });
      }

      function applyAuth(loggedIn, d) {
        document.body.dataset.auth = loggedIn ? "in" : "out";
        document.body.classList.toggle("is-authenticated", loggedIn);
        const workspaceSummary = document.getElementById("workspaceSummary");
        if (workspaceSummary) workspaceSummary.hidden = !loggedIn;
        const loginDd = document.getElementById("loginDd");
        const acctDd = document.getElementById("acctDd");
        if (loginDd) loginDd.hidden = loggedIn;
        if (acctDd) acctDd.hidden = !loggedIn;
        if (loggedIn && d) {
          document.getElementById("user").textContent = d.user + " 님 ";
          document.getElementById("settingsUserName").textContent = d.user;
          setStudentIdUi(d.studentId || getLocalStudentId());
          applySavedStyleNote(d.styleNote);
          ["piWhoPreview", "miWhoPreview", "frWhoPreview"].forEach((pid) => {
            const whoEl = document.getElementById(pid);
            if (!whoEl) return;
            const sid = (d.studentId || getLocalStudentId() || "").trim();
            whoEl.textContent = sid
              ? `${sid} ${d.user || ""}`.trim()
              : `${d.user || "이름"} (학번 미설정 — 개인 설정에서 저장하세요)`;
          });
          document.getElementById("settingsUserRole").textContent = d.isAdmin
            ? "관리자"
            : "일반 사용자";
          if (d.isAdmin) {
            document.getElementById("adminLink").style.display = "inline";
            // Fable 5(관리자 전용 모델) 선택지 노출 — revealFable. 단 일시 차단 중이면 숨김 유지.
            if (!d.fableDisabled) {
              document.querySelectorAll("label.fable-model").forEach((l) => { l.hidden = false; });
            }
          }
          // 관리자는 서버에서 제한 면제 → 카드도 전부 표시
          applyReportTypeAccess(d.isAdmin ? [] : d.blockedReportTypes);
          if (!d.isAdmin) loadBalance();
          loadFiles();
          loadCloudStatus();
          applyVerificationState(d);
          // 비로그인 상태에서 누른 보고서 종류가 있으면 로그인 후 자동 선택.
          if (typeof consumePendingReportType === "function") consumePendingReportType();
          // pending/딥링크가 없으면 마지막으로 만든 종류를 자동 선택(재방문 편의).
          if (typeof restoreLastReportType === "function") restoreLastReportType();
        } else {
          applyReportTypeAccess([]);
          applyVerificationState(null);
        }
      }

      // ── 학생 인증(2단계) 배너 ────────────────────────────────────────────
      // 로그인했지만 (관리자가 아니고) 이메일 인증 또는 관리자 승인이 안 된 사용자에게
      // 인증 안내를 띄운다. 보고서 생성 자체는 서버(/api/generate)가 막는다.
      let _verifyState = { reportEligible: true };
      function applyVerificationState(d) {
        _verifyState = d || { reportEligible: true };
        const banner = document.getElementById("verifyBanner");
        if (!banner) return;
        // 로그아웃·관리자·자격충족이면 숨김.
        if (!d || d.isAdmin || d.reportEligible) {
          banner.hidden = true;
          document.body.dataset.reportEligible = d && !d.reportEligible ? "no" : "yes";
          return;
        }
        document.body.dataset.reportEligible = "no";
        banner.hidden = false;
        const title = document.getElementById("verifyTitle");
        const msg = document.getElementById("verifyMsg");
        const form = document.getElementById("verifyEmailForm");
        const input = document.getElementById("verifyEmailInput");
        const btn = document.getElementById("verifyEmailBtn");
        const label = document.getElementById("verifyEmailLabel");
        const domains = Array.isArray(d.allowedEmailDomains) && d.allowedEmailDomains.length
          ? d.allowedEmailDomains
          : ["ts.hs.kr"];
        if (label) label.textContent = `학교 이메일 (@${domains[0]})`;
        if (input && !input.value) input.placeholder = `ts250002@${domains[0]}`;

        if (!d.emailVerified) {
          // 1단계: 이메일 인증.
          if (title) title.textContent = "1단계 · 학교 이메일 인증";
          if (form) form.style.display = "flex";
          if (d.pendingEmail) {
            if (input && !input.value) input.value = d.pendingEmail;
            if (btn) btn.textContent = "인증 메일 다시 보내기";
            if (msg)
              msg.innerHTML =
                `<b>${escapeHtmlClient(d.pendingEmail)}</b> 로 인증 메일을 보냈습니다. 메일의 <b>이메일 인증하기</b> 버튼(또는 링크)을 누르세요. 메일이 안 보이면 스팸함을 확인하거나 아래에서 다시 보내세요.`;
          } else {
            if (btn) btn.textContent = "인증 메일 보내기";
            if (msg)
              msg.textContent = `학교 이메일(@${domains[0]})을 입력하면 인증 링크를 보내드립니다. 인증 후 관리자 승인을 받으면 보고서를 만들 수 있습니다.`;
          }
        } else {
          // 2단계: 관리자 승인 대기.
          if (title) title.textContent = "2단계 · 관리자 승인 대기 중";
          if (form) form.style.display = "none";
          if (msg)
            msg.innerHTML =
              "✅ 학교 이메일 인증이 완료되었습니다. <b>관리자 승인</b>을 기다려 주세요. 승인되면 보고서 생성을 사용할 수 있습니다.";
        }
      }

      function escapeHtmlClient(s) {
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      // 인증 메일 (재)요청 폼
      document
        .getElementById("verifyEmailForm")
        ?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const input = document.getElementById("verifyEmailInput");
          const btn = document.getElementById("verifyEmailBtn");
          const status = document.getElementById("verifyStatus");
          const email = (input?.value || "").trim();
          if (!email) return;
          if (btn) {
            btn.disabled = true;
            btn.dataset.label = btn.textContent;
            btn.textContent = "보내는 중...";
          }
          if (status) status.style.display = "none";
          try {
            const res = await fetch("/api/verify-email/request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "발송 실패");
            if (status) {
              status.style.display = "block";
              status.style.color = "var(--success,#16a34a)";
              status.textContent = data.alreadyVerified
                ? "이미 인증된 이메일입니다. 새로고침 해주세요."
                : `✅ ${email} 로 인증 메일을 보냈습니다. 메일의 링크를 눌러 인증을 완료하세요.`;
            }
            // pendingEmail 갱신을 위해 상태 다시 읽기
            try {
              const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null));
              if (me) applyVerificationState(me);
            } catch (_) {}
          } catch (ex) {
            if (status) {
              status.style.display = "block";
              status.style.color = "var(--danger,#dc2626)";
              status.textContent = ex.message;
            }
          } finally {
            if (btn) {
              btn.disabled = false;
              btn.textContent = btn.dataset.label || "인증 메일 보내기";
            }
          }
        });

      // Confirm session
      // ── 상단 공지 티커(마퀴) ──────────────────────────────────────────
      function safeAnnouncementUrl(link){
        const raw=String(link==null?"":link).trim();
        if(!raw) return "";
        if(raw.startsWith("/")) return raw;
        try{
          const u=new URL(raw, window.location.origin);
          return (u.protocol==="http:"||u.protocol==="https:")?u.href:"";
        }catch(_){return "";}
      }
      async function loadAnnouncements(){
        const ticker=document.getElementById("annTicker");
        const track=document.getElementById("annTrack");
        if(!ticker||!track) return;
        try{
          const r=await fetch("/api/announcements");
          const d=await r.json();
          const list=Array.isArray(d.announcements)?d.announcements:[];
          if(!list.length){ticker.hidden=true;return;}
          const item=(a)=>{
            const href=safeAnnouncementUrl(a.link);
            const wrap=document.createElement(href?"a":"span");
            wrap.className="ann-item";
            if(href){
              wrap.href=href;
              wrap.target="_blank";
              wrap.rel="noopener";
            }
            if(a.category){
              const cat=document.createElement("span");
              cat.className="ann-cat";
              cat.textContent=String(a.category);
              wrap.appendChild(cat);
            }
            const title=document.createElement("span");
            title.textContent=String(a.title||"");
            wrap.appendChild(title);
            const dot=document.createElement("span");
            dot.className="ann-dot";
            dot.textContent="•";
            return [wrap,dot];
          };
          const textLen=list.reduce((n,a)=>n+String(a.category||"").length+String(a.title||"").length+8,0);
          // 항목이 적으면 화면을 채우도록 반복
          let reps=1; while(textLen*reps<1600 && reps<12) reps++;
          const group=document.createElement("span");
          group.className="ann-group";
          for(let i=0;i<reps;i++) list.forEach((a)=>item(a).forEach((node)=>group.appendChild(node)));
          track.replaceChildren(group.cloneNode(true), group.cloneNode(true)); // 끊김 없는 루프용 2배 복제
          const dur=Math.max(20,Math.min(90,list.length*reps*5));
          track.style.setProperty("--ann-dur",dur+"s");
          ticker.hidden=false;
        }catch(e){ticker.hidden=true;}
      }
      loadAnnouncements();

      fetch("/api/me")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => applyAuth(true, d))
        .catch(() => applyAuth(false));

      // Dropbox 연결 콜백 결과 안내(+ URL 정리)
      try {
        const _cloud = new URLSearchParams(location.search).get("cloud");
        if (_cloud === "connected") {
          alert("✅ Dropbox가 연결되었습니다. 이제 생성한 보고서가 Dropbox 앱 폴더에 영구 저장됩니다.");
          history.replaceState({}, "", location.pathname);
        } else if (_cloud === "error") {
          alert("Dropbox 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          history.replaceState({}, "", location.pathname);
        }
      } catch (_) {}

      // 로그인 유지 사용자: 저장된 이름 미리 채우기
      try {
        const _saved = localStorage.getItem("lastUsername");
        const _u = document.getElementById("li_username");
        if (_saved && _u && !_u.value) _u.value = _saved;
      } catch (_) {}

      // 비밀번호 표시(눈) 토글: 가려진 비밀번호를 잠깐 보여줘 오타를 확인할 수 있게 한다.
      (function () {
        const EYE =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        const EYEOFF =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        function addPwToggle(input) {
          if (!input || input.dataset.pwToggle) return;
          input.dataset.pwToggle = "1";
          const wrap = document.createElement("span");
          wrap.style.cssText = "position:relative;display:block";
          input.parentNode.insertBefore(wrap, input);
          wrap.appendChild(input);
          input.style.paddingRight = "40px";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.tabIndex = -1;
          btn.setAttribute("aria-label", "비밀번호 표시");
          btn.title = "비밀번호 표시";
          btn.style.cssText =
            "position:absolute;top:50%;right:6px;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:none;border:0;cursor:pointer;color:#64748b;padding:0;border-radius:6px";
          btn.innerHTML = EYE;
          btn.addEventListener("click", () => {
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.innerHTML = show ? EYEOFF : EYE;
            const lab = show ? "비밀번호 숨기기" : "비밀번호 표시";
            btn.setAttribute("aria-label", lab);
            btn.title = lab;
          });
          wrap.appendChild(btn);
        }
        ["li_password", "currentPw", "newPw", "confirmPw"].forEach((id) =>
          addPwToggle(document.getElementById(id)),
        );
      })();

      // 로그인 폼(드롭다운) 제출
      document
        .getElementById("loginForm")
        ?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const err = document.getElementById("li_err");
          err.style.display = "none";
          const remember =
            document.getElementById("li_remember")?.checked !== false;
          const uname = document.getElementById("li_username").value;
          const body = {
            username: uname,
            password: document.getElementById("li_password").value,
            remember,
          };
          const btn = document.getElementById("li_btn");
          btn.disabled = true;
          btn.textContent = "로그인 중...";
          try {
            const res = await fetch("/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "로그인 실패");
            try {
              if (remember) localStorage.setItem("lastUsername", uname);
              else localStorage.removeItem("lastUsername");
            } catch (_) {}
            location.reload();
          } catch (ex) {
            err.textContent = ex.message;
            err.style.display = "block";
            btn.disabled = false;
            btn.textContent = "로그인";
          }
        });

      // 로그아웃 상태에서 보고서 종류를 누르면 로그인 드롭다운을 연다.
      function openLoginDropdown() {
        const dd = document.getElementById("loginDd");
        if (!dd || dd.hidden) return false;
        // 다음 틱에 연다 — 이 함수를 부른 클릭이 document 까지 버블링되며
        // closeAll() 이 돌아 방금 연 드롭다운을 즉시 닫는 것을 피한다.
        setTimeout(() => {
          document
            .querySelectorAll(".nav-dd.open")
            .forEach((d) => d.classList.remove("open"));
          dd.classList.add("open");
          document.getElementById("navMenu")?.classList.add("open");
          document.getElementById("li_username")?.focus();
        }, 0);
        return true;
      }

      // 히어로 '지금 시작하기': 로그아웃이면 로그인 드롭다운, 로그인이면 보고서 종류로.
      document.getElementById("heroStart")?.addEventListener("click", () => {
        if (document.body.dataset.auth === "out") {
          openLoginDropdown();
        } else {
          document
            .getElementById("reportTypes")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });

      // 모델별 차감 크레딧 (index.html 모델 라벨과 동일한 매핑). 확인 모달에서 사용.
      // mini=무료(0), GPT-5.4=1, Sonnet=2, Opus/GPT-5.5=4, Fable=9.
      const MODEL_CREDITS = {
        "claude-fable-5": 9,
        "claude-opus-4-8": 4,
        "claude-opus-4-7": 4,
        "claude-sonnet-5": 2,
        "gpt-5.5": 4,
        "gpt-5.4": 1,
        "gpt-5.4-mini": 0,
      };
      function getModelCredits(modelId) {
        return MODEL_CREDITS[modelId] != null ? MODEL_CREDITS[modelId] : 4;
      }

      // ── Wave2a: 크레딧 부족 시 더 싼/무료 모델로 회복 ─────────────────────
      // 폼 안의 model 라디오 중 '선택 가능(숨김/disabled 아님)' 한 것들을 모아
      // 크레딧 오름차순으로 정렬한다. label 의 display:none / hidden 은 제외.
      function listSelectableModelOptions(formEl, radioName) {
        if (!formEl || !radioName) return [];
        const out = [];
        formEl.querySelectorAll('input[name="' + radioName + '"]').forEach((r) => {
          if (r.disabled) return;
          const lbl = r.closest("label");
          // 숨김/제한된 선택지(예: 베타테스터 모델제한, Fable 비노출)는 제외.
          if (lbl && (lbl.hidden || lbl.style.display === "none")) return;
          out.push({ value: r.value, credits: getModelCredits(r.value), input: r });
        });
        out.sort((a, b) => a.credits - b.credits);
        return out;
      }
      // 잔액으로 감당 가능한 가장 싼(무료 우선) 선택지. 없으면 null.
      function findAffordableModelOption(formEl, radioName, balance) {
        const opts = listSelectableModelOptions(formEl, radioName);
        for (const o of opts) {
          if (o.credits <= balance) return o; // 오름차순이라 첫 감당 가능 = 가장 싼.
        }
        return null;
      }

      // 현재 잔액 스냅샷 (loadBalance 가 갱신). 확인 모달의 크레딧 행에서만 참조한다.
      let _balanceState = { known: false, credits: 0, unlimited: false, isAdmin: false };

      async function loadBalance() {
        try {
          const r = await fetch("/api/me/balance");
          if (!r.ok) return;
          const b = await r.json();
          if (b.isAdmin) { _balanceState = { known: true, credits: 0, unlimited: true, isAdmin: true }; return; } // admin은 잔액 X
          // 모델 제한 계정(예: 베타테스터): 허용 모델만 남기고 나머지 라디오 숨김
          if (b.restrictedModel) {
            document
              .querySelectorAll(
                'input[name="model"], input[name="crModel"], input[name="prModel"]',
              )
              .forEach((el) => {
                const lbl = el.closest("label");
                if (el.value !== b.restrictedModel) {
                  el.checked = false;
                  if (lbl) lbl.style.display = "none";
                } else {
                  el.checked = true;
                }
              });
          }
          const credits = Math.max(0, Math.trunc(Number(b.credits) || 0));
          _balanceState = { known: true, credits, unlimited: !!b.unlimited, isAdmin: false };
          const balCreditsEl = document.getElementById("balCredits");
          if (balCreditsEl) balCreditsEl.textContent = b.unlimited
            ? "무제한 (베타)"
            : `${credits} 크레딧`;
          const balanceBoxEl = document.getElementById("balanceBox");
          // 모델별 환산: 잔액이 보고서 몇 건인지 직관적으로 (개편: Sonnet 2 / Opus·GPT-5.5 4 / GPT-5.4 1 / mini 무료)
          if (!b.unlimited) {
            // 기본 모델(Opus) 1건당 크레딧으로 평이하게 환산. 무료 모델(mini)은 무제한.
            const opusCost = getModelCredits("claude-opus-4-8") || 4;
            const opusRuns = Math.floor(credits / opusCost);
            if (balCreditsEl) balCreditsEl.title =
              `≈ Sonnet ${Math.floor(credits / 2)}건 · Opus/GPT-5.5 ${opusRuns}건 · GPT-5.4 ${credits}건 · mini 무료`;
            const convEl = document.getElementById("balConvert");
            if (convEl) convEl.textContent =
              `기본(Opus)으로 약 ${opusRuns}건 · 무료 모델(GPT-5.4 mini)은 무제한`;
            // 기본 모델 1건도 못 만들 잔액이면 경고색으로 표시(부족 인지).
            if (balanceBoxEl) balanceBoxEl.classList.toggle("is-low", opusRuns < 1);
          } else if (balanceBoxEl) {
            balanceBoxEl.classList.remove("is-low");
          }
          if (balanceBoxEl) balanceBoxEl.style.display = "flex";
          document.querySelector(".report-toolbar")?.classList.add("has-balance");
        } catch (_) {
          /* graceful: 잔액 박스 숨김 */
        }
      }

      function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n}B`;
        if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
        return `${(n / 1024 / 1024).toFixed(1)}MB`;
      }

      function formatDateTime(value) {
        if (!value) return "-";
        return new Date(value).toLocaleString("ko-KR", {
          dateStyle: "short",
          timeStyle: "short",
        });
      }

      async function loadCloudStatus() {
        const card = document.getElementById("cloudCard");
        if (!card) return;
        const statusEl = document.getElementById("cloudStatus");
        const actions = document.getElementById("cloudActions");
        try {
          const r = await fetch("/api/cloud/status");
          if (!r.ok) {
            card.hidden = true;
            return;
          }
          const d = await r.json();
          const dp = (d && d.dropbox) || {};
          if (!dp.configured) {
            card.hidden = true; // 서버에 Dropbox 미설정 → 카드 숨김
            return;
          }
          card.hidden = false;
          if (dp.connected) {
            const note = document.createElement("span");
            note.className = "hint";
            note.textContent = "생성한 보고서가 Dropbox 앱 폴더에 영구 저장됩니다.";
            const br = document.createElement("br");
            const nodes = [document.createTextNode("✅ Dropbox 연결됨")];
            if (dp.email) {
              const email = document.createElement("b");
              email.textContent = String(dp.email);
              nodes.push(document.createTextNode(" — "), email);
            }
            statusEl.replaceChildren(...nodes, br, note);

            const btn = document.createElement("button");
            btn.type = "button";
            btn.id = "dbxDisconnectBtn";
            btn.className = "secondary compact";
            btn.textContent = "연결 해제";
            actions.replaceChildren(btn);
            if (btn)
              btn.addEventListener("click", async () => {
                if (!confirm("Dropbox 연결을 해제할까요? (이미 저장된 파일은 Dropbox에 그대로 남습니다)")) return;
                await fetch("/api/cloud/dropbox/disconnect", { method: "POST" });
                loadCloudStatus();
                if (typeof loadFiles === "function") loadFiles();
              });
          } else {
            const strong = document.createElement("b");
            strong.textContent = "24시간 파일함";
            statusEl.replaceChildren(
              document.createTextNode("연결 안 됨 — 보고서는 "),
              strong,
              document.createTextNode("에 저장됩니다."),
            );
            const isElectron = /electron|quilo/i.test(navigator.userAgent || "");
            if (isElectron) {
              // 데스크톱 앱(Electron)은 임베디드 브라우저라 Dropbox OAuth 가 막힌다.
              // 연결은 계정 단위로 저장되므로 웹사이트에서 한 번만 연결하면 앱에도 적용됨.
              const p = document.createElement("p");
              p.className = "hint";
              p.style.margin = "0";
              const b = document.createElement("b");
              b.textContent = "웹사이트(브라우저)";
              p.append(
                document.createTextNode("📱 데스크톱 앱에서는 보안상 여기서 바로 연결되지 않습니다. "),
                b,
                document.createTextNode("에서 같은 계정으로 로그인 후 한 번 연결하면, 이 앱에도 자동으로 적용됩니다."),
              );
              actions.replaceChildren(p);
            } else {
              const a = document.createElement("a");
              a.className = "btn btn-primary";
              a.href = "/api/cloud/dropbox/connect";
              a.textContent = "Dropbox 연결";
              actions.replaceChildren(a);
            }
          }
        } catch (_) {
          card.hidden = true;
        }
      }

      // '내 작업' — 백그라운드 작업의 진행/중단(완료본은 아래 파일 목록에 나타남).
      function bgEsc(s) {
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      const BG_TYPE_LABELS = {
        "chem-pre": "화학 사전보고서",
        "chem-result": "화학 결과보고서",
        "phys-result": "물리 결과보고서",
        "phys-inquiry": "물리 수행평가",
        "math-inquiry": "수학 수행평가",
        free: "자유 보고서",
        "problem-set": "문제집 메이커",
        "form-maker": "양식 메이커",
        "pdf-translate": "PDF 통번역",
      };
      async function renderBgJobs() {
        const list = document.getElementById("filesList");
        if (!list || !list.parentNode) return;
        let data = { jobs: [] };
        try {
          const r = await fetch("/api/me/jobs");
          if (r.ok) data = await r.json();
        } catch (_) {
          return;
        }
        const jobs = (data.jobs || []).filter(
          (j) =>
            j.status === "running" ||
            j.status === "interrupted" ||
            j.status === "error",
        );
        let block = document.getElementById("bgJobsBlock");
        if (!block) {
          block = document.createElement("div");
          block.id = "bgJobsBlock";
          block.style.cssText = "margin:0 0 14px";
          list.parentNode.insertBefore(block, list);
        }
        if (!jobs.length) {
          block.innerHTML = "";
          return;
        }
        const STAT = {
          running: "⏳ 진행 중",
          interrupted: "⚠ 중단됨",
          error: "❌ 실패",
        };
        const rows = jobs
          .map((j) => {
            const label = STAT[j.status] || j.status;
            const typeLabel = BG_TYPE_LABELS[j.reportType] || j.reportType || "보고서";
            const when = formatDateTime(j.createdAt);
            const right =
              j.status === "running"
                ? `<a href="#" data-bgreopen="${bgEsc(j.id)}" style="margin-left:auto;font-size:13px;white-space:nowrap">진행 보기</a>`
                : `<span style="margin-left:auto;font-size:12px;opacity:.7">${bgEsc(j.error || "")}</span>`;
            return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:10px 12px;margin-bottom:8px"><b style="font-size:13px">${bgEsc(label)}</b><span style="font-size:12px;opacity:.75">${bgEsc(typeLabel)} · ${bgEsc(when)}</span>${right}</div>`;
          })
          .join("");
        block.innerHTML = `<div style="font-weight:700;font-size:13px;margin:0 0 8px">🌙 백그라운드 작업</div>${rows}`;
        block.querySelectorAll("[data-bgreopen]").forEach((a) => {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            try {
              const id = a.getAttribute("data-bgreopen");
              currentJobId = id;
              streamJob(id);
              window.scrollTo({ top: 0, behavior: "smooth" });
            } catch (_) {}
          });
        });
      }

      async function loadFiles() {
        const status = document.getElementById("filesStatus");
        const list = document.getElementById("filesList");
        const workspaceFilesSummary = document.getElementById("workspaceFilesSummary");
        const filter = document.getElementById("filesFilter");
        const filterEmpty = document.getElementById("filesFilterEmpty");
        if (!status || !list) return;
        renderPremiumBadge(); // ✨ 프리미엄 배지(활성 시)
        renderBgJobs(); // '내 작업'(진행중/중단) — 완료본은 아래 파일 목록에 나타남
        status.textContent = "불러오는 중...";
        if (workspaceFilesSummary) workspaceFilesSummary.textContent = "최근 파일 확인 중...";
        list.innerHTML = "";
        if (filterEmpty) filterEmpty.hidden = true;
        try {
          const res = await fetch("/api/me/files");
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "파일 목록 오류");
          if (!data.storage) {
            status.textContent = "파일 저장소가 아직 설정되지 않았습니다.";
            if (workspaceFilesSummary) workspaceFilesSummary.textContent = "파일 저장소가 아직 설정되지 않았습니다.";
            return;
          }
          const isCloud = data.cloud === "dropbox";
          const files = data.files || [];
          const maxFiles = data.maxFilesPerUser || 3;
          if (files.length === 0) {
            status.textContent = isCloud
              ? "Dropbox 앱 폴더에 보관된 보고서가 없습니다."
              : `보관 중인 파일이 없습니다. 최대 ${maxFiles}개까지 저장됩니다.`;
            if (workspaceFilesSummary) workspaceFilesSummary.textContent = "최근 생성 파일이 없습니다.";
            return;
          }
          status.textContent = isCloud
            ? `${files.length}개 · ☁ Dropbox(${data.account || "연결됨"})에 영구 저장`
            : `${files.length}/${maxFiles}개 보관 중`;
          if (workspaceFilesSummary) {
            workspaceFilesSummary.textContent = isCloud
              ? `${files.length}개 파일 · Dropbox 저장`
              : `${files.length}/${maxFiles}개 파일 · 24시간 보관`;
          }
          for (const file of files) {
            const item = document.createElement("div");
            item.className = "file-item";
            item.dataset.fileSearch = [
              file.filename,
              file.size_bytes,
              file.created_at,
              file.expires_at,
              isCloud ? "dropbox" : "temporary",
            ].filter(Boolean).join(" ").toLowerCase();

            const meta = document.createElement("div");
            meta.className = "file-meta";

            const name = document.createElement("strong");
            name.textContent = file.filename || "보고서";

            const detail = document.createElement("span");
            detail.textContent = isCloud
              ? `${formatBytes(file.size_bytes)} · ${formatDateTime(file.created_at)} 생성 · ☁ Dropbox`
              : `${formatBytes(file.size_bytes)} · ${formatDateTime(file.created_at)} 생성 · ${formatDateTime(file.expires_at)} 만료`;

            meta.append(name, detail);

            const actions = document.createElement("div");
            actions.className = "file-actions";

            const download = document.createElement("a");
            if (isCloud) {
              download.href = file.download_url || "#";
              download.target = "_blank";
              download.rel = "noopener";
              download.textContent = file.download_url ? "다운로드" : "링크 없음";
            } else {
              download.href = `/api/me/files/${file.id}/download`;
              download.download = file.filename || "";
              download.textContent = "다운로드";
            }
            actions.append(download);

            // 클라우드 파일: Dropbox 웹에서 바로 열기(온디맨드 공유 링크).
            if (isCloud && file.path) {
              const open = document.createElement("button");
              open.type = "button";
              open.className = "secondary compact";
              open.textContent = "Dropbox에서 열기";
              open.addEventListener("click", async () => {
                const prev = open.textContent;
                open.disabled = true;
                open.textContent = "여는 중…";
                try {
                  const r = await fetch(
                    `/api/cloud/dropbox/link?path=${encodeURIComponent(file.path)}`,
                  );
                  const d = await r.json().catch(() => ({}));
                  if (r.ok && d.url) window.open(d.url, "_blank", "noopener");
                  else alert(d.error || "링크를 만들 수 없습니다.");
                } catch (_) {
                  alert("링크 요청에 실패했습니다.");
                }
                open.disabled = false;
                open.textContent = prev;
              });
              actions.append(open);
            }

            // 클라우드 파일은 Dropbox에 영구 보관 — 앱에서 삭제 버튼은 제공하지 않는다.
            if (!isCloud) {
              const del = document.createElement("button");
              del.type = "button";
              del.className = "secondary compact";
              del.textContent = "삭제";
              del.addEventListener("click", async () => {
                const ok = await showConfirmDialog({
                  title: "파일 삭제",
                  rows: [["파일", file.filename || "보고서"]],
                  note: "파일함에서 바로 삭제합니다.",
                  okLabel: "삭제",
                });
                if (!ok) return;
                const r = await fetch(`/api/me/files/${file.id}`, { method: "DELETE" });
                if (!r.ok) {
                  const body = await r.json().catch(() => ({}));
                  alert(body.error || "삭제 실패");
                }
                loadFiles();
              });
              actions.append(del);
            }

            item.append(meta, actions);
            list.appendChild(item);
          }
          if (filter) applyFileFilter();
        } catch (err) {
          status.textContent = err.message || "파일 목록을 불러오지 못했습니다.";
          if (workspaceFilesSummary) workspaceFilesSummary.textContent = "파일함을 불러오지 못했습니다.";
        }
      }

      function applyFileFilter() {
        const input = document.getElementById("filesFilter");
        const list = document.getElementById("filesList");
        const empty = document.getElementById("filesFilterEmpty");
        if (!input || !list) return;
        const q = input.value.trim().toLowerCase();
        let visible = 0;
        list.querySelectorAll(".file-item").forEach((item) => {
          const match = !q || (item.dataset.fileSearch || "").includes(q);
          item.hidden = !match;
          if (match) visible += 1;
        });
        if (empty) empty.hidden = !q || visible > 0;
      }

      document.getElementById("filesFilter")?.addEventListener("input", applyFileFilter);

      document.getElementById("logout").addEventListener("click", async (e) => {
        e.preventDefault();
        await fetch("/api/logout", { method: "POST" });
        location.href = "/"; // 같은 페이지로 — 로그아웃 골격(로그인 드롭다운)으로 전환
      });

      // 상단 탭 전환
      const tabButtons = document.querySelectorAll(".page-tabs [data-tab]");
      const tabPanels = document.querySelectorAll("[data-tab-panel]");
      function showTab(tabName) {
        tabButtons.forEach((btn) => {
          const active = btn.dataset.tab === tabName;
          btn.classList.toggle("active", active);
          btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        tabPanels.forEach((panel) => {
          const active = panel.dataset.tabPanel === tabName;
          panel.classList.toggle("active", active);
          panel.hidden = !active;
        });
        if (tabName === "files") {
          loadFiles();
          loadCloudStatus();
        }
        if (tabName === "settings") loadUsage();
      }
      tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => showTab(btn.dataset.tab));
      });
      document.getElementById("workspaceFilesBtn")?.addEventListener("click", () => showTab("files"));

      // ── 사용 내역 대시보드 ────────────────────────────────────────────────
      function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]);
      }
      function modelShortName(m) {
        if (!m) return "";
        if (m.indexOf("opus") >= 0) return "Opus";
        if (m.indexOf("sonnet") >= 0) return "Sonnet";
        return m;
      }
      async function loadUsage() {
        const credEl = document.getElementById("usageCredits");
        const genEl = document.getElementById("usageGen");
        const recentEl = document.getElementById("usageRecent");
        if (!credEl) return;
        try {
          const d = await fetch("/api/me/usage").then((r) => r.json());
          if (d.isAdmin) credEl.textContent = "관리자 (무제한)";
          else if (d.unlimited) credEl.textContent = "무제한";
          else credEl.textContent = (d.credits ?? 0) + " 크레딧";
          genEl.textContent = `${d.genCount ?? 0} / ${d.genLimit ?? 5} 건`;
          const rDt = document.getElementById("usageRestrictDt");
          const rDd = document.getElementById("usageRestrict");
          if (d.restrictedModel) {
            rDt.style.display = "";
            rDd.style.display = "";
            rDd.textContent = modelShortName(d.restrictedModel) + "만 사용 가능";
          } else {
            rDt.style.display = "none";
            rDd.style.display = "none";
          }
          const list = Array.isArray(d.recent) ? d.recent : [];
          if (!list.length) {
            const p = document.createElement("p");
            p.className = "hint";
            p.textContent = "최근 생성 기록이 없습니다.";
            recentEl.replaceChildren(p);
            return;
          }
          const table = document.createElement("table");
          table.style.width = "100%";
          table.style.borderCollapse = "collapse";
          const tbody = document.createElement("tbody");
          list.forEach((x) => {
            const dt = x.date ? new Date(x.date) : null;
            const when = dt
              ? `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`
              : "-";
            const cr =
              x.credits == null ? "베타·무료" : x.credits === 0 ? "무료" : x.credits + "크레딧";
            const md = x.model ? modelShortName(String(x.model)) : "-";
            const tr = document.createElement("tr");
            [
              { text: when, style: "padding:4px 8px 4px 0;white-space:nowrap;color:var(--text-muted)" },
              { text: x.label || "생성", style: "padding:4px 8px 4px 0" },
              { text: md, style: "padding:4px 8px 4px 0" },
              { text: cr, style: "padding:4px 0;white-space:nowrap" },
            ].forEach((cell) => {
              const td = document.createElement("td");
              td.style.cssText = cell.style;
              td.textContent = String(cell.text);
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          recentEl.replaceChildren(table);
        } catch (e) {
          const p = document.createElement("p");
          p.className = "hint";
          p.textContent = "사용 내역을 불러오지 못했습니다.";
          recentEl.replaceChildren(p);
        }
      }

      // ── 상단 드롭다운 네비 ────────────────────────────────────────────────
      (function initNav() {
        const dds = Array.from(document.querySelectorAll(".nav-dd[data-dd]"));
        const menu = document.getElementById("navMenu");
        const closeAll = () => dds.forEach((d) => d.classList.remove("open"));

        dds.forEach((dd) => {
          const btn = dd.querySelector(".nav-dd-btn");
          btn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const wasOpen = dd.classList.contains("open");
            closeAll();
            if (!wasOpen) dd.classList.add("open");
          });
        });
        // 드롭다운 바깥을 클릭할 때만 닫는다. (로그인 폼 등 .nav-dd 내부 클릭은
        // 닫지 않음 — 아이디·비번 입력하려다 창이 사라지던 문제 수정)
        document.addEventListener("click", (e) => {
          if (!e.target.closest(".nav-dd")) closeAll();
        });

        document.getElementById("navBurger")?.addEventListener("click", (e) => {
          e.stopPropagation();
          menu?.classList.toggle("open");
        });

        // 보고서 작성 드롭다운 → 보고서 종류 선택 + reports 탭으로
        document.querySelectorAll(".nav-dd-menu a[data-report]").forEach((a) => {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            closeAll();
            // 로그아웃 상태면 폼 대신 로그인 드롭다운을 연다.
            if (document.body.dataset.auth === "out") {
              // 클릭 의도 보존: 로그인 후 이 종류를 자동 선택한다.
              setPendingReportType(a.dataset.report);
              if (typeof openLoginDropdown === "function") openLoginDropdown();
              return;
            }
            const radio = document.querySelector(
              `input[name="reportType"][value="${a.dataset.report}"]`,
            );
            showTab("reports");
            if (radio) {
              radio.checked = true;
              updateReportTypeView({ scroll: true });
            }
            menu?.classList.remove("open");
          });
        });

        // 내 계정 드롭다운 → 탭 전환
        document.querySelectorAll(".nav-dd-menu a[data-tab]").forEach((a) => {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            showTab(a.dataset.tab);
            closeAll();
            menu?.classList.remove("open");
          });
        });
      })();

      // 베타 메뉴 노출: 관리자 또는 지정 테스터에게만 'PDF 통번역(베타)' 표시
      fetch("/api/me/beta")
        .then((r) => (r.ok ? r.json() : { features: [] }))
        .then((b) => {
          const feats = Array.isArray(b.features) ? b.features : [];
          if (feats.includes("pdf-translate")) {
            const el = document.getElementById("navBetaTranslate");
            if (el) el.hidden = false;
          }
          if (feats.includes("code-editor")) {
            const el2 = document.getElementById("navBetaEditor");
            if (el2) el2.hidden = false;
          }
          // 파일 챗봇(베타/위임): 관리자·테스터는 여기서, 위임(grant) 사용자는 access 조회로 노출.
          if (b.admin === true || feats.includes("file-chat")) {
            const elFc = document.getElementById("navBetaFilechat");
            if (elFc) elFc.hidden = false;
          } else {
            fetch("/api/filechat/access")
              .then((r) => (r.ok ? r.json() : { allowed: false }))
              .then((a) => {
                if (a && a.allowed) {
                  const elFc = document.getElementById("navBetaFilechat");
                  if (elFc) elFc.hidden = false;
                }
              })
              .catch(() => {});
          }
          if (b.admin === true || feats.includes("problem-set")) {
            const el3 = document.getElementById("navBetaProblemSet");
            if (el3) el3.hidden = false;
          }
          // 양식 메이커(베타): 관리자/테스터면 상단 메뉴 링크 + 보고서 종류 카드를 바로 노출
          // (딥링크 없이도 허브 목록에 보이게).
          if (b.admin === true || feats.includes("form-maker")) {
            const navFm = document.getElementById("navBetaFormMaker");
            if (navFm) navFm.hidden = false;
            const cardFm = document.getElementById("rtFormMaker");
            if (cardFm) cardFm.hidden = false;
          }
          // 스킬 스튜디오 생성기 4종(영어/국어/캡스톤/물리모의)은 스튜디오로 일원화됨 →
          // 메인 허브 카드는 숨김 유지(rtEngExam 등). 진입은 /studio.html 에서.
          // 물리 수행평가(베타): 상단 메뉴 바로가기는 제거됨 — 진입은 '수행평가 도움' 허브로 일원화.
          // 보고서 종류 탭(rtPhysInquiry)은 평소엔 숨기고, 허브에서 '?report=phys-inquiry' 로
          // 들어올 때만 노출·자동 선택한다(아래 딥링크 처리).
          // 수행평가 도움(베타 허브): 관리자 또는 베타 테스터(coding-test·phys-inquiry)에게만 메뉴 노출.
          if (
            b.admin === true ||
            feats.includes("coding-test") ||
            feats.includes("phys-inquiry") ||
            feats.includes("math-inquiry") ||
            feats.includes("reading-log")
          ) {
            const navEp = document.getElementById("navExamPrep");
            if (navEp) navEp.hidden = false;
          }
          // 허브에서 '/?report=phys-inquiry' 로 들어오면 해당 보고서 종류를 노출·자동 선택.
          try {
            const want = new URLSearchParams(location.search).get("report");
            if (
              want === "phys-inquiry" &&
              (b.admin === true || feats.includes("phys-inquiry"))
            ) {
              const tab = document.getElementById("rtPhysInquiry");
              if (tab) tab.hidden = false;
            }
            if (
              want === "math-inquiry" &&
              (b.admin === true || feats.includes("math-inquiry"))
            ) {
              const tab = document.getElementById("rtMathInquiry");
              if (tab) tab.hidden = false;
            }
            if (
              want === "problem-set" &&
              (b.admin === true || feats.includes("problem-set"))
            ) {
              const tab = document.getElementById("rtProblemSet");
              if (tab) tab.hidden = false;
            }
            if (
              want === "form-maker" &&
              (b.admin === true || feats.includes("form-maker"))
            ) {
              const tab = document.getElementById("rtFormMaker");
              if (tab) tab.hidden = false;
            }
            if (
              want === "reading-log" &&
              (b.admin === true || feats.includes("reading-log"))
            ) {
              const tab = document.getElementById("rtReadingLog");
              if (tab) tab.hidden = false;
            }
            const radio = want && document.querySelector(
              'input[name="reportType"][value="' + want + '"]',
            );
            if (radio && !radio.disabled && document.body.dataset.auth !== "out") {
              radio.checked = true;
              if (typeof updateReportTypeView === "function") updateReportTypeView({ scroll: true });
              const fs = document.getElementById("reportTypeFieldset");
              if (fs) fs.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          } catch (e) {}
        })
        .catch(() => {});

      // Default to today
      document.getElementById("date").value = new Date().toISOString().slice(0, 10);

      // 모든 보고서 폼의 날짜 칸(type=date) 중 비어 있는 것을 오늘로 채운다.
      // (free/phys-inquiry/math-inquiry 등 — 위 #date 및 종류 선택 시 보정과 별개로
      //  로드 시점에 한 번 더 안전망. 이미 값이 있으면 그대로 둔다.)
      try {
        const _today = new Date().toISOString().slice(0, 10);
        document.querySelectorAll('input[type="date"]').forEach((el) => {
          if (el && !el.value) el.value = _today;
        });
      } catch (_) { /* 구형 브라우저 등: 무시 */ }

      // chem-pre 폼: 이름은 마지막 입력값을 localStorage에서 복원
      try {
        const cached = JSON.parse(localStorage.getItem("chemPreUserDefaults") || "{}");
        const nameEl = document.getElementById("studentName");
        if (nameEl && cached.studentName) nameEl.value = cached.studentName;
      } catch (_) { /* ignore */ }

      // 보고서 종류 라디오 → 폼 전환
      const reportTypeRadios = document.querySelectorAll('input[name="reportType"]');
      const comingSoon = document.getElementById("comingSoon");
      const reportForms = document.querySelectorAll("[data-report-form]");
      const reportChecklist = document.getElementById("reportChecklist");
      const workspaceChecklistTitle = document.getElementById("workspaceChecklistTitle");

      const reportChecklistItems = {
        "chem-pre": {
          title: "화학 사전보고서",
          items: ["실험 매뉴얼 PDF", "보고서 날짜", "생성 버튼"],
        },
        "chem-result": {
          title: "화학 결과보고서",
          items: ["사전보고서 파일", "실험 데이터 또는 사진", "보고서 날짜", "생성 버튼"],
        },
        "phys-result": {
          title: "물리 결과보고서",
          items: [".cap 또는 엑셀/CSV/텍스트", "사진/그래프 스크린샷 선택", "학번 저장", "보고서 날짜"],
        },
        free: {
          title: "자유 보고서",
          items: ["작성 지시", "필요 자료", "출력 형식 확인", "생성 버튼"],
        },
        "phys-inquiry": {
          title: "물리 수행평가",
          items: ["탐구 주제", "필기노트/참고자료", "학번 저장", "생성 버튼"],
        },
        "math-inquiry": {
          title: "수학 수행평가",
          items: ["탐구 주제", "분석 방향", "학번 저장", "생성 버튼"],
        },
        "problem-set": {
          title: "문제집 메이커",
          items: ["문제 PDF/사진", "페이지당 문제 수", "교차검증 선택", "만들기 버튼"],
        },
        "form-maker": {
          title: "양식 메이커",
          items: ["양식 설명 또는 문서 사진", "출력 형식·글꼴", "만들기 버튼"],
        },
        "reading-log": {
          title: "독서록",
          items: ["도서명", "영역·기록 구분 선택", "감상 메모(선택)", "생성 버튼"],
        },
      };

      function updateReportChecklist(selected) {
        if (!reportChecklist || !workspaceChecklistTitle) return;
        const cfg = reportChecklistItems[selected];
        workspaceChecklistTitle.textContent = cfg ? cfg.title : "보고서 종류를 선택하세요";
        reportChecklist.replaceChildren();
        (cfg ? cfg.items : ["위에서 만들 보고서 종류를 먼저 고르세요."]).forEach((text) => {
          const li = document.createElement("li");
          li.textContent = text;
          reportChecklist.appendChild(li);
        });
      }

      function setFlowStep(formEl, step, options = {}) {
        if (!formEl) return;
        const next = step || "upload";
        formEl.dataset.flowStep = next;
        formEl.querySelectorAll(":scope > .form-flow-steps [data-flow-jump]").forEach((btn) => {
          const active = btn.dataset.flowJump === next;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-pressed", active ? "true" : "false");
        });
        const optional = formEl.querySelector(":scope > .optional-settings");
        if (optional) optional.open = next === "settings";

        if (options.scroll) {
          const target =
            next === "settings"
              ? optional
              : next === "generate"
                ? formEl.querySelector(":scope > .form-actions")
                : formEl.querySelector(`:scope > [data-flow-target="${next}"]`);
          (target || formEl).scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }

      function enhanceReportForms() {
        const optionalTitlePattern = /(AI 참고 메모|내 글 스타일|AI 이미지 생성|출력 설정)/;
        reportForms.forEach((formEl) => {
          if (formEl.dataset.flowInit) return;
          formEl.dataset.flowInit = "1";
          formEl.classList.add("report-flow");

          const flow = document.createElement("div");
          flow.className = "form-flow-steps";
          [
            ["upload", "자료"],
            ["info", "정보"],
            ["settings", "선택 설정"],
            ["generate", "생성"],
          ].forEach(([target, label], index) => {
            const step = document.createElement("button");
            step.type = "button";
            step.dataset.flowJump = target;
            step.textContent = `${index + 1}. ${label}`;
            step.addEventListener("click", () => {
              setFlowStep(formEl, target, { scroll: true });
            });
            flow.appendChild(step);
          });
          formEl.insertBefore(flow, formEl.firstChild);

          const optional = document.createElement("details");
          optional.className = "optional-settings";
          const summary = document.createElement("summary");
          // 기본 라벨 + 현재 선택값 요약 span (구조 유지, 텍스트만 동적 갱신).
          const summaryLabel = document.createElement("span");
          summaryLabel.textContent = "선택 설정";
          const summaryNote = document.createElement("span");
          summaryNote.className = "optional-settings-summary-note";
          summaryNote.style.cssText = "margin-left:8px;font-weight:400;color:var(--text-muted);font-size:0.92em";
          summary.append(summaryLabel, summaryNote);
          const body = document.createElement("div");
          body.className = "optional-settings-body";
          optional.append(summary, body);

          Array.from(formEl.querySelectorAll(":scope > .form-section")).forEach((section) => {
            const title = section.querySelector(".form-section-title")?.textContent || "";
            if (/자료 업로드|무엇을/.test(title)) section.dataset.flowTarget = "upload";
            else if (/보고서 정보/.test(title)) section.dataset.flowTarget = "info";
            if (optionalTitlePattern.test(title)) body.appendChild(section);
          });

          const remainingNotes = Array.from(formEl.querySelectorAll(".user-notes-field")).filter((field) => {
            const directSection = field.closest(".form-section");
            return directSection && directSection.closest(".optional-settings") !== optional;
          });
          if (remainingNotes.length) {
            const noteSection = document.createElement("div");
            noteSection.className = "form-section generated-note-section";
            const head = document.createElement("div");
            head.className = "form-section-head";
            const title = document.createElement("span");
            title.className = "form-section-title";
            title.textContent = "AI 참고 메모";
            head.appendChild(title);
            noteSection.appendChild(head);
            remainingNotes.forEach((field) => noteSection.appendChild(field));
            body.insertBefore(noteSection, body.firstChild);
          }

          if (body.childElementCount) {
            const anchor = formEl.querySelector(":scope > .policy-check") || formEl.querySelector(":scope > .form-actions");
            formEl.insertBefore(optional, anchor || null);
            // '선택 설정' 요약: 접혀 있어도 현재 형식·모델을 한눈에. 변경 시 갱신.
            updateOptionalSummary(formEl);
            optional.addEventListener("change", () => updateOptionalSummary(formEl));
          }
          formEl.addEventListener(
            "invalid",
            (event) => {
              const invalidSection = event.target.closest(".form-section");
              const invalidTarget = invalidSection?.dataset.flowTarget || "generate";
              setFlowStep(formEl, invalidTarget, { scroll: true });
            },
            true,
          );
          formEl.querySelectorAll('button[type="submit"]').forEach((submitBtn) => {
            submitBtn.addEventListener("click", () => setFlowStep(formEl, "generate"));
          });
          setFlowStep(formEl, "upload");
        });
      }

      // 모든 보고서 폼의 '선택 설정' 요약을 한 번에 갱신.
      function updateAllOptionalSummaries() {
        document.querySelectorAll("[data-report-form]").forEach((f) => updateOptionalSummary(f));
      }
      window.updateAllOptionalSummaries = updateAllOptionalSummaries;

      // '선택 설정' details 의 summary 에 현재 형식·모델 요약을 표시한다(구조 유지).
      function updateOptionalSummary(formEl) {
        if (!formEl) return;
        const optional = formEl.querySelector(":scope > .optional-settings");
        const note = optional && optional.querySelector(".optional-settings-summary-note");
        if (!note) return;
        const parts = [];
        // 출력 형식: name 이 format/crFormat/prFormat... 인 라디오 중 선택값.
        const fmt = Array.from(
          optional.querySelectorAll('input[type="radio"]:checked'),
        ).find((r) => /format$/i.test(r.name || ""));
        if (fmt) parts.push(fmt.value === "hwpx" ? ".hwpx" : "." + fmt.value);
        // 모델: name 이 model/crModel/prModel... 인 라디오 중 선택값.
        const mdl = Array.from(
          optional.querySelectorAll('input[type="radio"]:checked'),
        ).find((r) => /model$/i.test(r.name || ""));
        if (mdl) parts.push(getModelLabel(mdl.value));
        note.textContent = parts.length ? "· " + parts.join(" · ") : "";
      }

      enhanceReportForms();
      updateReportChecklist(null);

      function setVisible(el, visible) {
        if (visible) {
          el.removeAttribute("hidden");
        } else {
          el.setAttribute("hidden", "");
        }
      }

      const choosePrompt = document.getElementById("choosePrompt");
      function updateReportTypeView(options = {}) {
        const checked = document.querySelector(
          'input[name="reportType"]:checked',
        );
        const selected = checked ? checked.value : null;
        let matched = false;

        reportForms.forEach((formEl) => {
          const active = formEl.dataset.reportForm === selected;
          formEl.classList.toggle("active", active);
          setVisible(formEl, active);
          matched = matched || active;
        });
        // 아무 종류도 안 고르면 폼 대신 안내만(로그인 직후 홈 상태).
        // 고른 종류에 폼이 없을 때만 '준비 중'.
        if (choosePrompt) setVisible(choosePrompt, !selected);
        setVisible(comingSoon, !!selected && !matched);
        updateReportChecklist(selected);
        if (!selected) return;

        if (options.scroll) {
          const target = matched
            ? document.querySelector(`.report-form[data-report-form="${selected}"]`)
            : comingSoon;
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        reportForms.forEach((formEl) => {
          if (formEl.dataset.reportForm === selected) setFlowStep(formEl, "upload");
        });

        if (selected === "chem-result") {
          const crDate = document.getElementById("crDate");
          if (crDate && !crDate.value) {
            crDate.value = new Date().toISOString().slice(0, 10);
          }
        } else if (selected === "phys-result") {
          const prDate = document.getElementById("prDate");
          if (prDate && !prDate.value) {
            prDate.value = new Date().toISOString().slice(0, 10);
          }
        }
      }
      reportTypeRadios.forEach((r) =>
        r.addEventListener("change", () => {
          // 로그아웃 상태면 선택을 취소하고 로그인 드롭다운을 연다.
          if (document.body.dataset.auth === "out") {
            // 클릭 의도 보존: 로그인 후 이 종류를 자동 선택한다.
            setPendingReportType(r.value);
            r.checked = false;
            if (typeof openLoginDropdown === "function") openLoginDropdown();
            return;
          }
          updateReportTypeView({ scroll: true });
        }),
      );

      // 빈 상태(#choosePrompt) '자주 쓰는 3종 바로가기' — 해당 종류 라디오를 클릭한다.
      // 실제 라디오를 .click() 하므로 로그인 게이트·폼 전환 등 기존 동선을 그대로 탄다.
      document.querySelectorAll("#choosePrompt [data-choose-type]").forEach((b) => {
        b.addEventListener("click", () => {
          const want = b.dataset.chooseType;
          const radio =
            want &&
            document.querySelector('input[name="reportType"][value="' + want + '"]');
          if (radio && !radio.disabled) {
            try { radio.click(); } catch (_) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
          }
        });
      });

      updateReportTypeView();

      const form = document.getElementById("form");
      const btn = document.getElementById("btn");
      const stopBtn = document.getElementById("stopBtn");
      const progressArea = document.getElementById("progressArea");
      const progressEl = document.getElementById("progress");
      const resultArea = document.getElementById("resultArea");
      const statusTitle = document.getElementById("statusTitle");
      const crForm = document.getElementById("chemResultForm");
      const crBtn = document.getElementById("crBtn");
      const prForm = document.getElementById("physResultForm");
      const prBtn = document.getElementById("prBtn");
      const piForm = document.getElementById("physInquiryForm");
      const piBtn = document.getElementById("piBtn");
      const miForm = document.getElementById("mathInquiryForm");
      const miBtn = document.getElementById("miBtn");
      const frForm = document.getElementById("freeForm");
      const frBtn = document.getElementById("frBtn");
      const psForm = document.getElementById("problemSetForm");
      const psBtn = document.getElementById("psBtn");
      const fmForm = document.getElementById("formMakerForm");
      const fmBtn = document.getElementById("fmBtn");
      const rlForm = document.getElementById("readingLogForm");
      const rlBtn = document.getElementById("rlBtn");

      document
        .querySelectorAll('#form input[name="format"]')
        .forEach((el) => el.addEventListener("change", updateChemPreFontOptions));
      updateChemPreFontOptions();
      document
        .querySelectorAll('#chemResultForm input[name="crFormat"]')
        .forEach((el) => el.addEventListener("change", updateChemResultFontOptions));
      updateChemResultFontOptions();
      document
        .querySelectorAll('#physResultForm input[name="prFormat"]')
        .forEach((el) => el.addEventListener("change", updatePhysResultFontOptions));
      updatePhysResultFontOptions();
      document
        .querySelectorAll('#physInquiryForm input[name="piFormat"]')
        .forEach((el) => el.addEventListener("change", updatePhysInquiryFontOptions));
      updatePhysInquiryFontOptions();
      document
        .querySelectorAll('#mathInquiryForm input[name="miFormat"]')
        .forEach((el) => el.addEventListener("change", updateMathInquiryFontOptions));
      updateMathInquiryFontOptions();
      document
        .querySelectorAll('#freeForm input[name="frFormat"]')
        .forEach((el) => el.addEventListener("change", updateFreeFontOptions));
      updateFreeFontOptions();
      document
        .querySelectorAll('#formMakerForm input[name="fmFormat"]')
        .forEach((el) => el.addEventListener("change", updateFormMakerFontOptions));
      updateFormMakerFontOptions();
      updateReadingLogFontOptions(); // 독서록은 .hwpx 고정 → 글꼴 옵션만 보정
      // 독서록 학생부 기록영역: '과목별(직접)'이면 교과명 칸을, '자동'이면 수강 과목 칸을 보여 준다.
      (function () {
        const ra = document.getElementById("rlRecordArea");
        const subjField = document.getElementById("rlSubjectField");
        const enrolledField = document.getElementById("rlEnrolledField");
        if (!ra) return;
        const sync = () => {
          if (subjField) subjField.hidden = ra.value !== "subject";
          if (enrolledField) enrolledField.hidden = ra.value !== "auto";
        };
        ra.addEventListener("change", sync);
        sync();
      })();

      // 업로드 한도(클라이언트 안내용). 서버 기본값(MAX_UPLOAD_MB, 기본 64MB)과 맞춘
      // 보수적 상수 — 환경변수로 바뀔 수 있으니 '대략' 안내로만 쓴다(실검증은 서버).
      const UPLOAD_MAX_FILE_MB = 64;

      // 파일 입력 → 드롭존: 파일명 표시 + 드래그 상태 + 합계 용량 안내.
      // 네이티브 <input type=file>가 영역을 덮고 있어 클릭/드롭을 그대로 처리한다.
      function initDropzones() {
        document.querySelectorAll(".dropzone").forEach((dz) => {
          const input = dz.querySelector('input[type="file"]');
          if (!input || dz.dataset.dzInit) return;
          dz.dataset.dzInit = "1";
          const fileEl = dz.querySelector("[data-dz-file]");

          // 허용 형식(.dropzone-sub) 옆에 '· 파일당 최대 NMB' 안내를 한 번만 덧붙인다.
          try {
            const subEl = dz.querySelector(".dropzone-sub");
            if (subEl && !subEl.dataset.maxNote) {
              subEl.dataset.maxNote = "1";
              const cap = document.createElement("span");
              cap.className = "dropzone-max";
              cap.textContent = ` · 파일당 최대 ${UPLOAD_MAX_FILE_MB}MB`;
              subEl.appendChild(cap);
            }
          } catch (_) { /* 안내 실패는 무시 */ }

          // 합계 용량 초과 시 인라인 경고를 띄울 노드(드롭존 바깥 아래).
          let warnEl = null;
          const ensureWarn = () => {
            if (warnEl) return warnEl;
            warnEl = document.createElement("div");
            warnEl.className = "dropzone-warn";
            warnEl.hidden = true;
            // file input이 드롭존 영역을 덮으므로 경고는 드롭존 '다음'에 삽입한다.
            if (dz.parentNode) dz.parentNode.insertBefore(warnEl, dz.nextSibling);
            return warnEl;
          };
          const renderSize = () => {
            try {
              const files = input.files;
              let total = 0,
                over = false;
              const capBytes = UPLOAD_MAX_FILE_MB * 1024 * 1024;
              if (files && files.length) {
                for (let i = 0; i < files.length; i++) {
                  total += files[i].size || 0;
                  if ((files[i].size || 0) > capBytes) over = true;
                }
              }
              // 단일 파일이 한도를 넘거나, 합계가 한도를 넘으면 안내.
              const tooBig = over || total > capBytes;
              if (tooBig) {
                const w = ensureWarn();
                w.textContent =
                  `선택한 파일이 큽니다(합계 약 ${formatBytes(total)}). 파일당 ${UPLOAD_MAX_FILE_MB}MB를 넘으면 업로드가 거부됩니다 — 사진을 줄이거나 나눠 올리세요.`;
                w.hidden = false;
              } else if (warnEl) {
                warnEl.hidden = true;
              }
            } catch (_) { /* 용량 계산 실패는 무시 */ }
          };

          const render = () => {
            const files = input.files;
            if (files && files.length) {
              dz.classList.add("is-filled");
              if (fileEl)
                fileEl.textContent =
                  files.length === 1
                    ? files[0].name
                    : `${files.length}개 파일 선택됨`;
            } else {
              dz.classList.remove("is-filled");
              if (fileEl) fileEl.textContent = "";
            }
            renderSize();
          };
          input.addEventListener("change", render);
          ["dragenter", "dragover"].forEach((ev) =>
            dz.addEventListener(ev, () => dz.classList.add("is-dragover")),
          );
          ["dragleave", "dragend", "drop"].forEach((ev) =>
            dz.addEventListener(ev, () => dz.classList.remove("is-dragover")),
          );
          render();
        });
      }
      initDropzones();

      // ── 메모/AI참고 섹션 경량화 ────────────────────────────────────────
      // (1) 라벨에 '(선택 · 안 써도 됩니다)' 명시. (2) 가이드·프롬프트복사·메모파일
      //     첨부를 한 개 '도움말' 토글로 묶어 평소엔 접어 둔다(기존 기능·name 유지).
      // 모두 같은 form 안에서 옮기므로 제출 동작은 그대로다. 실패는 무시(방어적).
      function slimMemoSections() {
        document.querySelectorAll(".field.user-notes-field").forEach((field) => {
          try {
            if (field.dataset.memoSlim) return;
            field.dataset.memoSlim = "1";

            // (1) 라벨 문구를 친절하게.
            const labelSpan = field.querySelector(".field-label");
            if (labelSpan && /\(선택\)\s*$/.test(labelSpan.textContent)) {
              labelSpan.textContent = labelSpan.textContent.replace(
                /\(선택\)\s*$/,
                "(선택 · 안 써도 됩니다)",
              );
            }

            // (2) 도움말로 묶을 보조 요소 수집: 가이드 details + 메모파일 input
            //     (+ '.md/.txt 첨부' 안내 small). 단순 블록(가이드·파일 없음)은 건너뛴다.
            const guide = field.querySelector(":scope > .memo-guide");
            const fileInput = field.querySelector(
              ':scope > input[type="file"][name="userNotesFile"]',
            );
            if (!guide && !fileInput) return; // 가벼운 블록은 그대로 둔다.

            const helpers = [];
            if (guide) helpers.push(guide);
            // 파일 첨부 안내 small(.md/.txt 언급)도 함께 접는다.
            field.querySelectorAll(":scope > small").forEach((sm) => {
              if (/\.md|\.txt|첨부/.test(sm.textContent || "")) helpers.push(sm);
            });
            if (fileInput) helpers.push(fileInput);
            if (!helpers.length) return;

            const details = document.createElement("details");
            details.className = "memo-help";
            const summary = document.createElement("summary");
            summary.className = "memo-help-summary";
            // 가이드 유무에 따라 문구를 맞춘다(없으면 첨부만 안내).
            summary.textContent = guide
              ? "도움말 · 작성 가이드 · 메모 파일 첨부"
              : "도움말 · 메모 파일 첨부";
            details.appendChild(summary);

            // 첫 helper 위치에 details를 삽입한 뒤 helper들을 안으로 이동.
            const anchor = helpers[0];
            if (anchor && anchor.parentNode === field) {
              field.insertBefore(details, anchor);
              helpers.forEach((h) => details.appendChild(h));
            }
          } catch (_) { /* 한 블록 실패가 전체를 막지 않게 */ }
        });
      }
      slimMemoSections();

      // 진행 중인 작업 추적용 (중지·재시도 방지)
      let currentJobId = null;
      let currentEs = null;
      let activeFormEl = null; // 어떤 폼이 락 상태인지

      // ── Wave2a: 마지막 제출 보관(원클릭 재시도용) ────────────────────────
      // submitReport 가 받은 그대로(formEl/buttonEl/formData/busyText)를 보관한다.
      // 생성 실패 시 모달 없이 같은 입력으로 재전송한다. FormData 는 같은 객체를
      // 재사용해도 안전하다(브라우저가 File 핸들을 유지). estimate 도 같이 보관해
      // 진행 화면 ETA 에 쓴다.
      let _lastSubmission = null;
      let _retryCount = 0;
      function rememberSubmission(args) {
        try {
          _lastSubmission = {
            formEl: args.formEl || null,
            buttonEl: args.buttonEl || null,
            formData: args.formData || null,
            busyText: args.busyText || "생성 중...",
            estimate: args.estimate || null,
          };
        } catch (_) { _lastSubmission = null; }
      }
      // 마지막 입력으로 재전송. 진행/에러 영역의 '다시 생성' 버튼이 호출한다.
      function retryLastSubmission() {
        if (!_lastSubmission || !_lastSubmission.formData) return;
        if (currentJobId) return; // 이미 진행 중이면 무시
        _retryCount += 1;
        const s = _lastSubmission;
        submitReport({
          formEl: s.formEl,
          buttonEl: s.buttonEl,
          formData: s.formData,
          busyText: s.busyText,
          estimate: s.estimate,
        });
      }

      function lockForm(targetForm) {
        activeFormEl = targetForm;
        targetForm
          .querySelectorAll("input, button[type='submit']")
          .forEach((el) => (el.disabled = true));
        stopBtn.style.display = "inline-block";
        stopBtn.disabled = false;
      }

      function unlockForm() {
        if (activeFormEl) {
          activeFormEl
            .querySelectorAll("input, button[type='submit']")
            .forEach((el) => (el.disabled = false));
        }
        activeFormEl = null;
        stopBtn.style.display = "none";
        currentJobId = null;
        currentEs = null;
      }

      stopBtn.addEventListener("click", async () => {
        if (!currentJobId) return;
        const ok = await showConfirmDialog({
          title: "작업 중지",
          rows: [["상태", "진행 중인 작업을 중단합니다."]],
          note: "이미 사용된 토큰 비용은 발생할 수 있습니다.",
          okLabel: "중지",
        });
        if (!ok) return;
        stopBtn.disabled = true;
        stopBtn.textContent = "중지 중...";
        try {
          await fetch(`/api/jobs/${currentJobId}/abort`, { method: "POST" });
        } catch (_) {}
        // SSE는 서버가 done/error 이벤트로 닫아줌
      });

      // ── 개인 설정: 학번 저장 ────────────────────────────────────────────
      const profileForm = document.getElementById("profileForm");
      const profileBtn = document.getElementById("profileBtn");
      const profileStatus = document.getElementById("profileStatus");

      profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const nextStudentId = normalizeStudentId(
          document.getElementById("settingsStudentIdInput").value,
        );
        profileBtn.disabled = true;
        profileStatus.style.color = "#666";
        profileStatus.textContent = "저장 중...";

        try {
          const res = await fetch("/api/me/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId: nextStudentId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "저장 실패");
          setStudentIdUi(data.studentId || nextStudentId);
          saveLocalStudentId(currentStudentId);
          profileStatus.style.color = "green";
          profileStatus.textContent = "저장 완료";
        } catch (err) {
          setStudentIdUi(nextStudentId);
          saveLocalStudentId(nextStudentId);
          profileStatus.style.color = "#9a6700";
          profileStatus.textContent = "이 브라우저에 저장됨";
        } finally {
          profileBtn.disabled = false;
        }
      });

      // ── 개인 설정: 내 기본 글 스타일 저장 ────────────────────────────────
      (function () {
        var btn = document.getElementById("styleSaveBtn");
        var ta = document.getElementById("settingsStyleNote");
        var status = document.getElementById("styleSaveStatus");
        if (!btn || !ta) return;
        btn.addEventListener("click", async function () {
          var note = (ta.value || "").trim();
          btn.disabled = true;
          status.style.color = "#666";
          status.textContent = "저장 중...";
          saveLocalStyleNote(note);
          ["cpStyleNote", "crStyleNote", "prStyleNote", "piStyleNote"].forEach(function (id) {
            var e = document.getElementById(id);
            if (e) e.value = note;
          });
          try {
            var res = await fetch("/api/me/profile", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ studentId: currentStudentId, styleNote: note }),
            });
            var data = await res.json();
            if (!res.ok) throw new Error(data.error || "저장 실패");
            if (data.styleNotePersisted === false) {
              status.style.color = "#9a6700";
              status.textContent = "이 브라우저에 저장됨(서버 컬럼 미설정)";
            } else {
              status.style.color = "green";
              status.textContent = "저장 완료";
            }
          } catch (err) {
            status.style.color = "#9a6700";
            status.textContent = "이 브라우저에 저장됨";
          } finally {
            btn.disabled = false;
          }
        });
      })();

      // 마지막 성공 생성의 선택값을 폼에 먼저 복원한다.
      // (명시적 기본값 prefModel/prefStyle 이 있으면 바로 아래 applyPrefsToForm 이 덮어쓴다.)
      restoreLastPrefs();

      // ── 개인 설정: 기본 모델 · 양식 선호 (이 브라우저에 저장) ──────────────
      (function () {
        const modelSel = document.getElementById("prefModelSel");
        const styleSel = document.getElementById("prefStyleSel");
        const prefStatus = document.getElementById("prefSaveStatus");
        if (!modelSel || !styleSel) return;
        const PM = "prefModel",
          PS = "prefStyle";
        function getPref(k) {
          try {
            return localStorage.getItem(k) || "";
          } catch (e) {
            return "";
          }
        }
        function setPref(k, v) {
          try {
            if (v) localStorage.setItem(k, v);
            else localStorage.removeItem(k);
          } catch (e) {}
        }
        // 선호값을 보고서 폼 라디오에 반영 (세 폼의 모델 + 화학 사전 양식)
        function applyPrefsToForm() {
          const pm = getPref(PM),
            ps = getPref(PS);
          if (pm) {
            // 모든 보고서 폼의 모델 라디오(Claude/GPT 공통)에 기본 모델을 반영한다.
            // 해당 모델 옵션이 그 폼에 없으면(예: GPT 전용/비활성) 자연히 건너뛴다.
            document
              .querySelectorAll(
                'input[name="model"],input[name="crModel"],input[name="prModel"],input[name="frModel"],input[name="piModel"],input[name="miModel"]',
              )
              .forEach((r) => {
                if (r.value === pm && !r.checked && !r.disabled) {
                  r.checked = true;
                  r.dispatchEvent(new Event("change", { bubbles: true }));
                }
              });
          }
          if (ps) {
            document.querySelectorAll('input[name="style"]').forEach((r) => {
              if (r.value === ps && !r.checked) {
                r.checked = true;
                r.dispatchEvent(new Event("change", { bubbles: true }));
              }
            });
          }
        }
        window.applyPrefsToForm = applyPrefsToForm;
        // 초기화: 저장값으로 셀렉트 채우기
        modelSel.value = getPref(PM);
        styleSel.value = getPref(PS);
        function flash(msg) {
          if (!prefStatus) return;
          prefStatus.style.color = "green";
          prefStatus.textContent = msg;
          setTimeout(() => {
            prefStatus.textContent = "";
          }, 1800);
        }
        modelSel.addEventListener("change", () => {
          setPref(PM, modelSel.value);
          applyPrefsToForm();
          flash("기본 모델 저장됨");
        });
        styleSel.addEventListener("change", () => {
          setPref(PS, styleSel.value);
          applyPrefsToForm();
          flash("기본 양식 저장됨");
        });
        // 페이지 로드 시 폼 라디오에 기본값 반영
        applyPrefsToForm();
      })();

      // ── 비밀번호 변경 ────────────────────────────────────────────────────
      const pwForm = document.getElementById("pwForm");
      const pwBtn = document.getElementById("pwBtn");
      const pwStatus = document.getElementById("pwStatus");

      pwForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const cur = document.getElementById("currentPw").value;
        const newP = document.getElementById("newPw").value;
        const confirmP = document.getElementById("confirmPw").value;

        if (newP !== confirmP) {
          pwStatus.style.color = "red";
          pwStatus.textContent = "새 비밀번호가 일치하지 않습니다.";
          return;
        }
        if (newP === cur) {
          pwStatus.style.color = "red";
          pwStatus.textContent = "새 비밀번호가 현재와 같습니다.";
          return;
        }

        pwBtn.disabled = true;
        pwStatus.style.color = "#666";
        pwStatus.textContent = "변경 중...";

        try {
          const res = await fetch("/api/me/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword: cur, newPassword: newP }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "변경 실패");
          pwStatus.style.color = "green";
          pwStatus.textContent = "변경 완료";
          pwForm.reset();
        } catch (err) {
          pwStatus.style.color = "red";
          pwStatus.textContent = err.message;
        } finally {
          pwBtn.disabled = false;
        }
      });

      // ── 건의사항/버그 제보 ────────────────────────────────────────────────
      const feedbackForm = document.getElementById("feedbackForm");
      const feedbackBtn = document.getElementById("feedbackBtn");
      const feedbackStatus = document.getElementById("feedbackStatus");

      feedbackForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        feedbackBtn.disabled = true;
        feedbackStatus.style.color = "#666";
        feedbackStatus.textContent = "전송 중...";

        const payload = {
          category: document.getElementById("feedbackCategory").value,
          title: document.getElementById("feedbackTitle").value.trim(),
          message: document.getElementById("feedbackMessage").value.trim(),
          contactEmail: document.getElementById("feedbackContactEmail").value.trim(),
          pageUrl: location.href,
        };

        try {
          const res = await fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "전송 실패");
          feedbackStatus.style.color = "green";
          feedbackStatus.textContent = "접수 완료";
          feedbackForm.reset();
        } catch (err) {
          feedbackStatus.style.color = "red";
          feedbackStatus.textContent = err.message || "전송 실패";
        } finally {
          feedbackBtn.disabled = false;
        }
      });

      // 모델별 가격 (per 1M tokens, USD)
      const MODEL_PRICING = {
        "claude-fable-5": { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 },
        "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        // OpenAI GPT (서버 lib/pricing.js 와 동일). cacheWrite = 캐시 미사용이라 input가.
        "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
        "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
        "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
      };

      // chem-pre 비용 추정 (PDF 1개 + 시스템 프롬프트 ~10K 토큰 + 출력 6~10K)
      // 실제 사용자 경험치 (3~5분 → 2~3분 단축, 출력 토큰도 그에 맞춰 축소).
      function estimateCost(pdfBytes, modelId) {
        const sizeKB = pdfBytes / 1024;
        const p = MODEL_PRICING[modelId] || MODEL_PRICING["claude-opus-4-8"];

        const sysCostLo = (10000 / 1e6) * p.cacheRead;
        const sysCostHi = (10000 / 1e6) * p.cacheWrite;
        const pdfTokensLo = sizeKB * 30;
        const pdfTokensHi = sizeKB * 100;
        const pdfCostLo = (pdfTokensLo / 1e6) * p.input;
        const pdfCostHi = (pdfTokensHi / 1e6) * p.input;
        const outputCostLo = (6000 / 1e6) * p.output;
        const outputCostHi = (10000 / 1e6) * p.output;
        // 웹검색은 Claude chem-pre 만 수행(GPT 는 미사용 → 검색비용 0).
        const isGpt = /^gpt/i.test(modelId || "");
        const searchCostLo = isGpt ? 0 : 1 * 0.01;
        const searchCostHi = isGpt ? 0 : 3 * 0.01;

        const lo = sysCostLo + pdfCostLo + outputCostLo + searchCostLo;
        const hi = sysCostHi + pdfCostHi + outputCostHi + searchCostHi;
        return { lo, hi, sizeKB: Math.round(sizeKB) };
      }

      // phys-result 비용 추정
      // - .cap 파일과 엑셀/CSV/텍스트는 서버에서 텍스트로 파싱됨
      // - 이미지 자료 1장 ≈ 1500 토큰
      // - 양식·평가기준 PDF (선택): 추가 입력
      // - 출력 6K~10K (5p 강제 + 실제 사용자 경험상 2~3분 작성)
      function estimatePhysResultCost({
        capBytes,
        photoCount,
        photoBytes,
        formBytes,
        rubricBytes,
        modelId,
      }) {
        const p = MODEL_PRICING[modelId] || MODEL_PRICING["claude-opus-4-8"];
        const sysCostLo = (8000 / 1e6) * p.cacheRead;
        const sysCostHi = (8000 / 1e6) * p.cacheWrite;

        // .cap 파싱 결과 텍스트 — binary 파일이 텍스트로 변환되면 매우 작음.
        // 실측: 20MB cap → ~5K 토큰. KB당 0.3 토큰 정도가 적정.
        const capTextTokens = Math.min((capBytes / 1024) * 0.3, 8000);
        const capCost = (capTextTokens / 1e6) * p.input;

        // 양식·평가기준 PDF
        const extraDocKB = (formBytes + rubricBytes) / 1024;
        const extraDocTokens = extraDocKB * 80;
        const extraDocCost = (extraDocTokens / 1e6) * p.input;

        // 사진
        const photoTokens = (photoCount || 0) * 1500;
        const photoCost = (photoTokens / 1e6) * p.input;

        // 출력 (5p 강제 + 2~3분 작성 기준)
        const outputCostLo = (6000 / 1e6) * p.output;
        const outputCostHi = (10000 / 1e6) * p.output;

        const lo = sysCostLo + capCost + extraDocCost + photoCost + outputCostLo;
        const hi = sysCostHi + capCost + extraDocCost + photoCost + outputCostHi;
        const totalKB = Math.round(
          (capBytes + photoBytes + formBytes + rubricBytes) / 1024,
        );
        return { lo, hi, totalKB };
      }

      // chem-result 비용 추정 (다중 파일 + 사진 N장)
      // - 시스템 프롬프트 ~6K 토큰
      // - 사진 1장 ≈ 1500 입력 토큰 (Claude vision 표준)
      // - 출력 8K~13K (실제 사용자 경험상 2~4분 작성)
      function estimateChemResultCost({
        preReportBytes,
        manualBytes,
        dataBytes,
        photoBytes,
        photoCount,
        modelId,
      }) {
        const p = MODEL_PRICING[modelId] || MODEL_PRICING["claude-opus-4-8"];

        const sysCostLo = (6000 / 1e6) * p.cacheRead;
        const sysCostHi = (6000 / 1e6) * p.cacheWrite;

        // PDF/docx 텍스트 입력: KB당 30~100 토큰 (실측치에 맞춤)
        const docKB = (preReportBytes + manualBytes) / 1024;
        const docTokensLo = docKB * 30;
        const docTokensHi = docKB * 100;
        const docCostLo = (docTokensLo / 1e6) * p.input;
        const docCostHi = (docTokensHi / 1e6) * p.input;

        // 데이터 파일: 엑셀이면 markdown table로 변환. 최대 30KB.
        const dataKB = Math.min(dataBytes / 1024, 30);
        const dataTokens = dataKB * 80;
        const dataCost = (dataTokens / 1e6) * p.input;

        // 사진: 1장당 ~1500 토큰 (Claude vision)
        const photoTokens = (photoCount || 0) * 1500;
        const photoCost = (photoTokens / 1e6) * p.input;

        // 출력: 8K~13K (2~4분 작성 기준)
        const outputCostLo = (8000 / 1e6) * p.output;
        const outputCostHi = (13000 / 1e6) * p.output;

        const lo = sysCostLo + docCostLo + dataCost + photoCost + outputCostLo;
        const hi = sysCostHi + docCostHi + dataCost + photoCost + outputCostHi;
        const totalKB = Math.round(
          (preReportBytes + manualBytes + dataBytes + photoBytes) / 1024,
        );
        return { lo, hi, totalKB };
      }

      function getSelectedModel() {
        // 모델 라디오에서 선택값 (없으면 기본 Opus 4.8).
        const el =
          document.querySelector('input[name="model"]:checked') ||
          document.querySelector('input[name="model"]');
        return el ? el.value : "claude-opus-4-8";
      }

      function getModelLabel(modelId) {
        if (modelId === "claude-fable-5") return "Fable 5";
        if (modelId === "claude-opus-4-8") return "Opus 4.8";
        if (modelId === "claude-opus-4-7") return "Opus 4.7";
        if (modelId === "claude-sonnet-5") return "Sonnet 5";
        if (modelId === "gpt-5.5") return "GPT-5.5";
        if (modelId === "gpt-5.4") return "GPT-5.4";
        if (modelId === "gpt-5.4-mini") return "GPT-5.4 mini";
        return modelId || "Opus 4.8";
      }

      function getFontLabel(fontId) {
        if (fontId === "hamchorom-batang") return "함초롬바탕";
        if (fontId === "nanum-gothic") return "나눔고딕";
        if (fontId === "nanum-myeongjo") return "나눔명조";
        return "맑은 고딕";
      }

      function getChemPreFormat() {
        const formatEl = document.querySelector(
          '#form input[name="format"]:checked, #form input[name="format"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "docx";
      }

      function getChemResultFormat() {
        const formatEl = document.querySelector(
          '#chemResultForm input[name="crFormat"]:checked, #chemResultForm input[name="crFormat"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "docx";
      }

      function getPhysResultFormat() {
        const formatEl = document.querySelector(
          '#physResultForm input[name="prFormat"]:checked, #physResultForm input[name="prFormat"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "docx";
      }

      function updateHwpxOnlyFontOptions(selectId, format) {
        const fontSelect = document.getElementById(selectId);
        if (!fontSelect) return;
        const allowHwpxOnly = format === "hwpx";
        fontSelect
          .querySelectorAll('option[data-hwpx-only="true"]')
          .forEach((option) => {
            option.hidden = !allowHwpxOnly;
            option.disabled = !allowHwpxOnly;
            // docx 모드에서 비활성 항목엔 '(한글 전용)' 꼬리표를 단다(원래 라벨 보존).
            try {
              if (!option.dataset.baseLabel) option.dataset.baseLabel = option.textContent;
              option.textContent = allowHwpxOnly
                ? option.dataset.baseLabel
                : option.dataset.baseLabel + " (한글 전용)";
            } catch (_) { /* 라벨 변경 실패는 무시 */ }
          });
        const selectedOption = fontSelect.options[fontSelect.selectedIndex];
        let autoSwitched = false;
        if (
          !allowHwpxOnly &&
          selectedOption &&
          selectedOption.dataset.hwpxOnly === "true"
        ) {
          fontSelect.value = "malgun-gothic";
          autoSwitched = true;
        }
        // .docx인데 한글 전용 글꼴이 선택돼 있던 경우, 자동 변경 안내를 한 줄 띄운다.
        try {
          let note = fontSelect.parentNode &&
            fontSelect.parentNode.querySelector(":scope > .font-fallback-note");
          if (autoSwitched) {
            if (!note) {
              note = document.createElement("small");
              note.className = "font-fallback-note";
              if (fontSelect.parentNode) fontSelect.parentNode.appendChild(note);
            }
            note.textContent = "선택한 글꼴은 한글(.hwpx) 전용이라 .docx에서는 맑은 고딕으로 표시됩니다.";
            note.hidden = false;
          } else if (note) {
            note.hidden = true;
          }
        } catch (_) { /* 안내 실패는 무시 */ }
      }

      function updateChemPreFontOptions() {
        updateHwpxOnlyFontOptions("fontFace", getChemPreFormat());
      }

      function updateChemResultFontOptions() {
        updateHwpxOnlyFontOptions("crFontFace", getChemResultFormat());
      }

      function updatePhysResultFontOptions() {
        updateHwpxOnlyFontOptions("prFontFace", getPhysResultFormat());
      }

      function getPhysInquiryFormat() {
        const formatEl = document.querySelector(
          '#physInquiryForm input[name="piFormat"]:checked, #physInquiryForm input[name="piFormat"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "hwpx";
      }

      function updatePhysInquiryFontOptions() {
        updateHwpxOnlyFontOptions("piFontFace", getPhysInquiryFormat());
      }

      function getMathInquiryFormat() {
        const formatEl = document.querySelector(
          '#mathInquiryForm input[name="miFormat"]:checked, #mathInquiryForm input[name="miFormat"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "hwpx";
      }

      function updateMathInquiryFontOptions() {
        updateHwpxOnlyFontOptions("miFontFace", getMathInquiryFormat());
      }

      // 독서록은 학교 양식(.hwpx) 전용 — 형식 고정. 글꼴 옵션만 hwpx 기준으로 보정.
      function updateReadingLogFontOptions() {
        updateHwpxOnlyFontOptions("rlFontFace", "hwpx");
      }

      function getFreeFormat() {
        const formatEl = document.querySelector(
          '#freeForm input[name="frFormat"]:checked, #freeForm input[name="frFormat"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "docx";
      }

      function updateFreeFontOptions() {
        updateHwpxOnlyFontOptions("frFontFace", getFreeFormat());
      }

      function getFormMakerFormat() {
        const formatEl = document.querySelector(
          '#formMakerForm input[name="fmFormat"]:checked, #formMakerForm input[name="fmFormat"][type="hidden"]'
        );
        return formatEl ? formatEl.value : "hwpx";
      }

      function updateFormMakerFontOptions() {
        updateHwpxOnlyFontOptions("fmFontFace", getFormMakerFormat());
      }

      // 자유 보고서 비용 추정 — 작성지시/평가기준 텍스트 + 자료(PDF/엑셀/텍스트) + 사진.
      function estimateFreeReportCost({ docBytes, photoBytes, photoCount, textChars, modelId }) {
        const p = MODEL_PRICING[modelId] || MODEL_PRICING["claude-opus-4-8"];
        const sysCostLo = (6000 / 1e6) * p.cacheRead;
        const sysCostHi = (6000 / 1e6) * p.cacheWrite;
        const docKB = (docBytes || 0) / 1024;
        const docTokensLo = docKB * 30;
        const docTokensHi = docKB * 100;
        const docCostLo = (docTokensLo / 1e6) * p.input;
        const docCostHi = (docTokensHi / 1e6) * p.input;
        const promptTokens = ((textChars || 0) / 3); // 지시·기준·메모 텍스트
        const promptCost = (promptTokens / 1e6) * p.input;
        const photoTokens = (photoCount || 0) * 1500;
        const photoCost = (photoTokens / 1e6) * p.input;
        const outputCostLo = (6000 / 1e6) * p.output;
        const outputCostHi = (12000 / 1e6) * p.output;
        const lo = sysCostLo + docCostLo + promptCost + photoCost + outputCostLo;
        const hi = sysCostHi + docCostHi + promptCost + photoCost + outputCostHi;
        const totalKB = Math.round(((docBytes || 0) + (photoBytes || 0)) / 1024);
        return { lo, hi, totalKB };
      }

      function costRangeText(est, krwLo, krwHi) {
        return `$${est.lo.toFixed(2)} ~ $${est.hi.toFixed(2)} (약 ₩${krwLo.toLocaleString()} ~ ₩${krwHi.toLocaleString()})`;
      }

      // 생성 예상 시간(초). 출력 토큰량 × 모델 속도 + 기본 오버헤드 + 타입별 추가(웹검색).
      // 모델별 1k 출력토큰당 초: Opus 가 느리고 Sonnet 이 빠르다. 사진/데이터가 많으면
      // 입력 처리가 늘어 약간 더 걸린다.
      const OUTPUT_TOKENS = {
        "chem-pre": [6000, 10000],
        "chem-result": [8000, 13000],
        "phys-result": [6000, 10000],
        "phys-inquiry": [6000, 11000],
        "math-inquiry": [6000, 11000],
        "free": [6000, 12000],
        "reading-log": [1500, 3500],
      };
      function estimateGenSeconds(type, modelId, extraInputTokens = 0) {
        const isGpt = /^gpt/i.test(modelId || "");
        // 초/1k 출력토큰: Sonnet·GPT mini 빠름, Opus·GPT 플래그십 느림, Fable은 대형이라 가장 느림.
        const perK =
          /^claude-fable/.test(modelId || "")
            ? 45
            : modelId === "claude-sonnet-5"
              ? 9
              : modelId === "gpt-5.4-mini"
                ? 7
                : modelId === "gpt-5.4"
                  ? 12
                  : modelId === "gpt-5.5"
                    ? 14
                    : 16;
        const base = 25; // 입력 처리 + 문서 빌드 + 차트
        // 시약 물성 웹검색은 Claude chem-pre 만 수행(GPT chem-pre 는 웹검색 미사용).
        const webSearch = type === "chem-pre" && !isGpt ? 40 : 0;
        const [oLo, oHi] = OUTPUT_TOKENS[type] || [7000, 11000];
        const inExtra = (extraInputTokens / 1000) * (perK * 0.25); // 사진·데이터 입력분
        return {
          lo: Math.round(base + webSearch + (oLo / 1000) * perK + inExtra),
          hi: Math.round(base + webSearch + (oHi / 1000) * perK + inExtra),
        };
      }
      function formatDuration(sec) {
        const f = (s) =>
          s < 90 ? `${Math.round(s)}초` : `${Math.round(s / 60)}분`;
        return `약 ${f(sec.lo)} ~ ${f(sec.hi)}`;
      }

      // ── Wave2a: 진행 화면 경과 타이머 + ETA ──────────────────────────────
      // beginProgress 가 estimate(=estimateGenSeconds 결과 {lo,hi}) 를 받아 1초마다
      // '예상 약 X분 · 경과 0:23' 을 갱신한다. 단계 무변화/예상 초과 시 안내 문구를
      // 바꾼다. done/error 시 stopGenTimer 로 정지·정리한다(메모리 누수 방지).
      let _genTimer = null;       // setInterval 핸들
      let _genStartTs = 0;        // 시작 시각(ms)
      let _genEstimate = null;    // {lo,hi} 초
      let _genLastChangeTs = 0;   // 마지막 진행 줄 변경 시각(ms)
      function _fmtClock(totalSec) {
        const s = Math.max(0, Math.floor(totalSec));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, "0")}`;
      }
      function _etaPhrase(estimate) {
        if (!estimate) return "";
        const f = (v) => (v < 90 ? `${Math.round(v)}초` : `${Math.round(v / 60)}분`);
        // lo~hi 가 비슷하면 한 값만, 다르면 범위로.
        if (Math.abs((estimate.hi || 0) - (estimate.lo || 0)) < 8) return `예상 ${f(estimate.hi || estimate.lo)}`;
        return `예상 ${f(estimate.lo)}~${f(estimate.hi)}`;
      }
      // 진행 줄이 바뀔 때 호출(appendLine) — '계속 처리 중…' 타이머를 리셋한다.
      function noteGenProgressTick() {
        _genLastChangeTs = Date.now();
      }
      function _renderGenTimer() {
        const el = document.getElementById("genTimer");
        if (!el) return;
        const elapsed = (Date.now() - _genStartTs) / 1000;
        const eta = _etaPhrase(_genEstimate);
        let tail = "";
        const hi = _genEstimate && _genEstimate.hi ? _genEstimate.hi : 0;
        const stalledFor = (Date.now() - (_genLastChangeTs || _genStartTs)) / 1000;
        if (hi && elapsed > hi + 8) {
          tail = " · 거의 다 됐어요";
        } else if (stalledFor > 18) {
          tail = " · 계속 처리 중…";
        }
        el.textContent = `${eta ? eta + " · " : ""}경과 ${_fmtClock(elapsed)}${tail}`;
      }
      function startGenTimer(estimate) {
        stopGenTimer();
        _genStartTs = Date.now();
        _genLastChangeTs = _genStartTs;
        _genEstimate = estimate && (estimate.lo != null || estimate.hi != null) ? estimate : null;
        const el = document.getElementById("genTimer");
        if (el) el.hidden = false;
        _renderGenTimer();
        _genTimer = setInterval(_renderGenTimer, 1000);
      }
      function stopGenTimer(opts) {
        if (_genTimer) { clearInterval(_genTimer); _genTimer = null; }
        const el = document.getElementById("genTimer");
        if (el && (!opts || opts.hide !== false)) el.hidden = true;
      }

      function getUserNotesValue(id) {
        return (document.getElementById(id)?.value || "").trim();
      }

      function getUserNotesFile(id) {
        return document.getElementById(id)?.files?.[0] || null;
      }

      function validateUserNotesFile(file) {
        if (!file) return true;
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        if (!["md", "txt"].includes(ext)) {
          alert("AI 참고 메모 파일은 .md 또는 .txt 형식만 업로드할 수 있습니다.");
          return false;
        }
        if (file.size > 256 * 1024) {
          alert("AI 참고 메모 파일은 최대 256KB까지만 업로드할 수 있습니다.");
          return false;
        }
        return true;
      }

      function userNotesSummary(notes, file = null) {
        const parts = [];
        if (notes) parts.push(`${notes.length}자 직접 입력`);
        if (file) parts.push(`${file.name} (${formatBytes(file.size)})`);
        return parts.length ? parts.join(", ") : "없음";
      }

      // 확인 모달에 넣을 '차감 크레딧 · 잔액 N → N' 행을 만든다.
      // credits 가 숫자이고 잔액을 알며 무제한/관리자가 아닐 때만 보여준다(베타 무료는 생략).
      function buildCreditDeductRow(credits) {
        if (typeof credits !== "number" || !isFinite(credits)) return null;
        if (!_balanceState.known || _balanceState.unlimited || _balanceState.isAdmin) return null;
        const bal = _balanceState.credits;
        const after = bal - credits;
        if (credits <= 0) {
          return { label: "차감 크레딧", value: `무료 · 잔액 ${bal} 유지`, warn: false };
        }
        const insufficient = after < 0;
        return {
          label: "차감 크레딧",
          value: `${credits} 크레딧 · 잔액 ${bal} → ${after}${insufficient ? " (부족)" : ""}`,
          warn: insufficient,
        };
      }

      // ── 백그라운드 실행(구독자 전용) ─────────────────────────────────────────
      // _bgEligible: 토글을 확인 다이얼로그에 노출할지(관리자 또는 활성 구독).
      // _bgChoice/_bgNotifyChoice: 이번 생성에서 선택한 값(submitReport 가 FormData 에 baking).
      let _bgEligible = false;
      let _bgInfo = null; // { active, admin, expiresAt }
      let _bgChoice = false;
      let _bgNotifyChoice = false;
      (async () => {
        try {
          const r = await fetch("/api/subscriptions/me");
          if (r.ok) {
            const d = await r.json();
            _bgInfo = d;
            _bgEligible = !!d.active;
            renderPremiumBadge();
          }
        } catch (_) {
          /* 권한 조회 실패 시 토글 미노출(서버가 어차피 강제) */
        }
      })();

      // 프리미엄(백그라운드 실행 가능) 배지 — '내 파일' 패널 상단에 표시.
      function renderPremiumBadge() {
        try {
          const list = document.getElementById("filesList");
          if (!list || !list.parentNode || !_bgInfo) return;
          let badge = document.getElementById("premiumBadge");
          if (!badge) {
            badge = document.createElement("div");
            badge.id = "premiumBadge";
            list.parentNode.insertBefore(badge, list);
          }
          if (_bgInfo.active) {
            // 활성 프리미엄 — 안내 배지.
            badge.style.cssText =
              "margin:0 0 12px;padding:10px 12px;border:1px solid #c7a008;border-radius:8px;background:linear-gradient(90deg,#fffbeb,#fef9c3);color:#713f12;font-size:13px;font-weight:600";
            let detail = "백그라운드 실행을 사용할 수 있어요.";
            if (_bgInfo.admin) {
              detail = "관리자 — 백그라운드 실행을 사용할 수 있어요.";
            } else if (_bgInfo.expiresAt) {
              try {
                const exp = new Date(_bgInfo.expiresAt);
                if (exp.getFullYear() < new Date().getFullYear() + 50) {
                  detail = `백그라운드 실행 가능 · ${formatDateTime(_bgInfo.expiresAt)}까지`;
                }
              } catch (_) {}
            }
            badge.textContent = `✨ 프리미엄 — ${detail}`;
            return;
          }
          // 비활성 — 프리미엄 신청 CTA.
          badge.style.cssText =
            "margin:0 0 12px;padding:12px 14px;border:1px dashed #c7a008;border-radius:8px;background:#fffdf5;color:#713f12;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap";
          const txt = document.createElement("span");
          txt.style.fontWeight = "600";
          txt.textContent =
            "✨ 프리미엄으로 백그라운드 실행하기 — 제출 후 탭을 닫아도 보고서가 완성돼요.";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "primary compact";
          btn.style.marginLeft = "auto";
          btn.textContent = "프리미엄 신청";
          btn.addEventListener("click", openPremiumRequestModal);
          badge.replaceChildren(txt, btn);
        } catch (_) {}
      }

      function openPremiumRequestModal() {
        const plan = (_bgInfo && _bgInfo.plan) || {};
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        const card = document.createElement("section");
        card.className = "confirm-card";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");

        const h = document.createElement("h2");
        h.textContent = "✨ 프리미엄 신청 (백그라운드 실행)";

        const guide = document.createElement("div");
        guide.style.cssText =
          "font-size:13px;line-height:1.6;margin:8px 0 12px;padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;background:var(--surface-2,#f8fafc)";
        const lines = [];
        if (plan.priceKrw) lines.push(`금액: ${Number(plan.priceKrw).toLocaleString()}원 / ${plan.periodDays || 30}일`);
        if (plan.bank || plan.account)
          lines.push(`입금: ${plan.bank || ""} ${plan.account || ""}${plan.holder ? ` (예금주 ${plan.holder})` : ""}`);
        if (lines.length) {
          guide.textContent = lines.join("\n");
          guide.style.whiteSpace = "pre-line";
        } else {
          guide.textContent =
            "입금 계좌 안내가 아직 설정되지 않았어요. 관리자에게 입금 방법을 문의한 뒤 신청하세요.";
        }

        const note = document.createElement("p");
        note.className = "confirm-note";
        note.style.margin = "0 0 6px";
        note.textContent =
          "입금하신 뒤 아래에 입금자명을 적고 신청하면, 관리자가 확인 후 바로 활성화해 드려요.";

        const label = document.createElement("label");
        label.style.cssText = "display:block;font-size:13px;margin:0 0 12px";
        label.textContent = "입금자명";
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 40;
        input.placeholder = "예: 홍길동";
        input.style.cssText =
          "width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;font:inherit";
        label.appendChild(input);

        const status = document.createElement("p");
        status.className = "confirm-note";
        status.style.cssText = "margin:0 0 8px;min-height:18px;color:var(--accent,#2563eb)";

        const actions = document.createElement("div");
        actions.className = "confirm-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "secondary";
        cancel.textContent = "닫기";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "primary";
        ok.textContent = "입금했어요 · 신청";
        actions.append(cancel, ok);

        const close = () => {
          document.body.classList.remove("modal-open");
          overlay.remove();
        };
        cancel.addEventListener("click", close);
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) close();
        });
        ok.addEventListener("click", async () => {
          ok.disabled = true;
          status.style.color = "var(--accent,#2563eb)";
          status.textContent = "신청 중...";
          try {
            const r = await fetch("/api/subscriptions/request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ depositorName: input.value.trim() }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
              status.style.color = "var(--danger,#d23)";
              status.textContent = d.error || "신청에 실패했어요.";
              ok.disabled = false;
              return;
            }
            status.style.color = "#16a34a";
            status.textContent = d.duplicate
              ? "이미 신청이 접수돼 있어요. 입금 확인 후 활성화됩니다."
              : "신청 완료! 입금 확인 후 곧 활성화됩니다.";
            ok.textContent = "신청됨";
            setTimeout(close, 1800);
          } catch (_) {
            status.style.color = "var(--danger,#d23)";
            status.textContent = "신청 중 오류가 났어요.";
            ok.disabled = false;
          }
        });

        card.append(h, guide, note, label, status, actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        document.body.classList.add("modal-open");
        input.focus();
      }

      function showBackgroundToast() {
        try {
          let t = document.getElementById("bgToast");
          if (!t) {
            t = document.createElement("div");
            t.id = "bgToast";
            t.style.cssText =
              "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#1e293b;color:#fff;padding:12px 18px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:14px;max-width:90vw;text-align:center;line-height:1.5";
            document.body.appendChild(t);
          }
          t.textContent =
            "🌙 백그라운드로 실행 중 — 이 창을 닫아도 됩니다. 완료되면 '내 파일'과 이메일로 받을 수 있어요.";
          t.style.display = "block";
          clearTimeout(window.__bgToastTimer);
          window.__bgToastTimer = setTimeout(() => {
            t.style.display = "none";
          }, 9000);
        } catch (_) {}
      }

      function showConfirmDialog({ title, rows, note, okLabel = "생성", credits, recovery = null, background = false }) {
        // 매 다이얼로그마다 백그라운드 선택 초기화(토글 안 켜면 기본 일반 실행).
        // background:true 인 '생성' 다이얼로그에서만 토글을 노출한다(삭제·중지 등엔 미노출).
        _bgChoice = false;
        _bgNotifyChoice = false;
        return new Promise((resolve) => {
          const overlay = document.createElement("div");
          overlay.className = "confirm-overlay";

          const dialog = document.createElement("section");
          dialog.className = "confirm-card";
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.setAttribute("aria-labelledby", "confirmTitle");

          const heading = document.createElement("h2");
          heading.id = "confirmTitle";
          heading.textContent = title || "보고서 생성";

          const list = document.createElement("dl");
          list.className = "confirm-list";
          // creditDd 를 보관해 모델 변경 시 '차감 크레딧' 행을 즉시 갱신한다.
          let creditDd = null;
          // 크레딧 투명성: '차감 크레딧 · 잔액 N → N' 을 1순위로 강조 표시.
          let creditRow = buildCreditDeductRow(credits);
          if (creditRow) {
            const dt = document.createElement("dt");
            dt.textContent = creditRow.label;
            dt.style.fontWeight = "700";
            const dd = document.createElement("dd");
            dd.textContent = creditRow.value;
            dd.style.fontWeight = "700";
            if (creditRow.warn) dd.style.color = "var(--danger, #d23)";
            list.append(dt, dd);
            creditDd = dd;
          }
          for (const [label, value] of rows) {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = value;
            // 크레딧 행을 1순위로 강조했으므로, 달러/원 추정치는 보조(작게)로 낮춘다.
            if (creditRow && label === "예상 비용") {
              dt.style.opacity = "0.65";
              dd.style.opacity = "0.65";
              dd.style.fontSize = "0.85em";
            }
            list.append(dt, dd);
          }

          const noteEl = document.createElement("p");
          noteEl.className = "confirm-note";
          noteEl.textContent = note || "생성하시겠습니까?";

          // ── 크레딧 사전 점검(부족 시 인라인 경고 + 회복 동선) ─────────────
          // 관리자/무제한/잔액미상이면 graceful 생략. 잔액 < 선택 모델 크레딧이면
          // 빨간 경고 + 생성 버튼 비활성('크레딧 부족') + '더 저렴/무료 모델로 바꾸기'.
          const warnBox = document.createElement("div");
          warnBox.className = "confirm-credit-warn";
          warnBox.hidden = true;
          let _selectedCredits = typeof credits === "number" ? credits : null;

          const actions = document.createElement("div");
          actions.className = "confirm-actions";
          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "secondary";
          cancelBtn.textContent = "취소";
          const okBtn = document.createElement("button");
          okBtn.type = "button";
          okBtn.className = "primary";
          okBtn.textContent = okLabel;
          actions.append(cancelBtn, okBtn);

          // 크레딧 게이트 평가 — 부족하면 OK 비활성 + 경고/회복 노출.
          function evaluateCreditGate() {
            // graceful 생략 조건.
            if (
              _selectedCredits == null ||
              !_balanceState.known ||
              _balanceState.unlimited ||
              _balanceState.isAdmin ||
              _selectedCredits <= 0
            ) {
              warnBox.hidden = true;
              okBtn.disabled = false;
              okBtn.textContent = okLabel;
              return;
            }
            const bal = _balanceState.credits;
            if (_selectedCredits <= bal) {
              warnBox.hidden = true;
              okBtn.disabled = false;
              okBtn.textContent = okLabel;
              return;
            }
            // 부족.
            warnBox.hidden = false;
            warnBox.replaceChildren();
            okBtn.disabled = true;
            okBtn.textContent = "크레딧 부족";

            const msg = document.createElement("div");
            msg.className = "confirm-credit-warn-msg";
            msg.textContent = `잔액이 부족합니다 — 필요 ${_selectedCredits} · 보유 ${bal} 크레딧`;
            warnBox.appendChild(msg);

            const wActions = document.createElement("div");
            wActions.className = "confirm-credit-warn-actions";
            // 회복: 잔액으로 감당 가능한 가장 싼(무료 우선) 모델로 1클릭 전환.
            if (recovery && recovery.formEl && recovery.radioName) {
              const aff = findAffordableModelOption(recovery.formEl, recovery.radioName, bal);
              if (aff) {
                const swapBtn = document.createElement("button");
                swapBtn.type = "button";
                swapBtn.className = "secondary compact";
                const free = aff.credits <= 0;
                swapBtn.textContent = free
                  ? "무료 모델로 바꾸기"
                  : `더 저렴한 모델로 바꾸기 (${aff.credits}크레딧)`;
                swapBtn.addEventListener("click", () => {
                  try { aff.input.checked = true; } catch (_) {}
                  // 라디오 change 리스너(글꼴 옵션 등)도 깨운다.
                  try { aff.input.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
                  _selectedCredits = aff.credits;
                  // '차감 크레딧' 행과 게이트를 즉시 갱신.
                  const newRow = buildCreditDeductRow(aff.credits);
                  if (creditDd && newRow) {
                    creditDd.textContent = newRow.value;
                    creditDd.style.color = newRow.warn ? "var(--danger, #d23)" : "";
                  }
                  evaluateCreditGate();
                });
                wActions.appendChild(swapBtn);
              }
            }
            // 문의/충전 링크(커뮤니티 게시판) — 있으면 연결.
            const link = document.createElement("a");
            link.className = "confirm-credit-warn-link";
            link.href = "/community.html";
            link.textContent = "크레딧 문의 →";
            wActions.appendChild(link);
            warnBox.appendChild(wActions);
          }
          evaluateCreditGate();

          // ── 백그라운드 실행 토글(구독자/관리자 + 생성 다이얼로그에서만 노출) ──────
          const bgBox = document.createElement("div");
          if (_bgEligible && background) {
            bgBox.style.cssText =
              "margin:10px 0 0;padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;background:var(--surface-2,#f8fafc)";
            const row = document.createElement("label");
            row.style.cssText =
              "display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = _bgChoice;
            const t = document.createElement("span");
            t.textContent = "🌙 백그라운드로 실행 (탭/창 닫아도 됨)";
            row.append(cb, t);
            const sub = document.createElement("div");
            sub.style.cssText =
              "margin:6px 0 0 24px;font-size:12px;color:var(--text-muted,#64748b)";
            sub.textContent =
              "제출 후 창을 닫아도 서버가 끝까지 만들고, '내 파일'에서 받을 수 있어요.";
            const mailRow = document.createElement("label");
            mailRow.style.cssText =
              "display:none;align-items:center;gap:6px;margin:8px 0 0 24px;font-size:13px;cursor:pointer";
            const mcb = document.createElement("input");
            mcb.type = "checkbox";
            mcb.checked = true;
            const mt = document.createElement("span");
            mt.textContent = "완료되면 이메일로 알림";
            mailRow.append(mcb, mt);
            cb.addEventListener("change", () => {
              _bgChoice = cb.checked;
              mailRow.style.display = cb.checked ? "flex" : "none";
              _bgNotifyChoice = cb.checked && mcb.checked;
            });
            mcb.addEventListener("change", () => {
              _bgNotifyChoice = cb.checked && mcb.checked;
            });
            bgBox.append(row, sub, mailRow);
          }

          dialog.append(heading, list, noteEl, bgBox, warnBox, actions);
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
          document.body.classList.add("modal-open");

          const close = (result) => {
            document.removeEventListener("keydown", onKeydown);
            document.body.classList.remove("modal-open");
            overlay.remove();
            resolve(result);
          };
          const onKeydown = (event) => {
            if (event.key === "Escape") close(false);
          };
          document.addEventListener("keydown", onKeydown);
          overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(false);
          });
          cancelBtn.addEventListener("click", () => close(false));
          okBtn.addEventListener("click", () => { if (!okBtn.disabled) close(true); });
          // OK 가 비활성(크레딧 부족)이면 취소에 포커스를 둔다.
          (okBtn.disabled ? cancelBtn : okBtn).focus();
        });
      }

      async function submitReport({ formEl, buttonEl, formData, busyText = "생성 중...", estimate = null }) {
        lockForm(formEl);
        if (buttonEl) buttonEl.textContent = busyText;
        // 백그라운드 실행 선택을 FormData 에 1회 baking(재시도 시 동일 모드 유지).
        try {
          if (
            formData &&
            typeof formData.has === "function" &&
            !formData.has("backgroundMode") &&
            _bgChoice
          ) {
            formData.set("backgroundMode", "true");
            if (_bgNotifyChoice) formData.set("notifyEmail", "true");
          }
        } catch (_) {}
        capturePendingGenPrefs(formData); // 성공 시 마지막 선택으로 저장하기 위해 캡처
        // 마지막 제출 보관 — 실패 시 모달 없이 같은 입력으로 재전송한다.
        rememberSubmission({ formEl, buttonEl, formData, busyText, estimate });
        clearRetryCard(); // 재시도/이전 에러 카드 정리
        beginProgress("생성 중...", estimate);
        try {
          const res = await fetch("/api/generate", { method: "POST", body: formData });
          let data = {};
          try { data = await res.json(); } catch (_) { data = {}; }
          if (!res.ok) {
            const e = new Error(data.error || `요청 실패 (HTTP ${res.status})`);
            e.httpStatus = res.status;
            throw e;
          }
          currentJobId = data.jobId;
          streamJob(data.jobId);
          // 백그라운드 모드면 "닫아도 됩니다" 안내 토스트.
          try {
            if (formData && formData.get && formData.get("backgroundMode") === "true") {
              showBackgroundToast();
            }
          } catch (_) {}
        } catch (err) {
          // 제출 단계 실패(입력 오류/크레딧 부족/네트워크). 행동중심 에러 카드로.
          const status = err && err.httpStatus;
          const isInput = status === 400;
          const isCredit = status === 402 || /크레딧|credit|잔액|충전/i.test(err && err.message || "");
          showGenErrorCard({
            message: err && err.message,
            detail: err && err.message,
            phase: "submit",
            httpStatus: status || 0,
            // 입력 오류는 같은 입력으로 재시도해도 또 막히므로 재시도 버튼을 숨긴다.
            allowRetry: !isInput && !isCredit,
            scrollToForm: isInput ? formEl : null,
          });
          stopGenTimer();
          resetForm();
        }
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (currentJobId) return; // 안전장치: 진행 중이면 무시
        const file = document.getElementById("manual").files[0];
        if (!file) return;

        const model = getSelectedModel();
        const modelLabel = getModelLabel(model);
        const formatValue = getChemPreFormat();
        updateChemPreFontOptions();
        const fontFace = document.getElementById("fontFace").value;
        const userNotes = getUserNotesValue("preUserNotes");
        const userNotesFile = getUserNotesFile("preUserNotesFile");
        if (!validateUserNotesFile(userNotesFile)) return;

        // 예상 비용 확인
        const allowImageGen = document.getElementById("cpAllowImageGen")?.checked || false;
        const est = estimateCost(file.size, model);
        if (allowImageGen) est.hi += 0.08; // AI 개념도 최대 2장 × ~$0.04
        const krwLo = Math.round(est.lo * 1400);
        const krwHi = Math.round(est.hi * 1400);
        const genEst = estimateGenSeconds("chem-pre", model);
        const ok = await showConfirmDialog({
          title: "사전보고서 생성",
          background: true,
          credits: getModelCredits(model),
          recovery: { formEl: form, radioName: "model" },
          rows: [
            ["모델", modelLabel],
            ["글꼴", getFontLabel(fontFace)],
            ["참고 메모", userNotesSummary(userNotes, userNotesFile)],
            ["AI 이미지", allowImageGen ? "개념도 최대 2장 (장당 +1크레딧)" : "사용 안 함"],
            ["PDF", `${est.sizeKB}KB`],
            ["예상 비용", costRangeText(est, krwLo, krwHi)],
            ["예상 시간", formatDuration(genEst)],
          ],
          note: `실제 비용은 완료 후 표시됩니다. ${USE_POLICY_NOTE}`,
        });
        if (!ok) return;
        // 모델 변경(회복) 가능성 — 확인 후 현재 선택값을 다시 읽어 FormData·estimate 에 반영.
        const finalModel = getSelectedModel();

        const fd = new FormData();
        fd.append("type", "chem-pre");
        Array.from(document.getElementById("cpStyleRefs").files).forEach((f) => fd.append("styleRefs", f));
        { const sn = (document.getElementById("cpStyleNote").value || "").trim(); if (sn) fd.append("styleNote", sn); }
        fd.append("manual", file);
        const dateStr = document.getElementById("date").value;
        const [y, m, d] = dateStr.split("-");
        fd.append("date", `${y}/ ${m} / ${d}`);
        fd.append("model", finalModel);
        fd.append("format", formatValue);
        fd.append("allowImageGen", allowImageGen ? "true" : "false");
        // 스타일 모드 (default | minimal). docx/hwpx 모두 지원한다.
        const styleEl = document.querySelector('#form input[name="style"]:checked');
        const styleValue = styleEl ? styleEl.value : "default";
        fd.append("style", styleValue);
        fd.append("fontFace", fontFace);
        fd.append("userNotes", userNotes);
        if (userNotesFile) fd.append("userNotesFile", userNotesFile);

        // 표지에 들어갈 사용자 입력. 학번은 개인 설정값을 자동 사용한다.
        const nameEl = document.getElementById("studentName");
        const tempEl = document.getElementById("temperature");
        const presEl = document.getElementById("pressure");
        const studentId = currentStudentId;
        const studentName = nameEl?.value.trim() || "";
        const temperature = tempEl?.value.trim() || "";
        const pressure = presEl?.value.trim() || "";
        fd.append("studentId", studentId);
        fd.append("studentName", studentName);
        fd.append("temperature", temperature);
        fd.append("pressure", pressure);
        appendPolicyAcknowledgements(fd);
        try {
          localStorage.setItem(
            "chemPreUserDefaults",
            JSON.stringify({ studentName }),
          );
        } catch (_) { /* private mode etc. */ }

        await submitReport({ formEl: form, buttonEl: btn, formData: fd, estimate: estimateGenSeconds("chem-pre", finalModel) });
      });

      // ── 화학 결과보고서 submit (Phase 2-2: 백엔드 골격 동작) ──────────────
      crForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (currentJobId) return;

        const preReport = document.getElementById("crPreReport").files[0];
        if (!preReport) return;
        const dataFile = document.getElementById("crData").files[0] || null;
        const photos = Array.from(document.getElementById("crPhotos").files);
        const manual = document.getElementById("crManual").files[0] || null;

        // 모델 라디오에서 선택값 (없으면 기본 Opus 4.8).
        const crModel =
          document.querySelector('input[name="crModel"]:checked')?.value ||
          document.querySelector('input[name="crModel"]')?.value ||
          "claude-opus-4-8";
        const modelLabel = getModelLabel(crModel);
        const crStyle =
          document.querySelector('input[name="crStyle"]:checked')?.value ||
          "default";
        const crStyleLabel = crStyle === "minimal" ? "간단 양식" : "기본 양식";
        const crFormat = getChemResultFormat();
        updateChemResultFontOptions();
        const crFontFace = document.getElementById("crFontFace").value;
        const crUserNotes = getUserNotesValue("crUserNotes");
        const crUserNotesFile = getUserNotesFile("crUserNotesFile");
        if (!validateUserNotesFile(crUserNotesFile)) return;

        const photoBytes = photos.reduce((s, p) => s + p.size, 0);
        const est = estimateChemResultCost({
          preReportBytes: preReport.size,
          manualBytes: manual?.size || 0,
          dataBytes: (dataFile?.size || 0) + (crUserNotesFile?.size || 0),
          photoBytes,
          photoCount: photos.length,
          modelId: crModel,
        });
        const krwLo = Math.round(est.lo * 1400);
        const krwHi = Math.round(est.hi * 1400);
        const crPhotoTokens = photos.length * 1500;
        const ok = await showConfirmDialog({
          title: "화학 결과보고서 생성",
          background: true,
          credits: getModelCredits(crModel),
          recovery: { formEl: crForm, radioName: "crModel" },
          rows: [
            ["모델", modelLabel],
            ["스타일", crStyleLabel],
            ["형식", crFormat === "hwpx" ? ".hwpx (한글)" : ".docx (MS Word)"],
            ["글꼴", getFontLabel(crFontFace)],
            ["참고 메모", userNotesSummary(crUserNotes, crUserNotesFile)],
            ["출력 범위", "사전보고서 뒤에 붙일 결과 추가 작성분"],
            ["첨부", `사전보고서${dataFile ? ", 데이터" : ", 데이터 없음"}${(crUserNotes || crUserNotesFile) && !dataFile ? " (메모 활용)" : ""}, 사진 ${photos.length}장${manual ? ", 매뉴얼" : ""}`],
            ["총 크기", `${est.totalKB}KB`],
            ["예상 비용", costRangeText(est, krwLo, krwHi)],
            ["예상 시간", formatDuration(estimateGenSeconds("chem-result", crModel, crPhotoTokens))],
          ],
          note: `실제 비용은 완료 후 표시됩니다. ${USE_POLICY_NOTE}`,
        });
        if (!ok) return;
        // 회복으로 모델이 바뀌었을 수 있어 현재 선택값을 다시 읽는다.
        const crFinalModel =
          document.querySelector('input[name="crModel"]:checked')?.value || crModel;

        const fd = new FormData();
        fd.append("type", "chem-result");
        Array.from(document.getElementById("crStyleRefs").files).forEach((f) => fd.append("styleRefs", f));
        { const sn = (document.getElementById("crStyleNote").value || "").trim(); if (sn) fd.append("styleNote", sn); }
        fd.append("preReport", preReport);
        if (dataFile) fd.append("data", dataFile);
        photos.forEach((p) => fd.append("photos", p));
        if (manual) fd.append("manual", manual);
        const crDateStr = document.getElementById("crDate").value;
        const [y, m, d] = crDateStr.split("-");
        fd.append("date", `${y}/ ${m} / ${d}`);
        fd.append("temperature", document.getElementById("crTemp").value || "");
        fd.append("pressure", document.getElementById("crPressure").value || "");
        fd.append("studentId", currentStudentId);
        fd.append("model", crFinalModel);
        fd.append("style", crStyle);
        fd.append("format", crFormat);
        fd.append("fontFace", crFontFace);
        fd.append("userNotes", crUserNotes);
        if (crUserNotesFile) fd.append("userNotesFile", crUserNotesFile);
        appendPolicyAcknowledgements(fd);

        await submitReport({ formEl: crForm, buttonEl: crBtn, formData: fd, estimate: estimateGenSeconds("chem-result", crFinalModel, crPhotoTokens) });
      });

      // ── 물리 결과보고서 submit ───────────────────────────────────────────
      prForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (currentJobId) return;

        const cap = document.getElementById("prCap").files[0] || null;
        const dataFiles = Array.from(document.getElementById("prData").files);
        const manual = document.getElementById("prManual").files[0] || null;
        const photos = Array.from(document.getElementById("prPhotos").files);

        // 클라이언트 검증: cap, 엑셀/CSV, 데이터 스크린샷 중 하나는 필수
        if (!cap && dataFiles.length === 0 && photos.length === 0) {
          alert("PASCO Capstone (.cap), 엑셀/CSV/텍스트 데이터, 데이터표·그래프 스크린샷 중 하나는 업로드해야 합니다.");
          return;
        }
        if (!currentStudentId) {
          alert("개인 설정에서 학번을 저장한 뒤 생성하세요.");
          showTab("settings");
          document.getElementById("settingsStudentIdInput").focus();
          return;
        }

        // 모델 라디오에서 선택값 (없으면 기본 Opus 4.8).
        const prModel =
          document.querySelector('input[name="prModel"]:checked')?.value ||
          document.querySelector('input[name="prModel"]')?.value ||
          "claude-opus-4-8";
        const modelLabel = getModelLabel(prModel);
        const prFormat = getPhysResultFormat();
        updatePhysResultFontOptions();
        const prFontFace = document.getElementById("prFontFace").value;
        const prUserNotes = getUserNotesValue("prUserNotes");
        const prUserNotesFile = getUserNotesFile("prUserNotesFile");
        if (!validateUserNotesFile(prUserNotesFile)) return;

        const photoBytes = photos.reduce((s, p) => s + p.size, 0);
        const dataFileBytes = dataFiles.reduce((s, f) => s + f.size, 0);
        const dataInputBytes =
          (cap?.size || 0) + dataFileBytes + (prUserNotesFile?.size || 0);
        const est = estimatePhysResultCost({
          capBytes: dataInputBytes,
          photoCount: photos.length,
          photoBytes,
          formBytes: manual?.size || 0,
          rubricBytes: 0,
          modelId: prModel,
        });
        const krwLo = Math.round(est.lo * 1400);
        const krwHi = Math.round(est.hi * 1400);
        const inputLabel =
          (cap ? `.cap (${Math.round(cap.size / 1024)}KB)` : "") +
          (cap && dataFiles.length ? " + " : "") +
          (dataFiles.length
            ? `엑셀/CSV/텍스트 ${dataFiles.length}개 (${Math.round(dataFileBytes / 1024)}KB)`
            : "") +
          (!cap && dataFiles.length === 0 && photos.length ? "이미지 자료만" : "");
        const prPhotoTokens = photos.length * 1500;
        const ok = await showConfirmDialog({
          title: "물리 결과보고서 생성",
          background: true,
          credits: getModelCredits(prModel),
          recovery: { formEl: prForm, radioName: "prModel" },
          rows: [
            ["모델", modelLabel],
            ["양식", "기본 양식"],
            ["형식", prFormat === "hwpx" ? ".hwpx (한글)" : ".docx (MS Word)"],
            ["글꼴", getFontLabel(prFontFace)],
            ["참고 메모", userNotesSummary(prUserNotes, prUserNotesFile)],
            ["입력", `${inputLabel}${photos.length > 0 ? `, 사진 ${photos.length}장` : ""}${manual ? ", 매뉴얼" : ""}`],
            ["총 크기", `${est.totalKB}KB`],
            ["예상 비용", costRangeText(est, krwLo, krwHi)],
            ["예상 시간", formatDuration(estimateGenSeconds("phys-result", prModel, prPhotoTokens))],
          ],
          note: `기본 평가 기준을 적용합니다. ${USE_POLICY_NOTE}`,
        });
        if (!ok) return;
        // 회복으로 모델이 바뀌었을 수 있어 현재 선택값을 다시 읽는다.
        const prFinalModel =
          document.querySelector('input[name="prModel"]:checked')?.value || prModel;

        const fd = new FormData();
        fd.append("type", "phys-result");
        Array.from(document.getElementById("prStyleRefs").files).forEach((f) => fd.append("styleRefs", f));
        { const sn = (document.getElementById("prStyleNote").value || "").trim(); if (sn) fd.append("styleNote", sn); }
        if (cap) fd.append("cap", cap);
        dataFiles.forEach((f) => fd.append("data", f));
        if (manual) fd.append("manual", manual);
        photos.forEach((p) => fd.append("photos", p));
        const prDateStr = document.getElementById("prDate").value;
        const [y, m, d] = prDateStr.split("-");
        fd.append("date", `${y}/ ${m} / ${d}`);
        fd.append("studentId", currentStudentId);
        fd.append("model", prFinalModel);
        fd.append("format", prFormat);
        fd.append("fontFace", prFontFace);
        fd.append("userNotes", prUserNotes);
        if (prUserNotesFile) fd.append("userNotesFile", prUserNotesFile);
        appendPolicyAcknowledgements(fd);

        await submitReport({ formEl: prForm, buttonEl: prBtn, formData: fd, estimate: estimateGenSeconds("phys-result", prFinalModel, prPhotoTokens) });
      });

      // ── 물리 수행평가(베타) submit ───────────────────────────────────────
      if (piForm) {
        piForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;

          const topic = document.getElementById("piTopic").value.trim();
          const notes = Array.from(document.getElementById("piNotes").files);
          const refs = Array.from(document.getElementById("piRefs").files);
          const refLinks = document.getElementById("piRefLinks").value.trim();
          const styleRefs = Array.from(document.getElementById("piStyleRefs").files);
          const styleNote = document.getElementById("piStyleNote").value.trim();

          if (!topic) {
            alert("탐구 주제를 입력하세요.");
            document.getElementById("piTopic").focus();
            return;
          }
          if (notes.length === 0 && refs.length === 0 && !refLinks) {
            alert("필기노트 PDF, 참고자료 파일, 참고 링크 중 하나는 첨부하세요.");
            return;
          }

          const piModel =
            document.querySelector('input[name="piModel"]:checked')?.value ||
            "claude-opus-4-8";
          const modelLabel = getModelLabel(piModel);
          const piFormat = getPhysInquiryFormat();
          updatePhysInquiryFontOptions();
          const piFontFace = document.getElementById("piFontFace").value;
          const piUserNotes = getUserNotesValue("piUserNotes");
          const piUserNotesFile = getUserNotesFile("piUserNotesFile");
          if (!validateUserNotesFile(piUserNotesFile)) return;

          const inputBits = [];
          if (notes.length) inputBits.push(`필기노트 ${notes.length}개`);
          if (refs.length) inputBits.push(`참고자료 ${refs.length}개`);
          if (refLinks) inputBits.push(`링크 ${refLinks.split(/\s*\n\s*/).filter(Boolean).length}개`);

          const ok = await showConfirmDialog({
            title: "물리 수행평가 초안 생성 (베타)",
            background: true,
            rows: [
              ["모델", modelLabel],
              ["형식", piFormat === "hwpx" ? ".hwpx (한글)" : ".docx (MS Word)"],
              ["글꼴", getFontLabel(piFontFace)],
              ["주제", topic.length > 40 ? topic.slice(0, 40) + "…" : topic],
              ["입력", inputBits.join(", ") || "주제만"],
              ["참고 메모", userNotesSummary(piUserNotes, piUserNotesFile)],
              ["내 문체", styleRefs.length || styleNote ? `반영${styleRefs.length ? ` (샘플 ${styleRefs.length}개)` : ""}` : "기본"],
              ["예상 비용", "무료 (베타)"],
              ["예상 시간", formatDuration(estimateGenSeconds("phys-inquiry", piModel))],
            ],
            note: `탐구·사고 과정 성찰 보고서 양식으로 작성합니다. ${USE_POLICY_NOTE}`,
          });
          if (!ok) return;

          const fd = new FormData();
          fd.append("type", "phys-inquiry");
          fd.append("topic", topic);
          notes.forEach((f) => fd.append("notes", f));
          refs.forEach((f) => fd.append("refs", f));
          fd.append("refLinks", refLinks);
          styleRefs.forEach((f) => fd.append("styleRefs", f));
          if (styleNote) fd.append("styleNote", styleNote);
          const piDateStr = document.getElementById("piDate").value;
          if (piDateStr) {
            const [y, m, d] = piDateStr.split("-");
            fd.append("date", `${y}/ ${m} / ${d}`);
          }
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", piModel);
          fd.append("format", piFormat);
          fd.append("fontFace", piFontFace);
          fd.append("userNotes", piUserNotes);
          if (piUserNotesFile) fd.append("userNotesFile", piUserNotesFile);
          appendPolicyAcknowledgements(fd);

          await submitReport({ formEl: piForm, buttonEl: piBtn, formData: fd, estimate: estimateGenSeconds("phys-inquiry", piModel) });
        });
      }

      // ── 수학 수행평가(베타) submit — 주제(+선택 메모·문체)만 입력 ─────────
      if (miForm) {
        miForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;

          const topic = document.getElementById("miTopic").value.trim();
          const styleRefs = Array.from(document.getElementById("miStyleRefs").files);
          const styleNote = document.getElementById("miStyleNote").value.trim();

          if (!topic) {
            alert("탐구 주제를 입력하세요.");
            document.getElementById("miTopic").focus();
            return;
          }

          const miModel =
            document.querySelector('input[name="miModel"]:checked')?.value ||
            "claude-opus-4-8";
          const modelLabel = getModelLabel(miModel);
          const miFormat = getMathInquiryFormat();
          updateMathInquiryFontOptions();
          const miFontFace = document.getElementById("miFontFace").value;
          const miUserNotes = getUserNotesValue("miUserNotes");
          const miUserNotesFile = getUserNotesFile("miUserNotesFile");
          if (!validateUserNotesFile(miUserNotesFile)) return;

          const ok = await showConfirmDialog({
            title: "수학 수행평가 초안 생성 (베타)",
            background: true,
            rows: [
              ["모델", modelLabel],
              ["형식", miFormat === "hwpx" ? ".hwpx (한글)" : ".docx (MS Word)"],
              ["글꼴", getFontLabel(miFontFace)],
              ["주제", topic.length > 40 ? topic.slice(0, 40) + "…" : topic],
              ["참고 메모", userNotesSummary(miUserNotes, miUserNotesFile)],
              ["내 문체", styleRefs.length || styleNote ? `반영${styleRefs.length ? ` (샘플 ${styleRefs.length}개)` : ""}` : "기본"],
              ["예상 비용", "무료 (베타)"],
              ["예상 시간", formatDuration(estimateGenSeconds("math-inquiry", miModel))],
            ],
            note: `주제만으로 AI가 수학 전개·웹 검색을 통해 수학Ⅲ 급수 탐구보고서 양식(Ⅰ~Ⅴ)으로 작성합니다. ${USE_POLICY_NOTE}`,
          });
          if (!ok) return;

          const fd = new FormData();
          fd.append("type", "math-inquiry");
          fd.append("topic", topic);
          styleRefs.forEach((f) => fd.append("styleRefs", f));
          if (styleNote) fd.append("styleNote", styleNote);
          const miDateStr = document.getElementById("miDate").value;
          if (miDateStr) {
            const [y, m, d] = miDateStr.split("-");
            fd.append("date", `${y}/ ${m} / ${d}`);
          }
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", miModel);
          fd.append("format", miFormat);
          fd.append("fontFace", miFontFace);
          fd.append("userNotes", miUserNotes);
          if (miUserNotesFile) fd.append("userNotesFile", miUserNotesFile);
          appendPolicyAcknowledgements(fd);

          await submitReport({ formEl: miForm, buttonEl: miBtn, formData: fd, estimate: estimateGenSeconds("math-inquiry", miModel) });
        });
      }

      // ── 독서록(베타) submit — 도서 정보 → 독서활동 기록지(.hwpx) ──────────
      if (rlForm) {
        // 생성 방식(한 권씩 / 엑셀 대량) 토글 — 관련 섹션 표시·필수속성·버튼 라벨 전환.
        const rlIsBulk = () =>
          document.querySelector('input[name="rlMode"]:checked')?.value === "bulk";
        // 일부 .form-section/.field 에 [hidden] 을 무시하는 !important display 규칙이
        // 있어, 인라인 display !important 로 강제 토글한다.
        const rlToggle = (el, hide) => {
          if (!el) return;
          el.hidden = hide;
          if (hide) el.style.setProperty("display", "none", "important");
          else el.style.removeProperty("display");
        };
        const rlSetMode = () => {
          const bulk = rlIsBulk();
          rlToggle(document.getElementById("rlBulkSection"), !bulk);
          rlForm
            .querySelectorAll("[data-rl-single]")
            .forEach((el) => rlToggle(el, bulk));
          const titleEl = document.getElementById("rlTitle");
          if (titleEl) titleEl.required = !bulk;
          if (rlBtn) rlBtn.textContent = bulk ? "독서록 대량 생성 (ZIP)" : "독서록 생성";
        };
        rlForm
          .querySelectorAll('input[name="rlMode"]')
          .forEach((r) => r.addEventListener("change", rlSetMode));
        rlSetMode();

        rlForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;

          const bulk = rlIsBulk();
          const recordArea = document.getElementById("rlRecordArea").value;
          const subject = document.getElementById("rlSubject").value.trim();
          const enrolledSubjects =
            document.getElementById("rlEnrolled")?.value.trim() || "";
          const domain = document.getElementById("rlDomain").value;
          const domainLabel =
            document.querySelector('#rlDomain option[value="' + domain + '"]')?.textContent.trim() || "";
          const borrowed = document.getElementById("rlBorrowed").value;
          const rlModel =
            document.querySelector('input[name="rlModel"]:checked')?.value ||
            "gpt-5.4-mini";
          const modelLabel = getModelLabel(rlModel);
          updateReadingLogFontOptions();
          const rlFontFace = document.getElementById("rlFontFace").value;

          if (bulk) {
            // ── 대량(엑셀) — 책마다 독서활동 기록지(.hwpx) → ZIP ──────────────
            const excelEl = document.getElementById("rlExcel");
            const excelFile = excelEl?.files?.[0];
            if (!excelFile) {
              alert("책 목록 엑셀(.xlsx/.csv)을 올리세요. (책이름·출판사·작가 순)");
              excelEl?.focus?.();
              return;
            }
            const periodStart = document.getElementById("rlPeriodStart").value;
            const periodEnd = document.getElementById("rlPeriodEnd").value;

            const ok = await showConfirmDialog({
              title: "독서록 대량 생성 (베타)",
              background: true,
              rows: [
                ["모델", modelLabel],
                ["책 목록", excelFile.name],
                ["영역", domainLabel || "미선택"],
                ["대출 여부", borrowed === "no" ? "× (기본)" : borrowed === "yes" ? "○" : "미선택"],
                ["읽기 기간", `${periodStart || "?"} ~ ${periodEnd || "?"} (책 수만큼 분배)`],
                ["출력", "책마다 .hwpx → ZIP 묶음"],
                ["예상 비용", "무료 (베타)"],
              ],
              note: `엑셀의 책마다 AI가 선택 계기·내용·느낀 점을 써서 학교 '독서활동 기록지'(.hwpx)를 만들어 ZIP으로 묶습니다. 책이 많으면 몇 분 걸릴 수 있어요. ${USE_POLICY_NOTE}`,
            });
            if (!ok) return;

            const fd = new FormData();
            fd.append("type", "reading-log-bulk");
            fd.append("excel", excelFile);
            if (recordArea) fd.append("recordArea", recordArea);
            if (recordArea === "subject" && subject) fd.append("subject", subject);
            if (recordArea === "auto" && enrolledSubjects)
              fd.append("enrolledSubjects", enrolledSubjects);
            if (domain) fd.append("domain", domain);
            fd.append("borrowed", borrowed || "no");
            if (periodStart) fd.append("periodStart", periodStart);
            if (periodEnd) fd.append("periodEnd", periodEnd);
            if (currentStudentId) fd.append("studentId", currentStudentId);
            fd.append("model", rlModel);
            fd.append("format", "hwpx");
            fd.append("fontFace", rlFontFace);
            appendPolicyAcknowledgements(fd);

            await submitReport({ formEl: rlForm, buttonEl: rlBtn, formData: fd, estimate: estimateGenSeconds("reading-log", rlModel) });
            return;
          }

          // ── 단일(한 권) ────────────────────────────────────────────────
          const title = document.getElementById("rlTitle").value.trim();
          if (!title) {
            alert("도서명을 입력하세요.");
            document.getElementById("rlTitle").focus();
            return;
          }
          const author = document.getElementById("rlAuthor").value.trim();
          const publisher = document.getElementById("rlPublisher").value.trim();
          const startDate = document.getElementById("rlStartDate").value;
          const endDate = document.getElementById("rlEndDate").value;
          const userNotes = document.getElementById("rlUserNotes").value.trim();

          const ok = await showConfirmDialog({
            title: "독서록 초안 생성 (베타)",
            background: true,
            rows: [
              ["모델", modelLabel],
              ["형식", ".hwpx (한글 — 학교 양식)"],
              ["글꼴", getFontLabel(rlFontFace)],
              ["도서명", title.length > 40 ? title.slice(0, 40) + "…" : title],
              ["저자", author || "AI 추정"],
              ["영역", domainLabel || "미선택"],
              ["감상 메모", userNotes ? "반영" : "없음"],
              ["예상 비용", "무료 (베타)"],
              ["예상 시간", formatDuration(estimateGenSeconds("reading-log", rlModel))],
            ],
            note: `도서 정보로 AI가 선택 계기·내용 요약·느낀 점을 써서 학교 '독서활동 기록지' 양식(.hwpx)에 채웁니다. ${USE_POLICY_NOTE}`,
          });
          if (!ok) return;

          const fd = new FormData();
          fd.append("type", "reading-log");
          fd.append("title", title);
          if (author) fd.append("author", author);
          if (publisher) fd.append("publisher", publisher);
          if (recordArea) fd.append("recordArea", recordArea);
          if (recordArea === "subject" && subject) fd.append("subject", subject);
          if (recordArea === "auto" && enrolledSubjects)
            fd.append("enrolledSubjects", enrolledSubjects);
          if (domain) fd.append("domain", domain);
          if (borrowed) fd.append("borrowed", borrowed);
          if (startDate) fd.append("startDate", startDate);
          if (endDate) fd.append("endDate", endDate);
          if (userNotes) fd.append("userNotes", userNotes);
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", rlModel);
          fd.append("format", "hwpx");
          fd.append("fontFace", rlFontFace);
          appendPolicyAcknowledgements(fd);

          await submitReport({ formEl: rlForm, buttonEl: rlBtn, formData: fd, estimate: estimateGenSeconds("reading-log", rlModel) });
        });
      }

      // ── 문제집 메이커(베타) submit — 문제 PDF/사진 → 3종 PDF ZIP ─────────
      if (psForm) {
        psForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;

          const source = Array.from(document.getElementById("psSource").files);
          if (source.length === 0) {
            alert("문제 파일(PDF 또는 이미지)을 올리세요.");
            document.getElementById("psSource").focus();
            return;
          }

          const psModel =
            document.querySelector('input[name="psModel"]:checked')?.value ||
            "claude-opus-4-8";
          const modelLabel = getModelLabel(psModel);
          const perPage = document.getElementById("psPerPage").value || "6";
          const crossVerify = document.getElementById("psCrossVerify").checked;
          const allowImageGen =
            document.getElementById("psAllowImageGen").checked;
          const userNotes = document.getElementById("psUserNotes").value.trim();

          const ok = await showConfirmDialog({
            title: "문제집 메이커 (베타)",
            background: true,
            rows: [
              ["모델", modelLabel],
              ["문제 파일", `${source.length}개`],
              ["페이지당 문제 수", `${perPage}문제`],
              ["교차검증", crossVerify ? "ON (3중 풀이)" : "OFF"],
              ["해설 삽화", allowImageGen ? "생성 (gpt-image)" : "사용 안 함"],
              ["출력", "ZIP · 영어 문제지 + 한글 문제지 + 해설지"],
              ["예상 비용", "무료 (베타)"],
              [
                "예상 시간",
                crossVerify
                  ? "문제 수에 따라 2~8분"
                  : "문제 수에 따라 1~5분",
              ],
            ],
            note: `교재 문제를 영어 문제지·한글 문제지·해설지 3종 PDF로 만들어 ZIP 하나로 묶습니다. ${USE_POLICY_NOTE}`,
          });
          if (!ok) return;

          const fd = new FormData();
          fd.append("type", "problem-set");
          source.forEach((f) => fd.append("source", f));
          fd.append("perPage", perPage);
          fd.append("crossVerify", crossVerify ? "true" : "false");
          fd.append("allowImageGen", allowImageGen ? "true" : "false");
          if (userNotes) fd.append("userNotes", userNotes);
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", psModel);
          appendPolicyAcknowledgements(fd);

          await submitReport({ formEl: psForm, buttonEl: psBtn, formData: fd });
        });
      }

      // ── 자유 보고서 submit ───────────────────────────────────────────────
      if (frForm) {
        frForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;

          const instructions = document.getElementById("frInstructions").value.trim();
          if (!instructions) {
            alert("어떤 보고서를 어떻게 쓸지 '작성 지시'를 입력하세요.");
            document.getElementById("frInstructions").focus();
            return;
          }
          const grading = document.getElementById("frGrading").value.trim();
          const title = document.getElementById("frTitle").value.trim();
          const refLinks = document.getElementById("frRefLinks").value.trim();
          const files = Array.from(document.getElementById("frFiles").files);
          const photos = Array.from(document.getElementById("frPhotos").files);
          const styleRefs = Array.from(document.getElementById("frStyleRefs").files);
          const styleNote = document.getElementById("frStyleNote").value.trim();

          const frModel =
            document.querySelector('input[name="frModel"]:checked')?.value ||
            "claude-opus-4-8";
          const modelLabel = getModelLabel(frModel);
          const frFormat = getFreeFormat();
          updateFreeFontOptions();
          const frFontFace = document.getElementById("frFontFace").value;
          const frUserNotes = getUserNotesValue("frUserNotes");
          const frUserNotesFile = getUserNotesFile("frUserNotesFile");
          if (!validateUserNotesFile(frUserNotesFile)) return;

          const photoBytes = photos.reduce((s, p) => s + p.size, 0);
          const docBytes =
            files.reduce((s, f) => s + f.size, 0) + (frUserNotesFile?.size || 0);
          const est = estimateFreeReportCost({
            docBytes,
            photoBytes,
            photoCount: photos.length,
            textChars: instructions.length + grading.length + frUserNotes.length + refLinks.length,
            modelId: frModel,
          });
          const krwLo = Math.round(est.lo * 1400);
          const krwHi = Math.round(est.hi * 1400);
          const frPhotoTokens = photos.length * 1500;
          const ok = await showConfirmDialog({
            title: "자유 보고서 생성",
            background: true,
            credits: getModelCredits(frModel),
            recovery: { formEl: frForm, radioName: "frModel" },
            rows: [
              ["모델", modelLabel],
              ["형식", frFormat === "hwpx" ? ".hwpx (한글)" : ".docx (MS Word)"],
              ["글꼴", getFontLabel(frFontFace)],
              ["참고 메모", userNotesSummary(frUserNotes, frUserNotesFile)],
              ["첨부", `자료 ${files.length}개, 사진 ${photos.length}장`],
              ["내 문체", styleRefs.length || styleNote ? `반영${styleRefs.length ? ` (샘플 ${styleRefs.length}개)` : ""}` : "기본"],
              ["총 크기", `${est.totalKB}KB`],
              ["예상 비용", costRangeText(est, krwLo, krwHi)],
              ["예상 시간", formatDuration(estimateGenSeconds("free", frModel, frPhotoTokens))],
            ],
            note: `작성 지시·평가 기준에 맞춰 자유 형식으로 작성합니다. 실제 비용은 완료 후 표시됩니다. ${USE_POLICY_NOTE}`,
          });
          if (!ok) return;
          // 회복으로 모델이 바뀌었을 수 있어 현재 선택값을 다시 읽는다.
          const frFinalModel =
            document.querySelector('input[name="frModel"]:checked')?.value || frModel;

          const fd = new FormData();
          fd.append("type", "free");
          fd.append("instructions", instructions);
          if (grading) fd.append("gradingCriteria", grading);
          if (title) fd.append("title", title);
          if (refLinks) fd.append("refLinks", refLinks);
          files.forEach((f) => fd.append("files", f));
          photos.forEach((p) => fd.append("photos", p));
          styleRefs.forEach((f) => fd.append("styleRefs", f));
          if (styleNote) fd.append("styleNote", styleNote);
          const frDateStr = document.getElementById("frDate").value;
          if (frDateStr) {
            const [y, m, d] = frDateStr.split("-");
            fd.append("date", `${y}/ ${m} / ${d}`);
          }
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", frFinalModel);
          fd.append("format", frFormat);
          fd.append("fontFace", frFontFace);
          fd.append("userNotes", frUserNotes);
          if (frUserNotesFile) fd.append("userNotesFile", frUserNotesFile);
          appendPolicyAcknowledgements(fd);

          await submitReport({ formEl: frForm, buttonEl: frBtn, formData: fd, estimate: estimateGenSeconds("free", frFinalModel, frPhotoTokens) });
        });
      }

      // 업로드 전 사진 다운스케일 — 폰 사진(6~8MB)을 그대로 올리면 합계가 커서 업로드가
      // 느리거나 실패(타임아웃/메모리)한다. 브라우저 canvas 로 긴 변 maxEdge 로 줄여 JPEG 로
      // 재인코딩하면 합계가 1/5 수준으로 줄어 업로드가 빠르고 안정적이며 생성도 빨라진다.
      // 복원 그림 크롭에 충분한 해상도(기본 2400px)는 유지한다. 실패하면 원본을 그대로 쓴다.
      async function downscaleImageForUpload(
        file,
        { maxEdge = 2400, quality = 0.82, maxBytes = 1.8 * 1024 * 1024 } = {},
      ) {
        try {
          if (!file || !/^image\//.test(file.type || "")) return file;
          if (file.size <= 900 * 1024) return file; // 이미 작으면 그대로
          let bmp;
          try {
            bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
          } catch {
            bmp = await createImageBitmap(file);
          }
          const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
          const w = Math.max(1, Math.round(bmp.width * scale));
          const h = Math.max(1, Math.round(bmp.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
          if (bmp.close) bmp.close();
          let q = quality;
          let blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
          while (blob && blob.size > maxBytes && q > 0.5) {
            q -= 0.12;
            blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
          }
          if (!blob || blob.size >= file.size) return file; // 효과 없으면 원본
          const base = (file.name || "photo").replace(/\.[^.]+$/, "");
          return new File([blob], base + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
        } catch {
          return file;
        }
      }

      // ── 양식 메이커 (베타) ───────────────────────────────────────────────
      if (fmForm) {
        fmForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;

          const promptText = document.getElementById("fmInstructions").value.trim();
          const photos = Array.from(document.getElementById("fmPhotos").files);
          if (!promptText && photos.length === 0) {
            alert("① 양식 설명을 입력하거나, ② 복원할 문서 사진을 한 장 이상 올리세요.");
            document.getElementById("fmInstructions").focus();
            return;
          }
          const title = document.getElementById("fmTitle").value.trim();
          const fmUserNotes = getUserNotesValue("fmUserNotes");
          const fmModel =
            document.querySelector('input[name="fmModel"]:checked')?.value ||
            "claude-opus-4-8";
          const fmFormat = getFormMakerFormat();
          updateFormMakerFontOptions();
          const fmFontFace = document.getElementById("fmFontFace").value;
          const fmRedraw = !!document.getElementById("fmFigureRedraw")?.checked;
          const fmLayout = document.querySelector('input[name="fmLayout"]:checked')?.value || "auto";
          const layoutLabel = fmLayout === "layout" ? "원문 2단 그대로" : fmLayout === "clean" ? "정리해서 깔끔하게" : "자동 (정리본)";
          const modeLabel =
            photos.length > 0
              ? promptText
                ? `문서 복원 + 지시 (사진 ${photos.length}장)`
                : `문서 복원 (사진 ${photos.length}장)`
              : "양식 생성";

          const ok = await showConfirmDialog({
            title: "양식 메이커",
            background: true,
            rows: [
              ["작업", modeLabel],
              ["모델", getModelLabel(fmModel)],
              ["형식", fmFormat === "hwpx" ? ".hwpx (한글)" : ".docx (MS Word)"],
              ["글꼴", getFontLabel(fmFontFace)],
              ...(photos.length > 0
                ? [
                    ["레이아웃", layoutLabel],
                    ["그림", fmRedraw ? "AI로 재생성 (원본과 다를 수 있음)" : "원본 그대로 잘라 넣기"],
                  ]
                : []),
              ["예상 비용", "무료 (베타)"],
              ["예상 시간", formatDuration(estimateGenSeconds("free", fmModel, photos.length * 1500))],
            ],
            note: `베타 기능이라 크레딧이 차감되지 않습니다. 복원은 구조·내용을 재구성하는 것이며 픽셀 단위 복제가 아닙니다. ${USE_POLICY_NOTE}`,
          });
          if (!ok) return;

          const fd = new FormData();
          fd.append("type", "form-maker");
          if (promptText) fd.append("promptText", promptText);
          // 업로드 전 사진 다운스케일(업로드 안정성·속도). 실패 시 원본 사용.
          const sizedPhotos = photos.length
            ? await Promise.all(photos.map((p) => downscaleImageForUpload(p)))
            : [];
          sizedPhotos.forEach((p) => fd.append("photos", p));
          if (document.getElementById("fmFigureRedraw")?.checked) {
            fd.append("figureRedraw", "true");
          }
          fd.append(
            "layoutMode",
            document.querySelector('input[name="fmLayout"]:checked')?.value || "auto",
          );
          if (title) fd.append("title", title);
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", fmModel);
          fd.append("format", fmFormat);
          fd.append("fontFace", fmFontFace);
          fd.append("userNotes", fmUserNotes);
          appendPolicyAcknowledgements(fd);

          await submitReport({ formEl: fmForm, buttonEl: fmBtn, formData: fd, estimate: estimateGenSeconds("free", fmModel, photos.length * 1500) });
        });
      }

      // ── 스킬 스튜디오 신규 베타 4종 (모두 ZIP 출력, 무료 베타) ───────────────
      function pickModel(name) {
        return (
          document.querySelector('input[name="' + name + '"]:checked')?.value ||
          "claude-opus-4-8"
        );
      }

      // 영어 시험대비 3종
      const engExamForm = document.getElementById("engExamForm");
      if (engExamForm) {
        engExamForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;
          const files = Array.from(document.getElementById("engSource").files);
          if (!files.length) {
            alert("영어 지문 파일을 한 개 이상 올리세요.");
            return;
          }
          const fd = new FormData();
          fd.append("type", "eng-exam-prep");
          files.forEach((f) => fd.append("source", f));
          fd.append("userNotes", document.getElementById("engUserNotes").value.trim());
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", pickModel("engModel"));
          appendPolicyAcknowledgements(fd);
          await submitReport({
            formEl: engExamForm,
            buttonEl: document.getElementById("engExamBtn"),
            formData: fd,
          });
        });
      }

      // 국어(문학) 내신·모의고사
      const koreanLitForm = document.getElementById("koreanLitForm");
      if (koreanLitForm) {
        koreanLitForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;
          const src = Array.from(document.getElementById("klSource").files);
          if (!src.length) {
            alert("학습지(판서 포함) 파일을 한 개 이상 올리세요.");
            return;
          }
          const bank = Array.from(document.getElementById("klBank").files);
          const fd = new FormData();
          fd.append("type", "korean-lit-exam");
          src.forEach((f) => fd.append("source", f));
          bank.forEach((f) => fd.append("bank", f));
          fd.append("userNotes", document.getElementById("klUserNotes").value.trim());
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", pickModel("klModel"));
          appendPolicyAcknowledgements(fd);
          await submitReport({
            formEl: koreanLitForm,
            buttonEl: document.getElementById("koreanLitBtn"),
            formData: fd,
          });
        });
      }

      // Capstone .cap 번역본
      const capTranslateForm = document.getElementById("capTranslateForm");
      if (capTranslateForm) {
        capTranslateForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;
          const cap = document.getElementById("capFile").files[0];
          if (!cap) {
            alert(".cap 파일을 올리세요.");
            return;
          }
          const fd = new FormData();
          fd.append("type", "cap-translate");
          fd.append("cap", cap);
          fd.append("targetLang", document.getElementById("capTargetLang").value || "ko");
          fd.append("model", pickModel("capModel"));
          appendPolicyAcknowledgements(fd);
          await submitReport({
            formEl: capTranslateForm,
            buttonEl: document.getElementById("capTranslateBtn"),
            formData: fd,
          });
        });
      }

      // 물리 모의고사
      const physMockForm = document.getElementById("physMockForm");
      if (physMockForm) {
        physMockForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (currentJobId) return;
          const exam = document.getElementById("pmExam").files[0];
          const textbook = document.getElementById("pmTextbook").files[0];
          if (!exam || !textbook) {
            alert("기출 시험지와 교과서 단원 PDF를 모두 올리세요.");
            return;
          }
          const rubric = document.getElementById("pmRubric").files[0];
          const fd = new FormData();
          fd.append("type", "phys-mock-exam");
          fd.append("exam", exam);
          fd.append("textbook", textbook);
          if (rubric) fd.append("rubric", rubric);
          fd.append("userNotes", document.getElementById("pmUserNotes").value.trim());
          if (currentStudentId) fd.append("studentId", currentStudentId);
          fd.append("model", pickModel("pmModel"));
          appendPolicyAcknowledgements(fd);
          await submitReport({
            formEl: physMockForm,
            buttonEl: document.getElementById("physMockBtn"),
            formData: fd,
          });
        });
      }

      const progressStepOrder = ["upload", "analysis", "document", "ready"];

      function resetProgressSteps() {
        document.querySelectorAll("[data-progress-step]").forEach((el) => {
          el.classList.remove("is-active", "is-done", "is-error");
        });
      }

      function setProgressStep(step, state = "active") {
        const idx = progressStepOrder.indexOf(step);
        if (idx < 0) return;
        document.querySelectorAll("[data-progress-step]").forEach((el) => {
          const currentIdx = progressStepOrder.indexOf(el.dataset.progressStep);
          el.classList.toggle("is-done", state !== "error" && currentIdx >= 0 && currentIdx < idx);
          el.classList.toggle("is-active", state !== "error" && currentIdx === idx);
          el.classList.toggle("is-error", state === "error" && currentIdx === idx);
        });
      }

      function inferProgressStep(text) {
        const s = String(text || "");
        if (/오류|실패|중단|취소/.test(s)) return { step: "document", state: "error" };
        if (/완료|다운로드|저장|파일 준비/.test(s)) return { step: "ready", state: "active" };
        if (/문서|DOCX|HWPX|차트|그래프|렌더|생성/.test(s)) return { step: "document", state: "active" };
        if (/AI|분석|모델|응답|작성|파싱|보정/.test(s)) return { step: "analysis", state: "active" };
        if (/업로드|파일|입력|확인|검증/.test(s)) return { step: "upload", state: "active" };
        return null;
      }

      function beginProgress(title, estimate) {
        progressArea.style.display = "block";
        progressEl.replaceChildren();
        resultArea.replaceChildren();
        clearRetryCard(); // 이전 에러 카드 정리
        statusTitle.textContent = title || "생성 중...";
        // 진행 영역 최근 1줄 상시 표시 초기화 (상세 로그를 펴지 않아도 보이게).
        const latest = document.getElementById("progressLatest");
        if (latest) latest.textContent = "생성을 시작합니다…";
        resetProgressSteps();
        setProgressStep("upload");
        // 경과 타이머 + ETA 시작 (estimate = estimateGenSeconds 결과 {lo,hi} 초).
        try { startGenTimer(estimate); } catch (_) { /* 타이머 실패는 무시 */ }
        // 생성 시작 즉시 진행 영역으로 스크롤해 사용자가 진행 상황을 바로 본다.
        try {
          progressArea.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (_) { /* 구형 브라우저: 무시 */ }
      }

      function appendLine(text) {
        const line = typeof text === "string" ? text : JSON.stringify(text);
        progressEl.appendChild(document.createTextNode(line + "\n"));
        progressEl.scrollTop = progressEl.scrollHeight;
        // 상세 로그를 펴지 않아도 최근 1줄은 진행 영역에 상시 표시한다.
        const latest = document.getElementById("progressLatest");
        if (latest && line.trim()) latest.textContent = line.trim();
        // 진행 줄이 바뀌면 '계속 처리 중…' 무변화 타이머를 리셋한다.
        if (line.trim()) { try { noteGenProgressTick(); } catch (_) {} }
        const next = inferProgressStep(line);
        if (next) setProgressStep(next.step, next.state);
      }

      function resetForm() {
        unlockForm();
        try { stopGenTimer(); } catch (_) {} // 종료/에러/리셋 시 타이머 정지(누수 방지)
        btn.textContent = "사전보고서 생성";
        if (crBtn) crBtn.textContent = "결과보고서 생성";
        if (prBtn) prBtn.textContent = "물리 결과보고서 생성";
        if (piBtn) piBtn.textContent = "물리 수행평가 초안 생성";
        if (miBtn) miBtn.textContent = "수학 수행평가 초안 생성";
        if (psBtn) psBtn.textContent = "문제지·해설지 만들기";
        if (frBtn) frBtn.textContent = "자유 보고서 생성";
        if (fmBtn) fmBtn.textContent = "양식 만들기";
        stopBtn.textContent = "중지";
        const genSpinner = document.getElementById("genSpinner");
        if (genSpinner) genSpinner.style.display = "none";
      }

      // ── Wave2a: 생성 오류 카드(행동중심 + 원클릭 다시 생성) ───────────────
      // 에러를 한 줄 행동중심 메시지 + 접힌 상세로 압축하고, 가능하면 '다시 생성'
      // 버튼을 단다. 입력 오류(400)는 해당 폼으로 스크롤한다.
      function clearRetryCard() {
        const card = document.getElementById("retryCard");
        if (card) { card.hidden = true; card.replaceChildren(); }
      }
      function showGenErrorCard(opts) {
        const o = opts || {};
        const card = document.getElementById("retryCard");
        if (!card) {
          // 폴백: 카드 컨테이너가 없으면 기존 방식(로그 한 줄)으로.
          appendLine("오류: " + (o.message || "생성이 중단되었습니다."));
          return;
        }
        card.replaceChildren();
        card.hidden = false;

        // 한 줄 요약: 입력/크레딧 오류는 원인을, 그 외(스트림 끊김·5xx·타임아웃)는
        // '중단됐어요 · 크레딧 미차감 · 입력 보존' 행동중심으로 압축.
        const isInput = o.httpStatus === 400;
        const isCredit = o.httpStatus === 402 || /크레딧|credit|잔액|충전/i.test(o.message || "");
        let headline;
        if (isInput) headline = "⚠ 입력을 확인해 주세요 · 아래 폼에서 빠진 항목을 채운 뒤 다시 시도하세요";
        else if (isCredit) headline = "⚠ 크레딧이 부족합니다 · 더 저렴한/무료 모델로 바꾸거나 충전 후 다시 시도하세요";
        else headline = "⚠ 생성이 중단됐어요 · 크레딧은 차감되지 않았습니다 · 입력은 그대로예요";

        const head = document.createElement("div");
        head.className = "retry-headline";
        head.textContent = headline;
        card.appendChild(head);

        // 행동 버튼들
        const actions = document.createElement("div");
        actions.className = "retry-actions";
        const allowRetry = o.allowRetry !== false && _lastSubmission && _lastSubmission.formData;
        if (allowRetry) {
          const retryBtn = document.createElement("button");
          retryBtn.type = "button";
          retryBtn.className = "primary";
          retryBtn.textContent = "다시 생성";
          retryBtn.addEventListener("click", () => {
            clearRetryCard();
            retryLastSubmission();
          });
          actions.appendChild(retryBtn);
        }
        if (isCredit || isInput) {
          // 크레딧/입력 오류는 폼으로 돌아가 고치게 안내.
          const back = document.createElement("button");
          back.type = "button";
          back.className = "secondary";
          back.textContent = isCredit ? "모델 바꾸기" : "폼으로 이동";
          back.addEventListener("click", () => {
            const target = o.scrollToForm || (_lastSubmission && _lastSubmission.formEl) || null;
            if (target) { try { target.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {} }
            else { try { document.getElementById("reportTypeFieldset")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {} }
          });
          actions.appendChild(back);
        }
        if (isCredit) {
          const link = document.createElement("a");
          link.className = "retry-link";
          link.href = "/community.html";
          link.textContent = "크레딧 문의 →";
          actions.appendChild(link);
        }
        if (actions.childNodes.length) card.appendChild(actions);

        // 상세 원인은 접기.
        const detailText = (o.detail || o.message || "").toString().trim();
        if (detailText) {
          const det = document.createElement("details");
          det.className = "retry-detail";
          const sm = document.createElement("summary");
          sm.textContent = "자세한 원인 보기";
          const pre = document.createElement("div");
          pre.className = "retry-detail-body";
          pre.textContent = detailText;
          det.append(sm, pre);
          card.appendChild(det);
        }

        // 입력 오류면 해당 폼 섹션으로 스크롤.
        if (isInput && o.scrollToForm) {
          try { o.scrollToForm.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
        } else {
          try { card.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
        }
      }

      function streamJob(jobId) {
        const es = new EventSource(`/api/jobs/${jobId}/stream`);
        currentEs = es;
        const genSpinner = document.getElementById("genSpinner");
        if (genSpinner) genSpinner.style.display = "inline-block";

        es.addEventListener("progress", (e) => {
          appendLine(JSON.parse(e.data));
        });

        es.addEventListener("done", (e) => {
          const data = JSON.parse(e.data);
          appendLine("완료");
          statusTitle.textContent = "완료";
          setProgressStep("ready");
          stopGenTimer(); // 경과 타이머 정지·정리
          clearRetryCard(); // 성공했으므로 이전 에러 카드 제거
          _retryCount = 0;
          if (genSpinner) genSpinner.style.display = "none";

          const link = document.createElement("a");
          link.href = `/api/jobs/${jobId}/download`;
          link.textContent = `${data.filename} 다운로드`;
          link.download = data.filename;
          resultArea.appendChild(link);

          // 보관 안내 + (사전→결과) 이어서 만들기 CTA.
          try {
            // 마지막 제출 시 캡처한 종류(없으면 빈 문자열).
            const genType =
              (typeof _pendingGenPrefs === "object" && _pendingGenPrefs && _pendingGenPrefs.type) || "";
            const meta = document.createElement("div");
            meta.className = "result-meta";

            const keep = document.createElement("small");
            keep.className = "result-keep";
            keep.textContent = "내 파일함에 24시간 보관됩니다 — 위 버튼으로 다시 받을 수 있어요.";
            meta.appendChild(keep);

            // 화학 사전보고서 → 화학 결과보고서로 자연스럽게 이어가는 동선.
            if (genType === "chem-pre") {
              const next = document.createElement("button");
              next.type = "button";
              next.className = "result-next-cta";
              next.textContent = "이 사전보고서로 결과보고서 이어서 만들기 →";
              next.addEventListener("click", () => {
                const radio = document.querySelector(
                  'input[name="reportType"][value="chem-result"]',
                );
                if (radio && !radio.disabled) {
                  try { radio.click(); } catch (_) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
                  try {
                    document.getElementById("reportTypeFieldset")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  } catch (_) {}
                }
              });
              meta.appendChild(next);
            }
            resultArea.appendChild(meta);
          } catch (_) { /* CTA 실패는 무시 — 다운로드는 정상 */ }

          // 데이터·메모 이상 점검 결과(참고 사항) — 결과 아래에 표시
          if (Array.isArray(data.warnings) && data.warnings.length) {
            const box = document.createElement("div");
            box.style.cssText =
              "margin-top:12px;padding:12px 14px;border:1px solid #f0c36d;background:#fff8e6;border-radius:10px;color:#7a5b00;font-size:14px;line-height:1.6";
            const head = document.createElement("div");
            head.style.cssText = "font-weight:700;margin-bottom:6px";
            head.textContent = "⚠️ 참고 사항 — 업로드한 데이터/메모에서 확인이 필요한 점";
            box.appendChild(head);
            const ul = document.createElement("ul");
            ul.style.cssText = "margin:0;padding-left:18px";
            data.warnings.forEach((w) => {
              const li = document.createElement("li");
              li.textContent = w;
              ul.appendChild(li);
            });
            box.appendChild(ul);
            const note = document.createElement("div");
            note.style.cssText = "margin-top:8px;font-size:12px;color:#9a7b1a";
            note.textContent =
              "보고서는 정상 생성되었습니다. 위 사항이 의도한 것이면 무시해도 되고, 데이터·메모를 고쳐 다시 생성하면 더 정확해집니다.";
            box.appendChild(note);
            resultArea.appendChild(box);
          }

          // 업로드한 .hwpx 글꼴 상세 분석 결과 — 결과 아래에 표시
          const sf = data.styleFont;
          if (sf && (sf.bodyFace || (sf.profile && sf.profile.length))) {
            const fb = document.createElement("div");
            fb.style.cssText =
              "margin-top:12px;padding:12px 14px;border:1px solid #cdd6f4;background:#f5f7ff;border-radius:10px;color:#2a3556;font-size:13.5px;line-height:1.7";
            const h = document.createElement("div");
            h.style.cssText = "font-weight:700;margin-bottom:4px";
            h.textContent = "🖊 감지된 글꼴 구성 (업로드한 한글파일 기준)";
            fb.appendChild(h);
            const sum = document.createElement("div");
            const bodyLabel = document.createElement("b");
            bodyLabel.textContent = "본문";
            sum.append(
              bodyLabel,
              document.createTextNode(` ${sf.bodyFace || "-"}${sf.bodySizePt ? " " + sf.bodySizePt + "pt" : ""}`),
            );
            if (sf.headingFace) {
              const headLabel = document.createElement("b");
              headLabel.textContent = "제목/소제목";
              sum.append(
                document.createTextNode("  ·  "),
                headLabel,
                document.createTextNode(
                  ` ${sf.headingFace}${sf.headingSizePt ? " " + sf.headingSizePt + "pt" : ""}${sf.headingBold ? " 굵게" : ""}`,
                ),
              );
            }
            fb.appendChild(sum);
            if (sf.profile && sf.profile.length) {
              const det = document.createElement("details");
              det.style.cssText = "margin-top:6px";
              const sm = document.createElement("summary");
              sm.style.cssText = "cursor:pointer;color:#465089;font-size:12.5px";
              sm.textContent = `텍스트별 글꼴 상세 (${sf.profile.length}종)`;
              det.appendChild(sm);
              const ul2 = document.createElement("ul");
              ul2.style.cssText = "margin:6px 0 0;padding-left:18px;font-size:12.5px;color:#4a5578";
              sf.profile.forEach((c) => {
                const li = document.createElement("li");
                li.textContent = `${c.face} ${c.sizePt}pt${c.bold ? " 굵게" : ""} — ${c.share}%`;
                ul2.appendChild(li);
              });
              det.appendChild(ul2);
              fb.appendChild(det);
            }
            const fn = document.createElement("div");
            fn.style.cssText = "margin-top:7px;font-size:12px;color:#6b76a8";
            fn.textContent =
              "보고서는 본문 글꼴로 출력했습니다(그 글꼴이 PC에 설치돼 있어야 그대로 보입니다). 글자 크기·제목 글꼴까지 맞추려면 알려주세요.";
            fb.appendChild(fn);
            resultArea.appendChild(fb);
          }

          // AI로 이어서 편집 — 인수인계 프롬프트(복사용)
          if (typeof data.handoff === "string" && data.handoff.trim()) {
            const hb = document.createElement("div");
            hb.style.cssText =
              "margin-top:12px;padding:12px 14px;border:1px solid #cde3d2;background:#f3fbf5;border-radius:10px;color:#214a31;font-size:13.5px;line-height:1.6";
            const hh = document.createElement("div");
            hh.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
            const hhTitle = document.createElement("b");
            hhTitle.textContent = "🤝 AI로 이어서 편집하기";
            hh.appendChild(hhTitle);
            const copyBtn = document.createElement("button");
            copyBtn.textContent = "프롬프트 복사";
            copyBtn.style.cssText =
              "margin-left:auto;font-size:12.5px;padding:5px 12px;border:1px solid #2f9e57;background:#2f9e57;color:#fff;border-radius:8px;cursor:pointer";
            hh.appendChild(copyBtn);
            hb.appendChild(hh);
            const desc = document.createElement("div");
            desc.style.cssText = "font-size:12.5px;color:#4a6b54;margin-bottom:7px";
            desc.textContent =
              "아래 안내문을 복사해 ChatGPT·Claude 등에 붙여넣고, 그 아래에 다운로드한 보고서 내용을 붙이면 이어서 다듬을 수 있어요(주의사항·다듬을 포인트 포함).";
            hb.appendChild(desc);
            const ta = document.createElement("textarea");
            ta.readOnly = true;
            ta.value = data.handoff;
            ta.style.cssText =
              "width:100%;min-height:160px;font-size:12.5px;line-height:1.55;padding:10px;border:1px solid #cde3d2;border-radius:8px;background:#fff;color:#214a31;resize:vertical;white-space:pre-wrap";
            hb.appendChild(ta);
            copyBtn.onclick = () => {
              ta.select();
              navigator.clipboard?.writeText(data.handoff).then(
                () => { copyBtn.textContent = "복사됨 ✓"; setTimeout(() => (copyBtn.textContent = "프롬프트 복사"), 1500); },
                () => { try { document.execCommand("copy"); copyBtn.textContent = "복사됨 ✓"; } catch {} },
              );
            };
            resultArea.appendChild(hb);
          }

          es.close();
          resetForm();
          // 마지막 성공 생성의 선택값(종류·모델·형식·글꼴)을 기억한다.
          if (typeof commitLastGenPrefs === "function") commitLastGenPrefs();
          // 작업 후 잔액 자동 새로고침
          if (typeof loadBalance === "function") loadBalance();
          if (typeof loadFiles === "function") loadFiles();
        });

        es.addEventListener("error", (e) => {
          let msg;
          try { msg = e.data ? JSON.parse(e.data) : null; } catch (_) { msg = e.data || null; }
          const detail = msg ||
            "서버 연결이 끊겼습니다. 보통 (1) 서버 재배포로 컨테이너가 재시작되었거나 (2) 무료 플랜 일시 sleep 진입 시 발생합니다. 이 경우 크레딧(쿠폰)은 차감되지 않습니다. 1~2분 기다린 뒤 보고서 생성을 다시 시도하세요. (이전 작업은 복구 불가 — 새로 만들어집니다)";
          appendLine("오류: " + detail);
          statusTitle.textContent = "오류";
          setProgressStep("document", "error");
          stopGenTimer(); // 경과 타이머 정지·정리
          if (genSpinner) genSpinner.style.display = "none";
          es.close();
          resetForm();
          // 스트림 끊김/5xx/타임아웃 — 같은 입력으로 원클릭 재시도 제공.
          showGenErrorCard({
            message: String(detail),
            detail: String(detail),
            phase: "stream",
            httpStatus: 0,
            allowRetry: true,
          });
        });
      }

      // ════════════════════════════════════════════════════════════════════
      // Wave2b — 입력 보존(draft 자동 저장·이탈 경고) + 필수 체크리스트 실시간
      //          + 모바일 단계 버튼·진행 고정. 전부 추가(additive)·방어적(try/catch).
      // ════════════════════════════════════════════════════════════════════
      (function () {
        "use strict";

        // ── 1) 긴 textarea 자동 저장(draft) + 이탈 경고 ─────────────────────
        // 폼별로 보존 가치가 있는 텍스트 입력(긴 메모·지시·주제·문체)을 디바운스해
        // localStorage 에 저장한다. 재방문 시 저장본이 있으면 인라인 배너로 안내하고,
        // 채워진 폼에서 새로고침/이탈 시 beforeunload 경고를 띄운다. 생성 성공 시 삭제.
        const DRAFT_PREFIX = "quiloDraft:v1:";
        // data-report-form → 보존할 입력 id 목록.
        const DRAFT_FIELDS = {
          "chem-pre": ["preUserNotes", "cpStyleNote"],
          "chem-result": ["crUserNotes", "crStyleNote"],
          "phys-result": ["prUserNotes", "prStyleNote"],
          free: ["frInstructions", "frGrading", "frTitle", "frRefLinks", "frUserNotes", "frStyleNote"],
          "phys-inquiry": ["piTopic", "piRefLinks", "piUserNotes", "piStyleNote"],
          "math-inquiry": ["miTopic", "miUserNotes", "miStyleNote"],
          "problem-set": ["psUserNotes"],
          "form-maker": ["fmInstructions", "fmUserNotes"],
          "eng-exam-prep": ["engUserNotes"],
          "korean-lit-exam": ["klUserNotes"],
          "phys-mock-exam": ["pmUserNotes"],
        };

        function draftKey(type) {
          return DRAFT_PREFIX + type;
        }
        function readDraft(type) {
          try {
            const raw = localStorage.getItem(draftKey(type));
            if (!raw) return null;
            const obj = JSON.parse(raw);
            return obj && typeof obj === "object" ? obj : null;
          } catch (_) {
            return null;
          }
        }
        function writeDraft(type, data) {
          try {
            const keys = Object.keys(data || {});
            if (!keys.length) {
              localStorage.removeItem(draftKey(type));
              return;
            }
            localStorage.setItem(
              draftKey(type),
              JSON.stringify({ at: Date.now(), fields: data }),
            );
          } catch (_) { /* private mode 등 무시 */ }
        }
        function clearDraft(type) {
          try { localStorage.removeItem(draftKey(type)); } catch (_) {}
        }
        // 현재 폼에서 비어있지 않은 draft 필드만 모은다.
        function collectDraftValues(type) {
          const ids = DRAFT_FIELDS[type];
          if (!ids) return {};
          const out = {};
          ids.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const v = (el.value || "").trim();
            if (v) out[id] = el.value; // 원본(트림 전) 보존, 존재 판정만 trim
          });
          return out;
        }
        function hasAnyDraftInput(type) {
          return Object.keys(collectDraftValues(type)).length > 0;
        }

        let _draftDirty = false;       // 한 번이라도 사용자가 채웠는가(이탈 경고용)
        let _suppressUnload = false;   // 생성 직후엔 경고를 끈다

        const _debounceTimers = {};
        function scheduleDraftSave(type) {
          if (!type || !DRAFT_FIELDS[type]) return;
          clearTimeout(_debounceTimers[type]);
          _debounceTimers[type] = setTimeout(() => {
            try {
              const vals = collectDraftValues(type);
              writeDraft(type, vals);
              _draftDirty = Object.keys(vals).length > 0;
            } catch (_) {}
          }, 600);
        }

        function currentReportType() {
          const r = document.querySelector('input[name="reportType"]:checked');
          return r ? r.value : null;
        }

        // 폼별 draft 입력에 디바운스 자동저장 리스너를 단다(중복 방지).
        function bindDraftAutosave() {
          Object.keys(DRAFT_FIELDS).forEach((type) => {
            DRAFT_FIELDS[type].forEach((id) => {
              const el = document.getElementById(id);
              if (!el || el.dataset.draftBound) return;
              el.dataset.draftBound = "1";
              el.addEventListener("input", () => scheduleDraftSave(type));
            });
          });
        }

        // 폼 상단에 '이전에 작성하던 내용이 있어요 · [불러오기] [지우기]' 인라인 배너.
        function ensureDraftBanner(type) {
          const formEl = document.querySelector('[data-report-form="' + type + '"]');
          if (!formEl) return;
          const saved = readDraft(type);
          // 이미 폼에 내용이 있으면(복원했거나 직접 입력 중) 배너 불필요.
          if (!saved || !saved.fields || !Object.keys(saved.fields).length || hasAnyDraftInput(type)) {
            const existing = formEl.querySelector(":scope > .draft-banner");
            if (existing) existing.remove();
            return;
          }
          let banner = formEl.querySelector(":scope > .draft-banner");
          if (banner) return; // 이미 떠 있음
          banner = document.createElement("div");
          banner.className = "notice draft-banner";
          banner.style.cssText =
            "margin:0 0 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap";
          const txt = document.createElement("span");
          const whenAgo = saved.at ? draftAgoText(saved.at) : "";
          txt.innerHTML =
            "📝 이전에 작성하던 내용이 있어요" + (whenAgo ? ` <span style="color:var(--text-faint)">(${whenAgo})</span>` : "");
          const loadBtn = document.createElement("button");
          loadBtn.type = "button";
          loadBtn.className = "link-button";
          loadBtn.textContent = "불러오기";
          loadBtn.style.cssText =
            "font-size:13px;color:var(--accent-text);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0";
          loadBtn.addEventListener("click", () => {
            restoreDraft(type);
            banner.remove();
          });
          const dropBtn = document.createElement("button");
          dropBtn.type = "button";
          dropBtn.className = "link-button";
          dropBtn.textContent = "지우기";
          dropBtn.style.cssText =
            "font-size:13px;color:var(--text-muted);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0";
          dropBtn.addEventListener("click", () => {
            clearDraft(type);
            banner.remove();
          });
          banner.append(txt, loadBtn, dropBtn);
          // flow-steps 다음(폼 최상단)에 삽입 — studentid-banner 와 같은 위치 정책.
          const flow = formEl.querySelector(":scope > .form-flow-steps");
          const sidBanner = formEl.querySelector(":scope > .studentid-banner");
          const anchor = sidBanner || flow;
          if (anchor && anchor.nextSibling) formEl.insertBefore(banner, anchor.nextSibling);
          else if (anchor) formEl.appendChild(banner);
          else formEl.insertBefore(banner, formEl.firstChild);
        }

        function draftAgoText(ts) {
          try {
            const diff = Date.now() - ts;
            const min = Math.round(diff / 60000);
            if (min < 1) return "방금 전";
            if (min < 60) return min + "분 전";
            const hr = Math.round(min / 60);
            if (hr < 24) return hr + "시간 전";
            return Math.round(hr / 24) + "일 전";
          } catch (_) { return ""; }
        }

        function restoreDraft(type) {
          const saved = readDraft(type);
          if (!saved || !saved.fields) return;
          try {
            Object.keys(saved.fields).forEach((id) => {
              const el = document.getElementById(id);
              if (el && !el.value) {
                el.value = saved.fields[id];
                // change/input 리스너(요약·체크리스트)도 깨운다.
                try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
              }
            });
            _draftDirty = true;
          } catch (_) {}
        }

        // 생성 성공 시 현재 종류의 draft 삭제 + 이탈 경고 해제.
        function clearActiveDraftOnSuccess() {
          try {
            const type = (_pendingGenPrefs && _pendingGenPrefs.type) || currentReportType();
            if (type) clearDraft(type);
            _draftDirty = false;
            _suppressUnload = true;
            setTimeout(() => { _suppressUnload = false; }, 1500);
          } catch (_) {}
        }

        // 채워진 폼에서 새로고침/이탈 시 경고(빈 폼/생성 직후엔 안 함).
        window.addEventListener("beforeunload", (e) => {
          try {
            if (_suppressUnload) return;
            if (currentJobId) return; // 생성 진행 중은 SSE 가 관리 — 별도 경고 안 함
            const type = currentReportType();
            if (!type) return;
            if (!hasAnyDraftInput(type)) return;
            e.preventDefault();
            e.returnValue = "";
            return "";
          } catch (_) {}
        });

        // ── 2) 필수 입력 체크리스트 실시간 연동 ─────────────────────────────
        // 정적 항목(reportChecklistItems)은 유지하되, 각 항목을 실제 폼 상태에
        // 바인딩해 충족 시 ✓·미충족 강조하고, 클릭하면 해당 섹션으로 스크롤한다.
        // 항목 텍스트/구조는 그대로 두고 상태 표시(클래스/아이콘)만 추가한다.

        // 항목 라벨 → {done(), jump} 판정기. 보고서 종류별로 둔다.
        // done: 충족 여부, jump: 클릭 시 이동할 폼 섹션 키(setFlowStep 의 step 또는 element id).
        function fileCount(id) {
          const el = document.getElementById(id);
          return el && el.files ? el.files.length : 0;
        }
        function textFilled(id) {
          const el = document.getElementById(id);
          return !!(el && (el.value || "").trim());
        }
        function radioChosen(name) {
          return !!document.querySelector('input[name="' + name + '"]:checked');
        }
        const STUDENT_ID_REPORTS = ["phys-result", "phys-inquiry", "math-inquiry"];

        // 보고서 종류별 항목 판정. 키는 reportChecklistItems[type].items 의 문자열과 동일.
        // done()==true 면 충족, ''/false 면 미충족, null 이면 상태표시 없음(안내용).
        function checklistStatus(type, itemText) {
          const t = String(itemText || "");
          try {
            switch (type) {
              case "chem-pre":
                if (/실험 매뉴얼/.test(t)) return { done: fileCount("manual") > 0, jump: "upload" };
                if (/보고서 날짜/.test(t)) return { done: textFilled("date"), jump: "info" };
                if (/생성 버튼/.test(t)) return { done: null };
                break;
              case "chem-result":
                if (/사전보고서/.test(t)) return { done: fileCount("crPreReport") > 0, jump: "upload" };
                if (/데이터 또는 사진/.test(t))
                  return { done: fileCount("crData") > 0 || fileCount("crPhotos") > 0 || textFilled("crUserNotes"), jump: "upload" };
                if (/보고서 날짜/.test(t)) return { done: textFilled("crDate"), jump: "info" };
                if (/생성 버튼/.test(t)) return { done: null };
                break;
              case "phys-result":
                // OR 필수: .cap·데이터·사진 중 하나라도 있으면 충족.
                if (/\.cap|엑셀|CSV|텍스트/.test(t))
                  return { done: fileCount("prCap") > 0 || fileCount("prData") > 0 || fileCount("prPhotos") > 0, jump: "upload" };
                if (/사진|그래프|스크린샷/.test(t)) return { done: fileCount("prPhotos") > 0, jump: "upload", optional: true };
                if (/학번/.test(t)) return { done: !!currentStudentId, jump: "studentId" };
                if (/보고서 날짜/.test(t)) return { done: textFilled("prDate"), jump: "info" };
                break;
              case "free":
                if (/작성 지시/.test(t)) return { done: textFilled("frInstructions"), jump: "upload" };
                if (/필요 자료/.test(t))
                  return { done: fileCount("frFiles") > 0 || fileCount("frPhotos") > 0 || textFilled("frRefLinks"), jump: "upload", optional: true };
                if (/출력 형식/.test(t)) return { done: null };
                if (/생성 버튼/.test(t)) return { done: null };
                break;
              case "phys-inquiry":
                if (/탐구 주제/.test(t)) return { done: textFilled("piTopic"), jump: "upload" };
                if (/필기노트|참고자료/.test(t))
                  return { done: fileCount("piNotes") > 0 || fileCount("piRefs") > 0 || textFilled("piRefLinks"), jump: "upload" };
                if (/학번/.test(t)) return { done: !!currentStudentId, jump: "studentId" };
                if (/생성 버튼/.test(t)) return { done: null };
                break;
              case "math-inquiry":
                if (/탐구 주제/.test(t)) return { done: textFilled("miTopic"), jump: "upload" };
                if (/분석 방향/.test(t)) return { done: textFilled("miUserNotes"), jump: "upload", optional: true };
                if (/학번/.test(t)) return { done: !!currentStudentId, jump: "studentId" };
                if (/생성 버튼/.test(t)) return { done: null };
                break;
              case "problem-set":
                if (/문제 PDF|사진/.test(t)) return { done: fileCount("psSource") > 0, jump: "upload" };
                if (/페이지당/.test(t)) return { done: null };
                if (/교차검증/.test(t)) return { done: null };
                if (/만들기 버튼/.test(t)) return { done: null };
                break;
              case "form-maker":
                if (/양식 설명|문서 사진/.test(t))
                  return { done: textFilled("fmInstructions") || fileCount("fmPhotos") > 0, jump: "upload" };
                if (/출력 형식|글꼴/.test(t)) return { done: null };
                if (/만들기 버튼/.test(t)) return { done: null };
                break;
              default:
                return { done: null };
            }
          } catch (_) {}
          return { done: null };
        }

        // 체크리스트 li 에 상태(클래스/아이콘) + 클릭 점프를 입힌다.
        // updateReportChecklist 가 li 를 새로 그리므로, 그 직후에 호출한다.
        function decorateChecklist(type) {
          const ul = document.getElementById("reportChecklist");
          if (!ul || !type) return;
          const formEl = document.querySelector('[data-report-form="' + type + '"]');
          ul.querySelectorAll("li").forEach((li) => {
            // 이미 입혀진 상태 아이콘 제거 후 재계산(텍스트는 보존).
            const baseText = li.dataset.baseText || li.textContent;
            li.dataset.baseText = baseText;
            const st = checklistStatus(type, baseText);
            li.classList.remove("chk-done", "chk-todo", "chk-info");
            // 아이콘 prefix 노드를 별도 span 으로 관리.
            let icon = li.querySelector(".chk-ico");
            if (!icon) {
              icon = document.createElement("span");
              icon.className = "chk-ico";
              icon.setAttribute("aria-hidden", "true");
              li.insertBefore(icon, li.firstChild);
            }
            if (st.done === true) {
              li.classList.add("chk-done");
              icon.textContent = "✓";
            } else if (st.done === false) {
              li.classList.add("chk-todo");
              icon.textContent = st.optional ? "○" : "•";
            } else {
              li.classList.add("chk-info");
              icon.textContent = "·";
            }
            // 클릭 점프(폼이 보일 때만 의미). 한 번만 바인딩.
            if (st.jump && !li.dataset.chkJumpBound) {
              li.dataset.chkJumpBound = "1";
              li.style.cursor = "pointer";
              li.setAttribute("role", "button");
              li.setAttribute("tabindex", "0");
              const go = () => jumpToChecklistTarget(type, formEl, st.jump);
              li.addEventListener("click", go);
              li.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
              });
            }
            li.dataset.chkJump = st.jump || "";
          });
        }

        function jumpToChecklistTarget(type, formEl, jump) {
          try {
            if (jump === "studentId") {
              if (typeof showTab === "function") showTab("settings");
              const input = document.getElementById("settingsStudentIdInput");
              if (input) { try { input.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} input.focus(); }
              return;
            }
            // 위저드(report-flow) 폼이면 해당 단계로 이동, 아니면(단일페이지 폼) 그냥 스크롤.
            if (formEl && formEl.classList.contains("report-flow") && typeof setFlowStep === "function") {
              setFlowStep(formEl, jump, { scroll: true });
            } else if (formEl) {
              try { formEl.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
            }
          } catch (_) {}
        }

        // 원본 updateReportChecklist 는 내부에서 직접 호출되어(렉시컬 바인딩) 래핑이
        // 통하지 않는다. 대신 #reportChecklist 의 자식 변경을 관찰해, 원본이 li 를
        // 다시 그릴 때마다 현재 종류 기준으로 상태(✓/강조/점프)를 다시 입힌다.
        let _chkObserver = null;
        function observeChecklistRebuild() {
          const ul = document.getElementById("reportChecklist");
          if (!ul || _chkObserver) return;
          _chkObserver = new MutationObserver(() => {
            // 관찰 콜백이 decorate 의 DOM 변경으로 재귀하지 않도록 가드.
            if (ul.dataset.chkDecorating === "1") return;
            const type = currentReportType();
            if (!type) return;
            ul.dataset.chkDecorating = "1";
            try { decorateChecklist(type); } catch (_) {}
            ul.dataset.chkDecorating = "0";
          });
          try { _chkObserver.observe(ul, { childList: true }); } catch (_) {}
        }

        // 입력/업로드/학번 변화 시 현재 종류의 체크리스트 상태를 다시 칠한다.
        function refreshChecklistState() {
          const type = currentReportType();
          if (type) { try { decorateChecklist(type); } catch (_) {} }
        }

        // 모든 폼의 입력·파일·라디오 변화에 체크리스트 갱신을 건다(중복 방지).
        function bindChecklistLiveUpdates() {
          document.querySelectorAll("[data-report-form]").forEach((formEl) => {
            if (formEl.dataset.chkLive) return;
            formEl.dataset.chkLive = "1";
            ["input", "change"].forEach((ev) =>
              formEl.addEventListener(ev, () => refreshChecklistState()),
            );
          });
        }

        // ── 3) 모바일 단계 버튼 + 진행 고정 ─────────────────────────────────
        // 좁은 화면에서 각 플로우 섹션 하단에 full-width '다음 →'(2번째부터 '← 이전')
        // 버튼을 넣어 기존 setFlowStep 으로 스텝 이동한다. 데스크톱은 CSS 로 숨겨 불변.
        const FLOW_ORDER = ["upload", "info", "settings", "generate"];

        function buildMobileStepNav(formEl) {
          if (!formEl || formEl.dataset.mobNavInit) return;
          if (!formEl.classList.contains("report-flow")) return; // enhance 안 된 폼 제외
          formEl.dataset.mobNavInit = "1";

          const nav = document.createElement("div");
          nav.className = "mobile-step-nav";
          const prev = document.createElement("button");
          prev.type = "button";
          prev.className = "mob-step-prev secondary";
          prev.textContent = "← 이전";
          const next = document.createElement("button");
          next.type = "button";
          next.className = "mob-step-next primary";
          next.textContent = "다음 →";
          nav.append(prev, next);

          prev.addEventListener("click", () => {
            const cur = formEl.dataset.flowStep || "upload";
            const i = FLOW_ORDER.indexOf(cur);
            if (i > 0) setFlowStep(formEl, FLOW_ORDER[i - 1], { scroll: true });
          });
          next.addEventListener("click", () => {
            const cur = formEl.dataset.flowStep || "upload";
            const i = FLOW_ORDER.indexOf(cur);
            if (i >= 0 && i < FLOW_ORDER.length - 1) setFlowStep(formEl, FLOW_ORDER[i + 1], { scroll: true });
          });

          // 폼 끝(form-actions 앞)에 둔다 — 데스크톱에선 CSS display:none.
          const anchor = formEl.querySelector(":scope > .form-actions");
          if (anchor) formEl.insertBefore(nav, anchor);
          else formEl.appendChild(nav);
          syncMobileStepNav(formEl);
        }

        // 현재 스텝에 맞춰 이전/다음 버튼 라벨·표시를 갱신.
        function syncMobileStepNav(formEl) {
          const nav = formEl.querySelector(":scope > .mobile-step-nav");
          if (!nav) return;
          const cur = formEl.dataset.flowStep || "upload";
          const i = FLOW_ORDER.indexOf(cur);
          const prev = nav.querySelector(".mob-step-prev");
          const next = nav.querySelector(".mob-step-next");
          if (prev) prev.style.display = i > 0 ? "" : "none";
          if (next) {
            // 마지막 단계(generate)에선 '다음' 숨김(아래에 실제 생성 버튼이 있음).
            next.style.display = i >= 0 && i < FLOW_ORDER.length - 1 ? "" : "none";
            next.textContent = i === FLOW_ORDER.length - 2 ? "생성 단계로 →" : "다음 →";
          }
        }

        // 원본 setFlowStep 은 내부 렉시컬 호출이라 래핑 불가. 대신 각 폼의
        // data-flow-step 속성 변경을 관찰해 모바일 네비를 동기화한다(스텝 탭/검증
        // 이동/제출 등 모든 경로에서 setFlowStep 이 이 속성을 바꾸므로 안전).
        function observeFlowStep(formEl) {
          if (!formEl || formEl.dataset.flowObs) return;
          formEl.dataset.flowObs = "1";
          try {
            const obs = new MutationObserver(() => {
              try { syncMobileStepNav(formEl); } catch (_) {}
            });
            obs.observe(formEl, { attributes: true, attributeFilter: ["data-flow-step"] });
          } catch (_) {}
        }

        function buildAllMobileStepNavs() {
          document.querySelectorAll("[data-report-form].report-flow").forEach((f) => {
            buildMobileStepNav(f);
            observeFlowStep(f);
          });
        }

        // 생성 중 진행 헤더(status-head: 제목 + 타이머)를 sticky 로 고정 — CSS 로 처리.
        // 여기선 progressArea 가 보일 때 body 에 표식만 단다(추가 필요 시 사용).

        // 학번 변경 신호: setStudentIdUi 가 #settingsStudentId 텍스트를 갱신하므로
        // (applyAuth·프로필 저장 등 모든 경로) 그 노드를 관찰해 체크리스트를 갱신한다.
        function observeStudentId() {
          const el = document.getElementById("settingsStudentId");
          if (!el || el.dataset.chkObs) return;
          el.dataset.chkObs = "1";
          try {
            const obs = new MutationObserver(() => {
              try { refreshChecklistState(); } catch (_) {}
            });
            obs.observe(el, { childList: true, characterData: true, subtree: true });
          } catch (_) {}
          // 입력칸에 직접 타이핑하는 경우(저장 전 미리보기)도 반영.
          const input = document.getElementById("settingsStudentIdInput");
          if (input && !input.dataset.chkObs) {
            input.dataset.chkObs = "1";
            input.addEventListener("input", () => { try { refreshChecklistState(); } catch (_) {} });
          }
        }

        // 생성 성공 신호: done 핸들러가 #statusTitle 을 '완료'로 바꾼다. 그 노드를
        // 관찰해 현재 종류의 draft 를 삭제하고 이탈 경고를 끈다(commitLastGenPrefs
        // 가 렉시컬 호출이라 래핑 불가하므로 DOM 신호를 쓴다).
        function observeGenSuccess() {
          const el = document.getElementById("statusTitle");
          if (!el || el.dataset.succObs) return;
          el.dataset.succObs = "1";
          try {
            const obs = new MutationObserver(() => {
              if ((el.textContent || "").trim() === "완료") {
                try { clearActiveDraftOnSuccess(); } catch (_) {}
              }
            });
            obs.observe(el, { childList: true, characterData: true, subtree: true });
          } catch (_) {}
        }

        // ── 초기화 + 종류 변경 훅 ───────────────────────────────────────────
        function initWave2b() {
          try { bindDraftAutosave(); } catch (_) {}
          try { observeChecklistRebuild(); } catch (_) {}
          try { bindChecklistLiveUpdates(); } catch (_) {}
          try { buildAllMobileStepNavs(); } catch (_) {}
          try { observeStudentId(); } catch (_) {}
          try { observeGenSuccess(); } catch (_) {}
          // 보고서 종류가 바뀌면 그 종류의 draft 배너·체크리스트 상태를 갱신.
          // (내부 updateReportTypeView→updateReportChecklist 가 먼저 동기 실행되고,
          //  setTimeout(0) 으로 그 뒤에 안전하게 덧입힌다.)
          try {
            document.querySelectorAll('input[name="reportType"]').forEach((r) => {
              r.addEventListener("change", () => {
                setTimeout(() => {
                  const type = currentReportType();
                  if (!type) return;
                  ensureDraftBanner(type);
                  refreshChecklistState();
                  const formEl = document.querySelector('[data-report-form="' + type + '"]');
                  if (formEl) { buildMobileStepNav(formEl); observeFlowStep(formEl); syncMobileStepNav(formEl); }
                }, 0);
              });
            });
          } catch (_) {}
          // 현재 선택된 종류가 있으면(딥링크·복원) 즉시 한 번 적용.
          try {
            const type = currentReportType();
            if (type) { ensureDraftBanner(type); refreshChecklistState(); }
          } catch (_) {}
        }

        // DOM 이 이미 파싱된 시점(app.js 는 body 끝에서 로드)이라 바로 초기화한다.
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", initWave2b);
        } else {
          initWave2b();
        }
      })();
