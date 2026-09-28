/* LeafLens AI — API client.
 * Every call returns parsed JSON or throws an ApiError carrying the server's
 * { ok, error, message } payload. No response is ever fabricated client-side. */
(function () {
  "use strict";

  const BASE = (window.LeafLens && window.LeafLens.apiBase) || "";

  class ApiError extends Error {
    constructor(payload, status) {
      super((payload && payload.message) || `Request failed (${status})`);
      this.name = "ApiError";
      this.payload = payload || null;
      this.status = status;
      this.code = (payload && payload.error) || "unknown";
    }
  }

  async function request(path, options = {}) {
    let res;
    try {
      res = await fetch(BASE + path, options);
    } catch (networkErr) {
      throw new ApiError({ error: "network_error", message: "Could not reach the analysis server. Is Flask running?" }, 0);
    }
    let payload = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch (_) { payload = { ok: false, error: "bad_json", message: "Server returned a non-JSON response." }; }
    }
    if (!res.ok) throw new ApiError(payload, res.status);
    return payload;
  }

  function postForm(path, form) {
    return request(path, { method: "POST", body: form });
  }

  window.LeafLensAPI = {
    ApiError,
    status: () => request("/api/status"),
    health: () => request("/api/health"),

    predict: (file, modelId) => {
      const fd = new FormData();
      fd.append("image", file, file.name || "leaf.jpg");
      fd.append("model", modelId);
      return postForm("/api/predict", fd);
    },

    severity: (file) => {
      const fd = new FormData();
      fd.append("image", file, file.name || "leaf.jpg");
      return postForm("/api/severity", fd);
    },

    gradcam: (file, modelId) => {
      const fd = new FormData();
      fd.append("image", file, file.name || "leaf.jpg");
      fd.append("model", modelId);
      return postForm("/api/gradcam", fd);
    },

    comparison: () => request("/api/models/comparison"),
    evaluation: (id) => request(`/api/models/${encodeURIComponent(id)}/evaluation`),
    history: (id) => request(`/api/models/${encodeURIComponent(id)}/history`),
    historyAvailable: () => request("/api/models/history/available"),
    confusionMatrix: (id) => request(`/api/models/${encodeURIComponent(id)}/confusion-matrix`),
    dataset: () => request("/api/dataset"),
  };
})();
