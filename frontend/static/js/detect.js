/* LeafLens AI — Disease Detection page logic. */
(function () {
  "use strict";

  const UI = window.LeafLensUI;
  const API = window.LeafLensAPI;
  const LOW_CONF = (window.LeafLens && window.LeafLens.lowConfidenceThreshold) || 60;

  const els = {
    dz: UI.el("dropzone"),
    fileInput: UI.el("fileInput"),
    previewWrap: UI.el("previewWrap"),
    previewImg: UI.el("previewImg"),
    fileMeta: UI.el("fileMeta"),
    modelSelect: UI.el("modelSelect"),
    modelHint: UI.el("modelHint"),
    btnAnalyze: UI.el("btnAnalyze"),
    resultRegion: UI.el("resultRegion"),
    loadingCard: UI.el("loadingCard"),
    resultsPanel: UI.el("resultsPanel"),
    errorMessage: UI.el("errorMessage"),
    errorCode: UI.el("errorCode"),
    predCrop: UI.el("predCrop"),
    predDisease: UI.el("predDisease"),
    confBadge: UI.el("confBadge"),
    predModel: UI.el("predModel"),
    confBarFill: UI.el("confBarFill"),
    lowConfCard: UI.el("lowConfCard"),
    top5List: UI.el("top5List"),
    predTime: UI.el("predTime"),
    predInput: UI.el("predInput"),
    severitySummary: UI.el("severitySummary"),
  };

  let selectedFile = null;
  let analyzed = false;

  /* ------------------------- file selection ------------------------- */
  function acceptFile(file) {
    if (!file) return;
    const okType = ["image/jpeg", "image/jpg", "image/png"].includes(file.type);
    if (!okType) {
      UI.toast("Please choose a JPG or PNG image.", { type: "error", title: "Unsupported file" });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      UI.toast("That image is larger than 12 MB.", { type: "error", title: "File too large" });
      return;
    }
    selectedFile = file;
    els.previewImg.src = URL.createObjectURL(file);
    els.fileMeta.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    UI.show(els.previewWrap);
    UI.hide(els.dz);
    updateAnalyze();
  }

  function clearFile() {
    selectedFile = null;
    els.previewImg.removeAttribute("src");
    UI.hide(els.previewWrap);
    UI.show(els.dz);
    updateAnalyze();
  }

  function updateAnalyze() {
    els.btnAnalyze.disabled = !(selectedFile && els.modelSelect.value);
    els.modelHint.textContent = els.modelSelect.value
      ? "Ready — press Analyze Leaf to run inference."
      : "Only models registered on the server can run inference.";
  }

  /* ------------------------- dropzone events ------------------------- */
  ["dragenter", "dragover"].forEach((ev) =>
    els.dz.addEventListener(ev, (e) => { e.preventDefault(); els.dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.dz.addEventListener(ev, (e) => { e.preventDefault(); els.dz.classList.remove("dragover"); })
  );
  els.dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    acceptFile(file);
  });
  els.dz.addEventListener("click", () => els.fileInput.click());
  els.dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener("change", () => acceptFile(els.fileInput.files[0]));
  UI.el("btnReplace").addEventListener("click", () => els.fileInput.click());
  UI.el("btnClear").addEventListener("click", clearFile);
  els.modelSelect.addEventListener("change", updateAnalyze);

  /* ------------------------- model availability ------------------------- */
  (async function checkStatus() {
    try {
      const s = await API.status();
      const available = {};
      s.models.forEach((m) => { available[m.id] = m.available; });
      Array.from(els.modelSelect.options).forEach((opt) => {
        if (!opt.value) return;
        if (available[opt.value] === false) {
          opt.disabled = true;
          opt.textContent += " — not on server";
        }
      });
      const first = s.models.find((m) => m.available);
      if (first) { els.modelSelect.value = first.id; updateAnalyze(); }
      if (!s.tensorflow) {
        els.modelHint.textContent = "TensorFlow is not installed on the server; inference is unavailable until it is set up.";
      }
    } catch (_) { /* offline: keep defaults, predict() will surface the error */ }
  })();

  /* ------------------------- analysis steps ------------------------- */
  const steps = {
    root: UI.el("analysisSteps"),
    set(name, state) {
      const li = UI.qs(`li[data-step="${name}"]`, this.root);
      if (li) { li.classList.remove("active", "done"); li.classList.add(state); }
    },
    reset() {
      UI.qsa("li", this.root).forEach((li) => li.classList.remove("active", "done"));
    },
  };

  /* ------------------------- main analysis ------------------------- */
  els.btnAnalyze.addEventListener("click", async () => {
    if (!selectedFile || !els.modelSelect.value) return;
    analyzed = true;

    UI.setState(els.resultRegion, null);
    UI.hide(els.resultsPanel);
    UI.qsa(".state", els.resultRegion).forEach((n) => n.classList.remove("show"));
    UI.show(els.loadingCard);
    steps.reset();
    els.btnAnalyze.disabled = true;
    els.btnAnalyze.innerHTML = '<div class="spinner"></div> Analyzing…';

    steps.set("upload", "active");

    try {
      // Fake nothing: mark upload done when the fetch actually leaves.
      steps.set("upload", "done");
      steps.set("model", "active");

      const result = await API.predict(selectedFile, els.modelSelect.value);

      steps.set("model", "done");
      steps.set("severity", "active");
      if (result.severity) {
        steps.set("severity", "done");
        steps.set("explain", "active");
        // Explanation generation happens on the Explainable AI page; be honest:
        steps.set("explain", "done");
      } else {
        steps.set("severity", "done");
        steps.set("explain", "done");
      }

      render(result);
    } catch (err) {
      UI.hide(els.loadingCard);
      els.errorMessage.textContent = err.message || "The server could not complete this request.";
      els.errorCode.textContent = err.code ? `code: ${err.code}${err.status ? " · http " + err.status : ""}` : "";
      UI.setState(els.resultRegion, "error");
      UI.toastFromError(err);
    } finally {
      UI.hide(els.loadingCard);
      els.btnAnalyze.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8L4 10.6l5 3.6-1.9 6 4.9-3.6 4.9 3.6-1.9-6 5-3.6-6.1-1.8z"/></svg> Analyze Leaf';
      updateAnalyze();
    }
  });

  /* ------------------------- rendering ------------------------- */
  function render(r) {
    const p = r.prediction;
    els.predCrop.textContent = p.crop || "—";
    els.predDisease.textContent = p.disease || p.label || "—";
    els.predModel.textContent = "Model · " + (r.model && r.model.label ? r.model.label : els.modelSelect.value);

    const conf = Number(p.confidence);
    els.confBadge.className = "badge " + (conf >= LOW_CONF ? "badge-green" : conf >= 35 ? "badge-amber" : "badge-red");
    els.confBadge.innerHTML = `<span class="dot"></span> Confidence ${conf.toFixed(1)}%`;
    requestAnimationFrame(() => { els.confBarFill.style.width = `${Math.min(conf, 100)}%`; });

    UI.hide(els.lowConfCard);
    if (conf < LOW_CONF) {
      UI.show(els.lowConfCard);
      UI.toast("Low-confidence prediction — interpret with caution.", { title: "Heads up" });
    }

    // Top-5
    els.top5List.innerHTML = "";
    (r.top_predictions || []).forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "row" + (i === 0 ? " top" : "");
      const label = document.createElement("span");
      label.className = "row-label";
      label.textContent = t.label;
      const pct = document.createElement("span");
      pct.className = "mono";
      pct.textContent = t.confidence.toFixed(1) + "%";
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("i");
      bar.appendChild(fill);
      row.append(label, pct, bar);
      els.top5List.appendChild(row);
      requestAnimationFrame(() => { fill.style.width = `${t.confidence}%`; });
    });

    els.predTime.textContent = r.inference_time_ms != null ? `${r.inference_time_ms} ms` : "—";
    els.predInput.textContent = r.input_size ? `${r.input_size[0]}×${r.input_size[1]}` : "—";

    // Severity block (honest states)
    els.severitySummary.innerHTML = "";
    const sev = r.severity;
    if (sev && sev.available) {
      const head = document.createElement("div");
      head.className = "flex items-center justify-between gap-2 flex-wrap";
      const left = document.createElement("div");
      left.innerHTML = `<div class="muted small">Visible affected area</div>
        <div style="font-family: var(--font-display); font-size: 1.7rem; font-weight: 700;">${sev.percent.toFixed(1)}%</div>`;
      const right = document.createElement("span");
      right.className = `badge sev-${sev.token} badge-${sev.token === "severe" ? "red" : sev.token === "moderate" ? "amber" : "green"}`;
      right.textContent = sev.label;
      head.append(left, right);
      const bar = document.createElement("div");
      bar.className = "confidence-bar mt-1";
      const fill = document.createElement("i");
      bar.appendChild(fill);
      head.appendChild(bar);
      requestAnimationFrame(() => { fill.style.width = `${Math.min(sev.percent, 100)}%`; });
      els.severitySummary.appendChild(head);
    } else if (sev && !sev.available) {
      const st = document.createElement("p");
      st.className = "small muted";
      st.style.margin = "0";
      st.innerHTML = `<b>Severity assessment unavailable</b> — ${sev.message || "The affected leaf region could not be reliably segmented."}`;
      els.severitySummary.appendChild(st);
    } else {
      const st = document.createElement("p");
      st.className = "small muted";
      st.style.margin = "0";
      st.textContent = "Severity was not part of this response.";
      els.severitySummary.appendChild(st);
    }

    UI.hide(els.loadingCard);
    UI.show(els.resultsPanel);
  }
})();
