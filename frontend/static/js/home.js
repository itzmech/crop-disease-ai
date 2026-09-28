/* LeafLens AI — home page: live system status strip. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async () => {
    const badge = document.getElementById("statusBadge");
    const text = document.getElementById("statusText");
    if (!badge || !text) return;

    const setBadge = (cls, label) => {
      badge.className = `badge ${cls}`;
      badge.innerHTML = '<span class="dot"></span> ' + label;
    };

    try {
      const s = await window.LeafLensAPI.status();
      if (s.any_model_available) {
        setBadge("badge-green", "Models online");
        const ready = s.models.filter((m) => m.available).map((m) => m.label).join(", ");
        text.textContent = `Inference ready (${ready}). TF: ${s.tensorflow ? "yes" : "no"} · Grad-CAM: ${s.gradcam_enabled ? "enabled" : "disabled"}.`;
      } else {
        setBadge("badge-amber", "Models not loaded");
        text.textContent =
          "The service is running, but no trained model artifacts are registered on the server yet — " +
          "analysis will report an unavailable state until models are added.";
      }
    } catch (e) {
      setBadge("badge-red", "Service offline");
      text.textContent = "The Flask backend did not respond. Start it with: python run.py";
    }
  });
})();
