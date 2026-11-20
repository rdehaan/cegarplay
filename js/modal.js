// Modals (adapted from logic-game's js/modal.js; event delegation, so that elements
// created later, such as fragment headings, work too).
document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    e.preventDefault();
    const m = document.getElementById(open.getAttribute("data-open"));
    if (m) m.classList.add("is-visible");
    return;
  }
  if (e.target.closest("[data-close]")) {
    const m = e.target.closest(".modal");
    if (m) m.classList.remove("is-visible");
    return;
  }
  if (e.target.classList && e.target.classList.contains("modal")) e.target.classList.remove("is-visible");
});

document.addEventListener("keyup", (e) => {
  const m = document.querySelector(".modal.is-visible");
  if (e.key === "Escape" && m) m.classList.remove("is-visible");
});
