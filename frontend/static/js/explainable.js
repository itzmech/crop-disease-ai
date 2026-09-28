/* LeafLens AI — Explainable AI (Grad-CAM) page logic. */
(function () {
  "use strict";

  const UI = window.LeafLensUI;
  const API = window.LeafLensAPI;

  const els = {
    dz: UI.el("dropzone"),
    fileInput: UI.el("fileInput"),
    previewWrap: UI.el("previewWrap"),
    previewImg: UI.el("previewImg"),
    fileMeta: UI.el("fileMeta"),
    modelSelect: UI.el("modelSelect"),
    modelHint: UI.el("modelHint"),
    btnExplain: UI.el("btnExplain"),
    resultRegion: UI.el("resultRegion"),
    loadingCard: UI.el("loadingCard"),
    resultsPanel: UI.el("resultsPanel"),
    errorMessage: UI.el("errorMessage"),
    errorCode: UI.el("errorCode"),
    origImg: UI.el("origImg"),
    heatImg: UI.el("heatImg"),
    overlayImg: UI.el("overlayImg"),
    overlayBase: UI.el("overlayBase"),
    overlayFrame: UI.el("overlayFrame"),
    alphaRange: UI.el("alphaRange"),
    alphaVal: UI.el("alphaVal"),
    xaiModel: UI.el("xaiModel"),
    xaiLayer: UI.el("xaiLayer"),
    xaiMethod: UI.el("xaiMethod"),
    btnDownload: UI.el("btnDownload"),
  };

  let selectedFile = null;
  let lastHeatmapUrl = null;

  /* ------------------------- file handling ------------------------- */
  function acceptFile(file) {
    if (!file) return;
    if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
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
    update();
  }

  function clearFile() {
    selectedFile = null;
    els.previewImg.removeAttribute("src");
    UI.hide(els.previewWrap);
    UI.show(els.dz);
    update();
  }

  function update() {
    els.btnExplain.disabled = !(selectedFile && els.modelSelect.value);
  }

  ["dragenter", "dragover"].forEach((ev) =>
    els.dz.addEventListener(ev, (e) => { e.preventDefault(); els.dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.dz.addEventListener(ev, (e) => { e.preventDefault(); els.dz.classList.remove("dragover"); })
  );
  els.dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    acceptFile(f);
  });
  els.dz.addEventListener("click", () => els.fileInput.click());
  els.dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener("change", () => acceptFile(els.fileInput.files[0]));
  UI.el("btnReplace").addEventListener("click", () => els.fileInput.click());
  UI.el("btnClear").addEventListener("click", clearFile);
  els.modelSelect.addEventListener("change", update);

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
      if (first) { els.modelSelect.value = first.id; update(); }
    } catch (_) { /* surfaced on submit */ }
  })();

  /* ------------------------- steps ------------------------- */
  const steps = {
    root: UI.el("analysisSteps"),
    set(name, state) {
      const li = UI.qs(`li[data-step="${name}"]`, this.root);
      if (li) { li.classList.remove("active", "done"); li.classList.add(state); }
    },
    reset() { UI.qsa("li", this.root).forEach((li) => li.classList.remove("active", "done")); },
  };

  /* ------------------------- generate ------------------------- */
  els.btnExplain.addEventListener("click", async () => {
    if (!selectedFile || !els.modelSelect.value) return;

    UI.qsa(".state", els.resultRegion).forEach((n) => n.classList.remove("show"));
    UI.hide(els.resultsPanel);
    UI.show(els.loadingCard);
    steps.reset();
    els.btnExplain.disabled = true;
    els.btnExplain.innerHTML = '<div class="spinner"></div> Computing…';

    steps.set("upload", "done");
    steps.set("forward", "active");

    try {
      const res = await API.gradcam(selectedFile, els.modelSelect.value);
      steps.set("forward", "done");
      steps.set("grad", "done");
      steps.set("render", "done");
      render(res);
    } catch (err) {
      UI.hide(els.loadingCard);
      els.errorMessage.textContent = err.message || "The server could not compute an explanation.";
      els.errorCode.textContent = err.code ? `code: ${err.code}` : "";
      UI.setState(els.resultRegion, "error");
      UI.toastFromError(err);
    } finally {
      UI.hide(els.loadingCard);
      els.btnExplain.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg> Generate Grad-CAM';
      update();
    }
  });

  /* ------------------------- render ------------------------- */
  function render(res) {
    UI.hide(els.loadingCard);

    // Original preview (client-side object URL is the same file we uploaded).
    els.origImg.src = els.previewImg.src;

    // Server-produced images (data URLs from Flask).
    els.heatImg.src = res.images.heatmap;
    els.overlayImg.src = res.images.overlay;
    els.overlayBase.src = res.images.original; // same encoded original from the API
    lastHeatmapUrl = res.images.overlay || res.images.heatmap;

    els.xaiModel.textContent = res.model && res.model.label ? res.model.label : "—";
    els.xaiLayer.textContent = res.layer || "—";
    els.xaiMethod.textContent = res.method || "gradcam";

    UI.show(els.resultsPanel);
  }

  /* ------------------------- overlay alpha ------------------------- */
  els.alphaRange.addEventListener("input", () => {
    const a = Number(els.alphaRange.value) / 100;
    els.alphaVal.textContent = a.toFixed(2);
    els.overlayImg.style.opacity = String(a);
  });

  /* ------------------------- download ------------------------- */
  els.btnDownload.addEventListener("click", () => {
    if (!lastHeatmapUrl) return;
    const a = document.createElement("a");
    a.href = lastHeatmapUrl;
    a.download = `leaflens_gradcam_${els.modelSelect.value || "model"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    UI.toast("Visualization downloaded.", { title: "Saved" });
  });
})();
