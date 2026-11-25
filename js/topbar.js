// The top bar's pop-ups (the Project menu, Run options), the dialogs (Settings; Workspace,
// snapshots and recordings), the toast that shows the status lines of the file actions, and
// the folded tab help. Only the page uses it; it drives the existing buttons by their ids.

const $ = (id) => document.getElementById(id);
const narrow = () => matchMedia('(max-width: 760px)').matches;

export function setupTopbar() {
  // ---- pop-ups: one open at a time; Escape or a click elsewhere closes it
  const pops = [];
  for (const b of document.querySelectorAll('.menu-button[aria-controls]')) {
    const p = $(b.getAttribute('aria-controls'));
    if (p) pops.push([b, p]);
  }
  const closeAll = () => { for (const [b, p] of pops) { p.hidden = true; b.setAttribute('aria-expanded', 'false'); } };
  for (const [b, p] of pops) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = p.hidden;
      closeAll();
      p.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      // on a narrow screen a pop-up spans the screen, just under its button
      p.style.top = open && narrow() ? `${b.getBoundingClientRect().bottom + 6}px` : '';
      if (open && p.getAttribute('role') === 'menu') p.querySelector('.menu-item')?.focus();
    });
    p.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', closeAll);
  // arrow keys move through a menu
  for (const [, p] of pops) {
    if (p.getAttribute('role') !== 'menu') continue;
    p.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...p.querySelectorAll('.menu-item')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
  }

  // ---- dialogs (<dialog>): data-dialog opens one; data-scroll scrolls to a part of it
  const openDialog = (id, part) => {
    closeAll();
    const d = $(id);
    if (!d) return;
    if (!d.open) d.showModal();
    if (part && $(part)) $(part).scrollIntoView({ block: 'start' });
  };
  for (const d of document.querySelectorAll('dialog.dialog')) {
    // a click on the backdrop (the dialog element itself, outside its box) closes it
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close-dialog]')) d.close(); });
  }

  // ---- menu items and links: data-click presses a button, data-dialog opens a dialog
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-click], [data-dialog]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.click) { closeAll(); $(t.dataset.click).click(); } else openDialog(t.dataset.dialog, t.dataset.scroll);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pops.some(([, p]) => !p.hidden)) {
      const open = pops.find(([, p]) => !p.hidden);
      closeAll();
      open[0].focus();
    }
  });

  // ---- the toast: what the hidden status lines of the file actions say
  const toast = $('toast');
  let timer = 0;
  for (const s of document.querySelectorAll('.toast-source')) {
    new MutationObserver(() => {
      const text = s.textContent.trim();
      if (!text || !toast) return;
      toast.textContent = text;
      toast.classList.toggle('error', s.classList.contains('error'));
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => { toast.hidden = true; }, 5000);
    }).observe(s, { childList: true, characterData: true, subtree: true });
  }

  // ---- the project's title next to the menu
  const heading = $('project-heading');
  const showTitle = () => { $('topbar-project').textContent = heading.textContent; };
  new MutationObserver(showTitle).observe(heading, { childList: true, characterData: true, subtree: true });
  showTitle();

  // ---- Run options: the summary on the button follows the choices
  $('run-options').addEventListener('change', runOptionsSummary);
  $('run-options').addEventListener('input', runOptionsSummary);
  runOptionsSummary();
}

// Run options: the choices that differ from the defaults, on the button ("· seed 7, recording").
export function runOptionsSummary() {
  const bits = [];
  const sol = $('solutions-select').value;
  if (sol !== '0') bits.push(`${sol} solution${sol === '1' ? '' : 's'}`);
  const seed = $('run-seed').value;
  if (seed && seed !== '0') bits.push(`seed ${seed}`);
  if ($('run-randomize').checked) bits.push('randomized');
  if ($('run-record').checked) bits.push('recording');
  $('run-options-summary').textContent = bits.length ? '· ' + bits.join(', ') : '';
}
