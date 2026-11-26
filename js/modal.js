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

// The "?" of a fragment or of the loop script (a.modal-link): its text opens inline, in a blue
// box under the heading, as the tabs' "?" does (no dialog). A second click folds it again.
function toggleInline(link) {
  const id = link.getAttribute("data-open") + "-inline";
  const heading = link.closest("h1, h2, h3, h4") || link;
  let box = document.getElementById(id);
  if (box && box.previousElementSibling === heading) {
    box.remove();
    link.setAttribute("aria-expanded", "false");
    return;
  }
  if (box) box.remove();
  const src = document.querySelector("#" + link.getAttribute("data-open") + " .modal-content");
  if (!src) return;
  box = document.createElement("div");
  box.id = id;
  box.className = "help-box inline-help";
  for (const n of src.children) if (!/^H[1-6]$/.test(n.tagName)) box.append(n.cloneNode(true));
  heading.after(box);
  link.setAttribute("aria-controls", id);
  link.setAttribute("aria-expanded", "true");
}
for (const l of document.querySelectorAll("a.modal-link")) l.setAttribute("aria-expanded", "false");

document.addEventListener("click", (e) => {
  const inline = e.target.closest("a.modal-link[data-open]");
  if (inline) {
    e.preventDefault();
    toggleInline(inline);
    return;
  }
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
