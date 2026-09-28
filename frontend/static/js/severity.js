/* LeafLens AI — Severity Assessment page logic. */
(function () {
  "use strict";

  const UI = window.LeafLensUI;
  const API = window.LeafLensAPI;
  const CIRC = 2 * Math.PI * 46; // gauge circumference (r=46)

  const els = {
    dz: UI.el("dropzone"),
    fileInput: UI.el("fileInput"),
    previewWrap: UI.el("previewWrap"),
    previewImg: UI.el("previewImg"),
    fileMeta: UI.el("fileMeta"),
    btnAssess: UI.el("btnAssess"),
    resultRegion: UI.el("resultRegion"),
    loadingCard: UI.el("loadingCard"),
    resultsPanel: UI.el("resultsPanel"),
    errorMessage: UI.el("errorMessage"),
    errorCode: UI.el("errorCode"),
    gaugeMeter: UI.el("gaugeMeter"),
    sevPct: UI.el("sevPct"),
    sevBadge: UI.el("sevBadge"),
    sevScale: UI.el("sevScale"),
    sevMeterFill: UI.el("sevMeterFill"),
    maskBox: UI.el("maskBox"),
    maskNote: UI.el("maskNote"),
    sevLeafRatio: UI.el("sevLeafRatio"),
    sevLesionRatio: UI.el("sevLesionRatio"),
    sevBanding: UI.el("sevBanding"),
    sevMethod: UI.el("sevMethod"),
  };

  let selectedFile = null;

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
    els.btnAssess.disabled = false;
  }

  function clearFile() {
    selectedFile = null;
    els.previewImg.removeAttribute("src");
    UI.hide(els.previewWrap);
    UI.show(els.dz);
    els.btnAssess.disabled = true;
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

  /* ------------------------- analysis steps ------------------------- */
  const steps = {
    root: UI.el("analysisSteps"),
    set(name, state) {
      const li = UI.qs(`li[data-step="${name}"]`, this.root);
      if (li) { li.classList.remove("active", "done"); li.classList.add(state); }
    },
    reset() { UI.qsa("li", this.root).forEach((li) => li.classList.remove("active", "done")); },
  };

  /* ------------------------- main flow ------------------------- */
  els.btnAssess.addEventListener("click", async () => {
    if (!selectedFile) return;

    UI.qsa(".state", els.resultRegion).forEach((n) => n.classList.remove("show"));
    UI.hide(els.resultsPanel);
    UI.show(els.loadingCard);
    steps.reset();
    els.btnAssess.disabled = true;
    els.btnAssess.innerHTML = '<div class="spinner"></div> Measuring…';

    steps.set("upload", "done");
    steps.set("mask", "active");

    try {
      const res = await API.severity(selectedFile);
      steps.set("mask", "done");
      steps.set("lesion", "done");
      steps.set("band", "done");
      render(res);
    } catch (err) {
      UI.hide(els.loadingCard);
      // 422 = measured but not reliable (no leaf / no lesion signal)
      els.errorMessage.textContent = err.message || "The affected leaf region could not be reliably segmented.";
      els.errorCode.textContent = err.code ? `code: ${err.code}` : "";
      UI.setState(els.resultRegion, "error");
    } finally {
      UI.hide(els.loadingCard);
      els.btnAssess.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 3 5-6"/></svg> Assess Severity';
      els.btnAssess.disabled = !selectedFile;
    }
  });

  /* ------------------------- rendering ------------------------- */
  function render(r) {
    // r: { ok, percent, label, token, lesion_ratio, leaf_ratio, method, banding, disclaimer }
    UI.hide(els.loadingCard);

    const pct = Number(r.percent);
    els.sevPct.textContent = pct.toFixed(1) + "%";

    const token = r.token || "mild";
    const badgeClass = token === "severe" ? "badge-red" : token === "moderate" ? "badge-amber" : "badge-green";
    els.sevBadge.className = "badge " + badgeClass;
    els.sevBadge.textContent = r.label;

    const color = token === "severe" ? "var(--red)" : token === "moderate" ? "var(--amber)" : "var(--leaf-500)";
    els.gaugeMeter.setAttribute("stroke", color);
    els.gaugeMeter.style.strokeDashoffset = String(CIRC * (1 - Math.min(pct, 100) / 100));

    els.sevMeterFill.style.width = `${Math.min(pct, 100)}%`;
    els.sevMeterFill.style.background =
      token === "severe" ? "linear-gradient(90deg, var(--amber), var(--red))"
      : token === "moderate" ? "linear-gradient(90deg, var(--leaf-400), var(--amber))"
      : "linear-gradient(90deg, var(--leaf-500), var(--leaf-300))";

    UI.qsa(".seg", els.sevScale).forEach((seg) => {
      seg.className = "seg" + (seg.dataset.band === r.label ? ` active-${token}` : "");
    });

    els.sevLeafRatio.textContent = (r.leaf_ratio * 100).toFixed(1) + "%";
    els.sevLesionRatio.textContent = (r.lesion_ratio * 100).toFixed(2) + "%";
    els.sevBanding.textContent = r.banding || "fixed_percent_bands";
    els.sevMethod.textContent = r.method || "otsu_within_leaf_mask";

    // Placeholder for a future server-rendered mask image (API extension point).
    els.maskBox.innerHTML = "";
    els.maskNote.textContent =
      "The leaf mask and lesion map are computed server-side; a visual export can be enabled as a future API extension.";

    UI.show(els.resultsPanel);
  }
})();
