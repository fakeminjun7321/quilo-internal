export function createJobStreamController(deps) {
  const { runtime, appendLine, setProgressStep, stopGenTimer, clearRetryCard,
    resetForm, showGenErrorCard, commitLastGenPrefs, loadBalance, loadFiles } = deps;
  const statusTitle = document.getElementById("statusTitle");
  const resultArea = document.getElementById("resultArea");

  function openPreview(url, filename) {
    if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") {
      window.open(url, "_blank", "noopener");
      return;
    }
    let dialog = document.getElementById("generationPreviewDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "generationPreviewDialog";
      dialog.className = "generation-preview-dialog";
      const head = document.createElement("div");
      head.className = "generation-preview-dialog__head";
      const title = document.createElement("strong");
      title.dataset.previewTitle = "";
      const external = document.createElement("a");
      external.dataset.previewExternal = "";
      external.target = "_blank";
      external.rel = "noopener";
      external.textContent = "새 창에서 열기";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "닫기";
      close.addEventListener("click", () => dialog.close());
      head.append(title, external, close);
      const frame = document.createElement("iframe");
      frame.dataset.previewFrame = "";
      frame.title = "생성 파일 미리보기";
      dialog.append(head, frame);
      dialog.addEventListener("close", () => frame.removeAttribute("src"));
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      document.body.appendChild(dialog);
    }
    dialog.querySelector("[data-preview-title]").textContent = filename || "파일 미리보기";
    dialog.querySelector("[data-preview-external]").href = url;
    dialog.querySelector("[data-preview-frame]").src = url;
    dialog.showModal();
  }

  function createResultActions({ jobId, filename, fileIndex = null }) {
    const suffix = fileIndex == null ? "" : `?file=${encodeURIComponent(fileIndex)}`;
    const actions = document.createElement("div");
    actions.className = "generation-result-actions";
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "generation-preview-button";
    preview.textContent = "미리보기";
    preview.addEventListener("click", () => openPreview(`/api/jobs/${jobId}/preview${suffix}`, filename));
    const download = document.createElement("a");
    download.href = `/api/jobs/${jobId}/download${suffix}`;
    download.textContent = `${filename || "파일"} 다운로드`;
    download.download = filename || "";
    actions.append(preview, download);
    return actions;
  }

  function streamJob(jobId) {
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    runtime.currentEs = es;
    const genSpinner = document.getElementById("genSpinner");
    if (genSpinner) genSpinner.hidden = false;

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
      runtime.retryCount = 0;
      if (genSpinner) genSpinner.hidden = true;

      resultArea.appendChild(createResultActions({ jobId, filename: data.filename }));

      // 보관 안내 + (사전→결과) 이어서 만들기 CTA.
      try {
        // 마지막 제출 시 캡처한 종류(없으면 빈 문자열).
        const genType =
          (typeof runtime.pendingPrefs === "object" && runtime.pendingPrefs && runtime.pendingPrefs.type) || "";
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
            }
          });
          meta.appendChild(next);
        }
        resultArea.appendChild(meta);
      } catch (_) { /* CTA 실패는 무시 — 다운로드는 정상 */ }

      // 데이터·메모 이상 점검 결과(참고 사항) — 결과 아래에 표시
      if (Array.isArray(data.warnings) && data.warnings.length) {
        const box = document.createElement("div");
        box.className = "generation-result-panel generation-result-panel--warning";
        const head = document.createElement("div");
        head.className = "generation-result-panel__title";
        head.textContent = "⚠️ 참고 사항 — 업로드한 데이터/메모에서 확인이 필요한 점";
        box.appendChild(head);
        const ul = document.createElement("ul");
        ul.className = "generation-result-panel__list";
        data.warnings.forEach((w) => {
          const li = document.createElement("li");
          li.textContent = w;
          ul.appendChild(li);
        });
        box.appendChild(ul);
        const note = document.createElement("div");
        note.className = "generation-result-panel__note";
        note.textContent =
          "보고서는 정상 생성되었습니다. 위 사항이 의도한 것이면 무시해도 되고, 데이터·메모를 고쳐 다시 생성하면 더 정확해집니다.";
        box.appendChild(note);
        resultArea.appendChild(box);
      }

      // 업로드한 .hwpx 글꼴 상세 분석 결과 — 결과 아래에 표시
      const sf = data.styleFont;
      if (sf && (sf.bodyFace || (sf.profile && sf.profile.length))) {
        const fb = document.createElement("div");
        fb.className = "generation-result-panel generation-result-panel--font";
        const h = document.createElement("div");
        h.className = "generation-result-panel__title";
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
          const sm = document.createElement("summary");
          sm.textContent = `텍스트별 글꼴 상세 (${sf.profile.length}종)`;
          det.appendChild(sm);
          const ul2 = document.createElement("ul");
          sf.profile.forEach((c) => {
            const li = document.createElement("li");
            li.textContent = `${c.face} ${c.sizePt}pt${c.bold ? " 굵게" : ""} — ${c.share}%`;
            ul2.appendChild(li);
          });
          det.appendChild(ul2);
          fb.appendChild(det);
        }
        const fn = document.createElement("div");
        fn.className = "generation-result-panel__note";
        fn.textContent =
          "보고서는 본문 글꼴로 출력했습니다(그 글꼴이 PC에 설치돼 있어야 그대로 보입니다). 글자 크기·제목 글꼴까지 맞추려면 알려주세요.";
        fb.appendChild(fn);
        resultArea.appendChild(fb);
      }

      // AI로 이어서 편집 — 인수인계 프롬프트(복사용)
      if (typeof data.handoff === "string" && data.handoff.trim()) {
        const hb = document.createElement("div");
        hb.className = "generation-result-panel generation-result-panel--handoff";
        const hh = document.createElement("div");
        hh.className = "generation-handoff-head";
        const hhTitle = document.createElement("b");
        hhTitle.textContent = "🤝 AI로 이어서 편집하기";
        hh.appendChild(hhTitle);
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "프롬프트 복사";
        copyBtn.className = "generation-handoff-copy";
        hh.appendChild(copyBtn);
        hb.appendChild(hh);
        const desc = document.createElement("div");
        desc.className = "generation-handoff-description";
        desc.textContent =
          "아래 안내문을 복사해 ChatGPT·Claude 등에 붙여넣고, 그 아래에 다운로드한 보고서 내용을 붙이면 이어서 다듬을 수 있어요(주의사항·다듬을 포인트 포함).";
        hb.appendChild(desc);
        const ta = document.createElement("textarea");
        ta.readOnly = true;
        ta.value = data.handoff;
        ta.className = "generation-handoff-text";
        hb.appendChild(ta);
        copyBtn.addEventListener("click", () => {
          ta.select();
          navigator.clipboard?.writeText(data.handoff).then(
            () => { copyBtn.textContent = "복사됨 ✓"; setTimeout(() => (copyBtn.textContent = "프롬프트 복사"), 1500); },
            () => { try { document.execCommand("copy"); copyBtn.textContent = "복사됨 ✓"; } catch {} },
          );
        });
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
      // 서버가 명시적으로 보낸 error 이벤트(e.data 있음)인지, 순수 연결 끊김
      // (e.data 없음)인지 구분한다. 서버 error 이벤트는 작업이 실제로 실패한
      // 것이라 크레딧 미차감 + 재시도 안전. 반면 연결만 끊긴 경우 서버는 작업을
      // 중단하지 않고 끝까지 돌려 파일함에 저장 + 크레딧을 차감하므로, "미차감"을
      // 단정하거나 즉시 재생성(=중복 과금)을 권하면 안 된다.
      let msg;
      try { msg = e.data ? JSON.parse(e.data) : null; } catch (_) { msg = e.data || null; }
      const serverReportedError = e && e.data != null;
      stopGenTimer(); // 경과 타이머 정지·정리
      if (genSpinner) genSpinner.hidden = true;
      es.close();

      if (serverReportedError) {
        // 진짜 실패(서버 error 이벤트). 미차감 + 같은 입력 원클릭 재시도 안전.
        const detail = msg ||
          "보고서 생성 중 오류가 발생했습니다. 크레딧은 차감되지 않았습니다. 잠시 후 다시 시도하세요.";
        appendLine("오류: " + detail);
        statusTitle.textContent = "오류";
        setProgressStep("document", "error");
        resetForm();
        showGenErrorCard({
          message: String(detail),
          detail: String(detail),
          phase: "stream",
          httpStatus: 0,
          allowRetry: true,
        });
        return;
      }

      // 연결만 끊긴 경우: 서버 작업은 계속 진행/완료됐을 수 있다. 단정하지 말고
      // 실제 작업 상태를 조회한 뒤 안내한다.
      appendLine("서버 연결이 끊겼습니다. 작업 상태를 확인하는 중…");
      statusTitle.textContent = "연결 끊김 — 상태 확인 중";
      const _jobId = jobId;
      // 완료 여부는 다운로드 엔드포인트로 확인: 200=완료, 409=아직/미완, 404=없음.
      fetch(`/api/jobs/${_jobId}/download`, { method: "GET" })
        .then((r) => {
          if (r.status === 200) {
            // 서버에서 완료됨 → 크레딧이 이미 차감됐을 수 있으므로 재생성 권하지 않는다.
            // 파일함/다운로드로 안내.
            let filename = "";
            try {
              const cd = r.headers.get("Content-Disposition") || "";
              const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
              if (m && m[1]) filename = decodeURIComponent(m[1]);
            } catch (_) {}
            appendLine("완료 — 보고서가 서버에서 생성되었습니다.");
            statusTitle.textContent = "완료(연결 끊김)";
            setProgressStep("ready");
            clearRetryCard();
            runtime.retryCount = 0;
            const box = document.createElement("div");
            box.className = "generation-result-panel generation-result-panel--recovered";
            const h = document.createElement("div");
            h.className = "generation-result-panel__title";
            h.textContent = "✅ 연결은 끊겼지만 보고서는 완성됐어요";
            box.appendChild(h);
            const p = document.createElement("div");
            p.textContent =
              "화면과의 연결만 끊겼을 뿐, 서버에서 보고서 생성이 끝났습니다. 아래 버튼 또는 '내 파일'에서 받으세요(24시간 보관). 다시 생성하면 중복 요금이 나갈 수 있으니 재생성은 하지 마세요.";
            box.appendChild(p);
            const link = document.createElement("a");
            link.href = `/api/jobs/${_jobId}/download`;
            link.textContent = filename ? `${filename} 다운로드` : "보고서 다운로드";
            if (filename) link.download = filename;
            link.className = "generation-recovered-download";
            const preview = document.createElement("button");
            preview.type = "button";
            preview.className = "generation-recovered-preview";
            preview.textContent = "미리보기";
            preview.addEventListener("click", () => openPreview(`/api/jobs/${_jobId}/preview`, filename));
            const actions = document.createElement("div");
            actions.className = "generation-recovered-actions";
            actions.append(preview, link);
            box.appendChild(actions);
            resultArea.appendChild(box);
            resetForm();
            if (typeof loadBalance === "function") loadBalance();
            if (typeof loadFiles === "function") loadFiles();
            return;
          }
          if (r.status === 404) {
            // 작업 기록이 사라짐(재배포로 컨테이너 재시작 등) → 완료 못 함, 미차감. 재시도 안전.
            appendLine("서버가 재시작되어 작업이 중단되었습니다.");
            statusTitle.textContent = "오류";
            setProgressStep("document", "error");
            resetForm();
            showGenErrorCard({
              message: "서버 재시작으로 작업이 중단되었습니다. 크레딧은 차감되지 않았습니다. 다시 시도하세요.",
              detail: "서버 재시작으로 작업이 중단되었습니다. 크레딧은 차감되지 않았습니다. 다시 시도하세요.",
              phase: "stream",
              httpStatus: 0,
              allowRetry: true,
            });
            return;
          }
          // 409 등 — 아직 진행 중이거나 상태 불명. 미차감 단정·즉시 재생성 금지.
          appendLine("보고서가 아직 생성 중일 수 있습니다.");
          statusTitle.textContent = "생성 중일 수 있음";
          setProgressStep("document", "error");
          resetForm();
          showGenErrorCard({
            message:
              "화면과의 연결이 끊겼지만 보고서는 아직 생성 중일 수 있습니다. 1~2분 뒤 '내 파일'을 확인하세요. 완료됐다면 크레딧이 차감되므로, 파일이 없을 때만 다시 시도하세요.",
            detail:
              "화면과의 연결이 끊겼지만 보고서는 아직 생성 중일 수 있습니다. 1~2분 뒤 '내 파일'을 확인하세요. 완료됐다면 크레딧이 차감되므로, 파일이 없을 때만 다시 시도하세요.",
            phase: "stream",
            httpStatus: 0,
            allowRetry: true,
          });
        })
        .catch(() => {
          // 상태 조회 자체가 실패 — 네트워크 문제. 미차감 단정하지 않고 파일 확인 권함.
          appendLine("작업 상태를 확인하지 못했습니다.");
          statusTitle.textContent = "상태 확인 실패";
          setProgressStep("document", "error");
          resetForm();
          showGenErrorCard({
            message:
              "연결이 끊겨 작업 상태를 확인하지 못했습니다. 1~2분 뒤 '내 파일'을 확인하고, 파일이 없을 때만 다시 시도하세요(완료됐다면 크레딧이 차감됩니다).",
            detail:
              "연결이 끊겨 작업 상태를 확인하지 못했습니다. 1~2분 뒤 '내 파일'을 확인하고, 파일이 없을 때만 다시 시도하세요(완료됐다면 크레딧이 차감됩니다).",
            phase: "stream",
            httpStatus: 0,
            allowRetry: true,
          });
        });
    });
  }


  return { streamJob };
}
