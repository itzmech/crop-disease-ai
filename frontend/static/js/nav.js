/* LeafLens AI — mobile navigation toggle. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const burger = document.getElementById("navBurger");
    const mobile = document.getElementById("navMobile");
    if (!burger || !mobile) return;

    burger.addEventListener("click", () => {
      const open = mobile.classList.toggle("open");
      burger.setAttribute("aria-expanded", String(open));
    });

    mobile.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        mobile.classList.remove("open");
        burger.setAttribute("aria-expanded", "false");
      }
    });
  });
})();
