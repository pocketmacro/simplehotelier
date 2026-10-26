/* SimpleHotelier — landing interactions (menu, header state, reveal) */
"use strict";
(function () {
  const btn = document.querySelector("#menuBtn");
  const links = document.querySelector("#lnavLinks");
  if (btn && links) {
    btn.addEventListener("click", () => links.classList.toggle("open"));
    links.addEventListener("click", () => links.classList.remove("open"));
  }
  const yr = document.querySelector("#yr");
  if (yr) yr.textContent = new Date().getFullYear();

  const nav = document.querySelector("#lnav");
  if (nav && window.IntersectionObserver) {
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px";
    document.body.prepend(sentinel);
    new IntersectionObserver(([e]) => nav.classList.toggle("scrolled", !e.isIntersecting)).observe(sentinel);
  }
  const items = document.querySelectorAll(".rv");
  if (items.length && window.IntersectionObserver) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add("in"));
  }
})();
