/* LeafLens AI — shared UI helpers: toasts, reveal-on-scroll, dom utils, formatters. */
(function () {
  "use strict";

  const UI = {
    el(id) { return document.getElementById(id); },
    qs(sel, root) { return (root || document).querySelector(sel); },
    qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

    show(node) { node && node.classList.remove("hidden"); },
    hide(node) { node && node.classList.add("hidden"); },

    /* Show one of several sibling ".state" blocks inside a container. */
    setState(container, name) {
      if (!container) return;
      UI.qsa(".state", container).forEach((n) => n.classList.remove("show"));
      if (name) {
        const target = UI.qs(`.state[data-state="${name}"]`, container) || UI.qs(`#${name}`);
        target && target.classList.add("show");
      }
    },

    toast(message, opts = {}) {
      const region = UI.el("toastRegion");
      if (!region) return;
      const node = document.createElement("div");
      node.className = "toast" + (opts.type === "error" ? " error" : "");
      node.setAttribute("role", "status");
      const body = document.createElement("div");
      if (opts.title) {
        const b = document.createElement("b");
        b.textContent = opts.title + " — ";
        body.appendChild(b);
      }
      body.appendChild(document.createTextNode(message));
      node.appendChild(body);
      const close = document.createElement("button");
      close.className = "close";
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "✕";
      close.addEventListener("click", () => node.remove());
      node.appendChild(close);
      region.appendChild(node);
      setTimeout(() => node.remove(), opts.timeout || 5200);
    },

    toastFromError(err, fallback) {
      const msg = (err && err.message) || fallback || "Something went wrong.";
      UI.toast(msg, { type: "error", title: (err && err.code === "network_error") ? "Server offline" : "Error" });
    },

    fmtPct(v, digits = 1) {
      if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
      return `${Number(v).toFixed(digits)}%`;
    },

    fmtNum(v, digits = 3) {
      if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
      return Number(v).toFixed(digits);
    },

    /* Scroll-reveal (IntersectionObserver, honours prefers-reduced-motion). */
    initReveal() {
      const nodes = UI.qsa(".reveal");
      if (!nodes.length) return;
      if (!("IntersectionObserver" in window) ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        nodes.forEach((n) => n.classList.add("in"));
        return;
      }
      const io = new IntersectionObserver(
        (entries) => entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        }),
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
      );
      nodes.forEach((n) => io.observe(n));
    },
  };

  window.LeafLensUI = UI;

  document.addEventListener("DOMContentLoaded", () => UI.initReveal());
})();
