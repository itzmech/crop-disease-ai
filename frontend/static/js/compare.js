/* LeafLens AI — Model Comparison page logic (table, charts, confusion matrix). */
(function () {
  "use strict";

  const UI = window.LeafLensUI;
  const API = window.LeafLensAPI;

  const REGISTRY_LABELS = {
    cnn: "Custom CNN",
    resnet50: "ResNet50",
    mobilenetv2: "MobileNetV2",
    efficientnetb0: "EfficientNetB0",
  };

  /* ============================ TABLE ============================ */
  const tableRegion = UI.el("tableRegion");

  async function loadTable() {
    try {
      const data = await API.comparison();
      const rows = data.models || [];
      if (!data.any_available) {
        UI.setState(tableRegion, "empty");
        return;
      }
      const panel = UI.el("tablePanel");
      panel.innerHTML = "";

      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");
      table.className = "data";
      table.innerHTML = `
        <thead><tr>
          <th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th>
          <th>Inference Time</th><th>Size</th><th>Status</th>
        </tr></thead>`;
      const tbody = document.createElement("tbody");

      rows.forEach((r) => {
        const tr = document.createElement("tr");
        const cells = [
          `<b>${r.label}</b><div class="small muted mono">${r.id}</div>`,
          r.available ? UI.fmtPct(r.accuracy * 100, 1) : "—",
          r.available ? UI.fmtNum(r.precision, 3) : "—",
          r.available ? UI.fmtNum(r.recall, 3) : "—",
          r.available ? UI.fmtNum(r.f1, 3) : "—",
          r.available && r.inference_time_ms != null ? `${r.inference_time_ms} ms` : "—",
          r.available && r.model_size_mb != null ? `${r.model_size_mb} MB` : "—",
        ];
        cells.forEach((c) => {
          const td = document.createElement("td");
          td.innerHTML = c;
          tr.appendChild(td);
        });
        const tdStatus = document.createElement("td");
        if (r.available) {
          tdStatus.innerHTML = '<span class="badge badge-green"><span class="dot"></span> Evaluated</span>';
        } else {
          tdStatus.innerHTML = '<span class="badge badge-mute"><span class="dot"></span> Not available</span>';
        }
        tr.appendChild(tdStatus);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrap.appendChild(table);
      panel.appendChild(wrap);
      const note = document.createElement("p");
      note.className = "small muted mt-1";
      note.textContent = "Missing rows mean the evaluation file for that model has not been registered — they will appear automatically once added.";
      panel.appendChild(note);
      UI.show(panel);
      UI.setState(tableRegion, null);
    } catch (err) {
      UI.qs("#tableError", tableRegion).textContent = err.message || "The server did not respond.";
      UI.setState(tableRegion, "error");
    }
  }

  /* ============================ CHARTS ============================ */
  const chartsRegion = UI.el("chartsRegion");
  let accuracyChart, prfChart, latencyChart, historyChart;

  const CHART_COLORS = {
    forest: "#16452b", leaf: "#2f9e5f", leafLight: "#7dd3a1", earth: "#b08968", amber: "#e8a33d", red: "#d95d4e",
  };

  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#3d4a42", font: { family: "Inter" } } } },
      scales: {
        x: { ticks: { color: "#71806f" }, grid: { color: "rgba(7,19,13,.05)" } },
        y: { ticks: { color: "#71806f" }, grid: { color: "rgba(7,19,13,.07)" } },
      },
    };
  }

  async function loadCharts() {
    let data;
    try {
      data = await API.comparison();
    } catch (err) {
      UI.setState(chartsRegion, "error");
      return;
    }
    const rows = (data.models || []).filter((m) => m.available);
    if (!rows.length) { UI.setState(chartsRegion, "empty"); return; }
    if (!window.Chart) { UI.setState(chartsRegion, "error"); return; }

    UI.setState(chartsRegion, null);
    UI.show(UI.el("chartsPanel"));

    const labels = rows.map((r) => r.label);

    // --- Accuracy ---
    accuracyChart = new Chart(UI.el("chartAccuracy"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Accuracy",
          data: rows.map((r) => +(r.accuracy * 100).toFixed(2)),
          backgroundColor: "rgba(47,158,95,.75)",
          hoverBackgroundColor: "#2f9e5f",
          borderRadius: 10,
          maxBarThickness: 46,
        }],
      },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false } },
        scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, suggestedMin: 0, suggestedMax: 100, ticks: { callback: (v) => v + "%" } } } },
    });

    // --- Precision / Recall / F1 ---
    prfChart = new Chart(UI.el("chartPRF"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Precision", data: rows.map((r) => r.precision), backgroundColor: "rgba(22,69,43,.85)", borderRadius: 8, maxBarThickness: 26 },
          { label: "Recall", data: rows.map((r) => r.recall), backgroundColor: "rgba(47,158,95,.85)", borderRadius: 8, maxBarThickness: 26 },
          { label: "F1", data: rows.map((r) => r.f1), backgroundColor: "rgba(122,211,161,.9)", borderRadius: 8, maxBarThickness: 26 },
        ],
      },
      options: { ...baseOptions(), scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, suggestedMin: 0, suggestedMax: 1 } } },
    });

    // --- Latency ---
    latencyChart = new Chart(UI.el("chartLatency"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Inference time (ms)",
          data: rows.map((r) => r.inference_time_ms),
          backgroundColor: "rgba(176,137,104,.8)",
          hoverBackgroundColor: "#b08968",
          borderRadius: 10,
          maxBarThickness: 46,
        }],
      },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false } } },
    });
  }

  /* History selector + line chart — independent of evaluation data. */
  async function loadHistorySelect() {
    const sel = UI.el("historySelect");
    if (!sel) return;
    try {
      const av = await API.historyAvailable();
      (av.models || []).forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        sel.appendChild(opt);
      });
      if (!(av.models || []).length) {
        sel.disabled = true;
        const opt = document.createElement("option");
        opt.textContent = "No training history registered";
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => loadHistory(sel.value));
    } catch (_) { /* server offline; select stays with placeholder */ }
  }

  async function loadHistory(modelId) {
    if (!modelId) return;
    try {
      const h = await API.history(modelId);
      const s = h.series || {};
      const n = Math.max(s.accuracy.length, s.val_accuracy.length, s.loss.length, s.val_loss.length);
      const epochLabels = Array.from({ length: n }, (_, i) => `Epoch ${i + 1}`);

      const ds = [];
      if (s.accuracy.length) ds.push({ label: "Training accuracy", data: s.accuracy, borderColor: CHART_COLORS.leaf, backgroundColor: "rgba(47,158,95,.12)", tension: 0.35, fill: true, pointRadius: 0, borderWidth: 2 });
      if (s.val_accuracy.length) ds.push({ label: "Validation accuracy", data: s.val_accuracy, borderColor: CHART_COLORS.forest, tension: 0.35, pointRadius: 0, borderWidth: 2 });
      if (s.loss.length) ds.push({ label: "Training loss", data: s.loss, borderColor: CHART_COLORS.amber, borderDash: [5, 4], tension: 0.35, pointRadius: 0, borderWidth: 2 });
      if (s.val_loss.length) ds.push({ label: "Validation loss", data: s.val_loss, borderColor: CHART_COLORS.red, borderDash: [5, 4], tension: 0.35, pointRadius: 0, borderWidth: 2 });

      if (historyChart) historyChart.destroy();
      historyChart = new Chart(UI.el("chartHistory"), {
        type: "line",
        data: { labels: epochLabels, datasets: ds },
        options: { ...baseOptions(), interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom", labels: { color: "#3d4a42", boxWidth: 12 } } } },
      });
    } catch (err) {
      UI.toast(err.message || "Training history not available for this model.", { type: "error", title: "History" });
    }
  }

  /* ============================ CONFUSION MATRIX ============================ */
  const cmRegion = UI.el("cmRegion");
  const cmSelect = UI.el("cmSelect");
  const cmMode = UI.el("cmMode");
  let cmData = null;

  Object.entries(REGISTRY_LABELS).forEach(([id, label]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    cmSelect.appendChild(opt);
  });

  cmSelect.addEventListener("change", () => loadConfusion(cmSelect.value));
  cmMode.addEventListener("change", () => cmData && renderMatrix());

  async function loadConfusion(modelId) {
    if (!modelId) { UI.setState(cmRegion, "empty"); return; }
    try {
      cmData = await API.confusionMatrix(modelId);
      renderMatrix();
    } catch (err) {
      UI.qs("#cmError", cmRegion).textContent = err.message || "The server did not respond.";
      UI.setState(cmRegion, "error");
    }
  }

  function renderMatrix() {
    if (!cmData) return;
    const n = cmData.labels.length;
    const useNorm = cmMode.value === "row_normalized";
    const values = useNorm ? cmData.row_normalized : cmData.matrix;

    UI.qs("#cmTitle", cmRegion).textContent = `${cmData.model.label} — confusion matrix`;
    UI.qs("#cmEvaluatedOn", cmRegion).textContent = cmData.evaluated_on || "test split";

    // Grid layout: corner + y-axis labels + n columns, then n rows.
    const wrap = UI.qs("#cmWrap", cmRegion);
    wrap.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `minmax(90px, 130px) repeat(${n}, minmax(44px, 1fr))`;
    grid.style.gap = "3px";
    grid.style.minWidth = `${120 + n * 52}px`;

    // Header row
    const corner = document.createElement("div");
    corner.className = "cm-axis y";
    corner.innerHTML = '<div class="cm-label">true ↓ / pred →</div>';
    grid.appendChild(corner);
    cmData.labels.forEach((lab) => {
      const d = document.createElement("div");
      d.className = "cm-label";
      d.style.minHeight = "44px";
      d.title = lab;
      d.textContent = lab.length > 14 ? lab.slice(0, 13) + "…" : lab;
      grid.appendChild(d);
    });

    const maxVal = Math.max(...values.flat().map((v) => Number(v) || 0), 1e-9);

    cmData.matrix.forEach((row, i) => {
      const yl = document.createElement("div");
      yl.className = "cm-label";
      yl.title = cmData.labels[i];
      yl.textContent = cmData.labels[i].length > 16 ? cmData.labels[i].slice(0, 15) + "…" : cmData.labels[i];
      grid.appendChild(yl);

      row.forEach((_, j) => {
        const cell = document.createElement("div");
        cell.className = "cm-cell";
        const v = Number(values[i][j]) || 0;
        const t = v / maxVal;
        const isDiag = i === j;
        const base = isDiag ? "47, 158, 95" : "217, 93, 78";
        cell.style.background = `rgba(${base}, ${0.10 + 0.72 * t})`;
        cell.style.color = t > 0.55 ? "#fff" : "var(--forest-900)";
        cell.textContent = useNorm ? (v * 100).toFixed(0) + "%" : v;
        cell.title = `${cmData.labels[i]} → ${cmData.labels[j]}: ${cmData.matrix[i][j]} samples (${((cmData.row_normalized[i][j] || 0) * 100).toFixed(1)}% of row)`;
        grid.appendChild(cell);
      });
    });

    wrap.appendChild(grid);

    // Key metrics from the matrix (diagonal recall etc. — all derived, nothing invented)
    const total = cmData.total;
    const diag = cmData.matrix.reduce((acc, r, i) => acc + (Number(r[i]) || 0), 0);
    const metrics = UI.qs("#cmMetrics", cmRegion);
    metrics.innerHTML = `
      <dt>Overall accuracy (from matrix)</dt><dd class="mono">${total ? ((diag / total) * 100).toFixed(2) + "%" : "—"}</dd>
      <dt class="mt-1">Samples</dt><dd class="mono">${total}</dd>
      <dt class="mt-1">Classes</dt><dd class="mono">${n}</dd>`;
    UI.setState(cmRegion, null);
    UI.show(UI.el("cmPanel"));
  }

  /* ============================ INIT ============================ */
  loadTable();
  loadCharts();
  loadHistorySelect();
})();
