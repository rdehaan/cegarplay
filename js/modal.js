// Modals (adapted from logic-game's js/modal.js; event delegation, so that elements
// created later, such as fragment headings, work too). Dialog semantics: focus moves into the
// modal when it opens and back to the opener when it closes; Escape closes; Tab stays inside.
let opener = null;

for (const d of document.querySelectorAll(".modal-dialog")) {
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  const h = d.querySelector("h1, h2, h3");
  if (h) {
    if (!h.id) h.id = d.closest(".modal").id + "-title";
    d.setAttribute("aria-labelledby", h.id);
  }
}

const focusable = (m) => [...m.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
  .filter((e) => e.offsetParent !== null || e === document.activeElement);

function openModal(m, from) {
  opener = from || document.activeElement;
  m.classList.add("is-visible");
  const first = m.querySelector("[data-close]") || focusable(m)[0];
  if (first) first.focus();
}

function closeModal(m) {
  m.classList.remove("is-visible");
  const o = opener;
  opener = null;
  if (o && document.contains(o)) o.focus();
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    e.preventDefault();
    const m = document.getElementById(open.getAttribute("data-open"));
    if (m) openModal(m, open);
    return;
  }
  if (e.target.closest("[data-close]")) {
    const m = e.target.closest(".modal");
    if (m) closeModal(m);
    return;
  }
  if (e.target.classList && e.target.classList.contains("modal")) closeModal(e.target);
});

document.addEventListener("keydown", (e) => {
  const m = document.querySelector(".modal.is-visible");
  if (!m) return;
  if (e.key === "Escape") { e.preventDefault(); closeModal(m); return; }
  if (e.key === "Tab") {
    const list = focusable(m);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
