// The top bar's pop-ups (the Project menu, Run options), the dialogs (Settings; Workspace,
// snapshots and recordings), the toast that shows the status lines of the file actions, and
// the folded tab help. Only the page uses it; it drives the existing buttons by their ids.

const $ = (id) => document.getElementById(id);
export const TOAST_MS = 5000;
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
  // (data-history sets "include run history" first); data-open-tab opens a tab
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-click], [data-dialog], [data-open-tab]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.click) {
      closeAll();
      if (t.dataset.history !== undefined) $('include-history').checked = t.dataset.history === '1';
      $(t.dataset.click).click();
    } else if (t.dataset.dialog) openDialog(t.dataset.dialog, t.dataset.scroll);
    else { const r = $(t.dataset.openTab); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  }, true);   // capture: a pop-up stops the bubbling of its clicks (so that it stays open)

  // the library's intro behind its "?" (inside the summary: the click must not fold the library)
  const libHelp = $('library-help-button');
  libHelp.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const box = $('library-help');
    box.hidden = !box.hidden;
    libHelp.setAttribute('aria-expanded', String(!box.hidden));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pops.some(([, p]) => !p.hidden)) {
      const open = pops.find(([, p]) => !p.hidden);
      closeAll();
      open[0].focus();
    }
  });

  // ---- the toast: what the hidden status lines of the file actions say. It goes by itself after
  // 5 s (TOAST_MS), errors and an offered Undo too; the time starts again when the pointer or the
  // focus leaves it, so that a link can be copied or Undo pressed; the cross closes it at once.
  const toast = $('toast');
  const text = document.createElement('span');
  text.className = 'toast-text';
  const close = document.createElement('button');
  close.className = 'toast-close'; close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.textContent = '\u2715';
  close.addEventListener('click', () => { toast.hidden = true; });
  toast.append(text, close);
  let timer = 0, held = false;
  const later = () => { clearTimeout(timer); if (!held && !toast.hidden) timer = setTimeout(() => { toast.hidden = true; }, TOAST_MS); };
  toast.addEventListener('mouseenter', () => { held = true; clearTimeout(timer); });
  toast.addEventListener('mouseleave', () => { held = toast.contains(document.activeElement); later(); });
  toast.addEventListener('focusin', () => { held = true; clearTimeout(timer); });
  toast.addEventListener('focusout', (e) => { if (!toast.contains(e.relatedTarget)) { held = toast.matches(':hover'); later(); } });
  for (const s of document.querySelectorAll('.toast-source')) {
    new MutationObserver(() => {
      const t = s.textContent.trim();
      if (!t) return;
      text.textContent = t;
      const error = s.classList.contains('error');
      toast.classList.toggle('error', error);
      toast.hidden = false;
      later();
    }).observe(s, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // ---- Undo: when a project replaced an edited one (New project, Open file, a restore), the
  // toast offers the snapshots' Undo as well, where it can be seen without opening the dialog
  const undo = document.createElement('button');
  undo.className = 'control-button small-button toast-undo'; undo.type = 'button'; undo.hidden = true;
  undo.addEventListener('click', () => { $('snapshot-undo-button').click(); toast.hidden = true; });
  close.before(undo);
  const syncUndo = () => {
    const on = !$('snapshot-undo').hidden;
    undo.hidden = !on;
    undo.textContent = $('snapshot-undo-button').textContent || 'Undo';
    // not when the Undo is in view already: the dialog, or next to the library's load line
    const inView = $('dialog-versions').open || !!$('load-undo-button')?.offsetParent;
    if (on && !inView) {
      if (toast.hidden) { text.textContent = $('snapshot-undo-text').textContent.trim(); toast.classList.remove('error'); toast.hidden = false; }
      later();
    }
  };
  new MutationObserver(() => setTimeout(syncUndo)).observe($('snapshot-undo'), { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true });

  // ---- the project's title next to the menu
  const heading = $('project-heading');
  const showTitle = () => { $('topbar-project').textContent = heading.textContent; };
  new MutationObserver(showTitle).observe(heading, { childList: true, characterData: true, subtree: true });
  showTitle();

  // ---- each tab's help: folded by default (the "?" opens it); one that is opened stays open
  const HELP_KEY = 'cegarplay.help-open';
  let shown = {};
  try { shown = JSON.parse(localStorage.getItem(HELP_KEY) || '{}') || {}; } catch { /* no storage */ }
  for (const d of document.querySelectorAll('details.help-fold[data-help]')) {
    d.open = !!shown[d.dataset.help];
    d.addEventListener('toggle', () => {
      if (d.open === !!shown[d.dataset.help]) return;
      if (d.open) shown[d.dataset.help] = 1; else delete shown[d.dataset.help];
      try { localStorage.setItem(HELP_KEY, JSON.stringify(shown)); } catch { /* no storage */ }
    });
  }

  // ---- the sticky tab bar (large screens): it sits under the top bar, whose height can change
  // (a wrapped row); a shadow once it sticks; a tab chosen while it sticks opens at its top
  // The run summary ("Shown: ...", the live counts, a run's error) sticks under the top bar on every
  // screen; on large screens the tab bar sticks under the summary.
  const bar = $('topbar'), tabbar = $('tab-bar'), main = document.querySelector('main');
  const summary = document.querySelector('.run-summary');
  // (set here, not as a CSS variable: css/theme.css defines every variable the stylesheets use)
  const large = matchMedia('(min-width: 1000px) and (min-height: 640px)');
  const above = () => bar.offsetHeight + summary.offsetHeight;    // what sticks above the tab bar
  const setTop = () => {
    summary.style.top = `${bar.offsetHeight}px`;
    tabbar.style.top = `${above()}px`;
    // anchors land below what sticks
    document.documentElement.style.scrollPaddingTop = `${above() + (large.matches ? tabbar.offsetHeight : 0) + 10}px`;
  };
  large.addEventListener('change', setTop);
  new ResizeObserver(setTop).observe(bar);
  new ResizeObserver(setTop).observe(summary);
  setTop();
  const stuck = () => getComputedStyle(tabbar).position === 'sticky' && tabbar.getBoundingClientRect().top <= above() + 1;
  // the shadow goes under the lowest bar that sticks: the tab bar (large screens), else the summary
  addEventListener('scroll', () => {
    const t = stuck();
    tabbar.classList.toggle('stuck', t);
    summary.classList.toggle('stuck', !t && scrollY > 0 && summary.getBoundingClientRect().top <= bar.offsetHeight + 1);
  }, { passive: true });
  // A tab that opens can re-render and shrink the page for a moment, and the browser then
  // scrolls up; so hold the page's height while it switches, then put the bar at its place.
  let fromStuck = false;
  const before = () => {
    fromStuck = stuck();
    if (fromStuck) main.style.minHeight = `${main.offsetHeight + innerHeight}px`;
  };
  tabbar.addEventListener('pointerdown', before, true);
  for (const r of document.querySelectorAll('input[name="tabs"]')) {
    r.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) before(); });
    r.addEventListener('change', () => {
      if (!fromStuck || !r.checked) return;
      fromStuck = false;
      setTimeout(() => {
        // the tab bar at its place: its position in the page, less what sticks above it
        const y = $('tab-bar-anchor').getBoundingClientRect().top + scrollY - above();
        scrollTo({ top: Math.max(0, y) });
        main.style.minHeight = '';
      }, 60);
    });
  }
  // a pointerdown that chose no other tab: let go of the held height
  tabbar.addEventListener('click', () => setTimeout(() => { if (fromStuck) { fromStuck = false; main.style.minHeight = ''; } }, 100));

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
  else if ($('run-record').indeterminate) bits.push('partial recording');
  $('run-options-summary').textContent = bits.length ? '· ' + bits.join(', ') : '';
}
