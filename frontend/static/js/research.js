/* LeafLens AI — Research page: live dataset statistics. */
(function () {
  "use strict";

  const UI = window.LeafLensUI;
  const API = window.LeafLensAPI;

  document.addEventListener("DOMContentLoaded", async () => {
    const region = UI.el("datasetRegion");
    const panel = UI.el("datasetPanel");
    const title = UI.el("datasetTitle");
    if (!region || !panel) return;

    let data;
    try {
      data = await API.dataset();
    } catch (err) {
      UI.setState(region, "empty"); // 404: dataset_info.json not registered
      return;
    }

    const d = data || {};
    const classes = d.num_classes ?? (Array.isArray(d.classes) ? d.classes.length : null);
    const images = d.num_images ?? d.total_images ?? null;
    const train = d.num_train ?? (d.splits && d.splits.train) ?? null;
    const val = d.num_val ?? (d.splits && d.splits.validation) ?? null;
    const test = d.num_test ?? (d.splits && d.splits.test) ?? null;

    if (classes == null && images == null && train == null && val == null && test == null) {
      UI.setState(region, "empty");
      return;
    }

    if (d.name && title) title.textContent = d.name;

    const card = (value, label, sub) => `
      <article class="card card-pad card-hover reveal in">
        <div style="font-family: var(--font-display); font-weight: 700; font-size: clamp(1.6rem, 3vw, 2.2rem);">${value}</div>
        <div class="muted small">${label}</div>
        ${sub ? `<div class="small muted" style="margin-top:.2rem;">${sub}</div>` : ""}
      </article>`;

    const statGrid = [
      card(classes ?? "—", "Classes", "crop × disease combinations"),
      card(images != null ? images.toLocaleString() : "—", "Images", "total across splits"),
      card(train != null ? train.toLocaleString() : "—", "Train images", d.split_ratio || ""),
      card(val != null ? val.toLocaleString() : "—", "Validation images", ""),
      card(test != null ? test.toLocaleString() : "—", "Test images", "held-out evaluation"),
    ].join("");

    let perClass = "";
    if (Array.isArray(d.classes) && d.classes.length) {
      const items = d.classes
        .map((c) => {
          const name = typeof c === "string" ? c : c.name || c.label;
          const n = typeof c === "object" && c !== null ? (c.images ?? c.count ?? null) : null;
          return `<div class="tech-chip"><span class="t-ico">✦</span><span>${name}${n != null ? ` <span class="muted mono small">· ${n}</span>` : ""}</span></div>`;
        })
        .join("");
      perClass = `
        <h3 class="mt-3">Class inventory</h3>
        <div class="tech-grid mt-1">${items}</div>`;
    }

    panel.innerHTML = `
      <div class="stat-grid" style="grid-template-columns: repeat(${Math.min(5, 5)}, 1fr);">
        ${statGrid}
      </div>
      ${d.source ? `<p class="small muted mt-2">Source: <a href="${d.source}" rel="noopener">${d.source}</a></p>` : ""}
      ${perClass}`;

    UI.setState(region, null);
    UI.show(panel);
  });
})();
