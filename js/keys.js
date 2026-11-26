// Keyboard shortcuts of the page (the Observatory's own step keys are in js/cursor.js, the
// run's Ctrl+Enter in js/init.js). Only the page uses this module. When not typing:
//   ← / →        the previous / next step: the trace (Output tab), the Refinery's refinements
//                (Shift: ten steps in the trace); Home / End: the first / last traced step
//   Space        pause or resume a run (isolated page only)
//   1 … 9        the first nine tabs shown in the tab row
//   Shift+C, O, R, T, M   the Campaign, Observatory, Refinery, Tutorial or Manual tab on or off
//   Shift+A      the three advanced tabs (Campaign, Observatory, Refinery) on or off
//   ?            the list of shortcuts (a dialog)
const $ = (id) => document.getElementById(id);

// Whether a key belongs to what has the focus: an editor, a text field, a list, a slider (its own
// arrow keys), the tab row's radios (arrow keys switch tabs), a button (Space presses it).
export function keysTaken(t, key) {
  if (!t || !t.closest) return false;
  if (t.isContentEditable || t.closest('.ace_editor, textarea, select, [contenteditable="true"]')) return true;
  if (t.tagName === 'INPUT') {
    if (/^(radio|range)$/.test(t.type)) return key !== '?' && !/^[1-9]$/.test(key) && !/^[A-Z]$/.test(key);
    if (/^(checkbox|button|submit|reset|file|color)$/.test(t.type)) return key === ' ';
    return true;                                   // text, number, ...: every key is typing
  }
  if (key === ' ' && t.closest('button, a[href], summary, [role="menuitem"], [role="button"]')) return true;
  return false;
}

// Shift+letter: a tab on or off, as its checkbox in Settings (the choice is kept in this browser)
export const TAB_TOGGLES = {
  C: { box: '.campaign-checkbox', name: 'Campaign' },
  O: { box: '.observatory-checkbox', name: 'Observatory' },
  R: { box: '.lab-checkbox', name: 'Refinery' },
  T: { box: '.tutorial-checkbox', name: 'Tutorial' },
  M: { box: '.manual-checkbox', name: 'Manual' },
  A: { box: '.advanced-checkbox', name: 'Advanced (Campaign, Observatory and Refinery)', plural: true },
};
function toggleTab(letter) {
  const t = TAB_TOGGLES[letter];
  const box = t && document.querySelector(t.box);
  if (!box) return false;
  box.click();
  const s = $('keys-status');
  if (s) {
    s.textContent = '';
    s.textContent = `${t.name} tab${t.plural ? 's' : ''}: ${box.checked ? 'on' : 'off'} (Shift+${letter} switches ${t.plural ? 'them' : 'it'} ${box.checked ? 'off' : 'on'} again; also in Settings)`;
  }
  return true;
}

// a dialog, a modal or a pop-up menu is open: its own keys only
const overlayOpen = () => !!document.querySelector('dialog[open], .modal.is-visible, .popover:not([hidden])');

// the tabs shown in the tab row, in order
export function shownTabs() {
  return [...document.querySelectorAll('#tab-bar label.tab-label')].filter((l) => !l.hidden && l.offsetParent !== null);
}

function openTab(label) {
  const r = $(label.htmlFor);
  if (!r || r.checked) return;
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
}

function shownTabName() {
  const r = document.querySelector('input[name="tabs"]:checked');
  return r ? r.id : '';
}

// ← / → (and Home / End) in the tab shown now; true when the key was used
function stepKey(app, e) {
  const tab = shownTabName();
  if (tab === 'tab5') {
    const tr = app.output.trace;
    if (!tr.events.length || $('trace-view').hidden) return false;
    const d = e.shiftKey ? 10 : 1;
    const to = { ArrowLeft: tr.pos - d, ArrowRight: tr.pos + d, Home: 0, End: tr.events.length - 1 }[e.key];
    if (to == null) return false;
    tr.go(to);
    return true;
  }
  if (tab === 'tab12') {
    const b = { ArrowLeft: $('lab-prev'), ArrowRight: $('lab-next') }[e.key];
    if (!b || b.disabled || b.offsetParent === null) return false;
    b.click();
    return true;
  }
  return false;                                    // (the Observatory: js/cursor.js)
}

export function bindPageKeys(app) {
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (overlayOpen() || document.body.classList.contains('lecture')) return;
    if (keysTaken(e.target, e.key)) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    if (e.shiftKey && /^[A-Z]$/.test(e.key) && TAB_TOGGLES[e.key]) {
      if (toggleTab(e.key)) e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
      const label = shownTabs()[Number(e.key) - 1];
      if (label) { e.preventDefault(); openTab(label); }
      return;
    }
    if (e.key === ' ' && !e.shiftKey) {
      const p = $('pause-button');
      if (p && !p.hidden && !p.disabled) { e.preventDefault(); p.click(); }
      return;
    }
    if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key) && stepKey(app, e)) e.preventDefault();
  });
  // the trace's buttons name their keys
  $('trace-prev')?.setAttribute('title', 'Previous step (←; Shift+←: ten back; Home: the first)');
  $('trace-next')?.setAttribute('title', 'Next step (→; Shift+→: ten on; End: the last)');
  const pause = $('pause-button');
  if (pause) pause.title += ' (Space)';
}

// ---- the dialog that lists the shortcuts (its tab list is filled when it opens: the tabs shown
// depend on Settings)
export function openShortcuts() {
  const d = $('dialog-keys');
  if (!d) return;
  const list = $('keys-tabs');
  if (list) {
    list.textContent = '';
    shownTabs().slice(0, 9).forEach((l, i) => {
      const li = document.createElement('li');
      const k = document.createElement('kbd');
      k.textContent = String(i + 1);
      li.append(k, ' ' + l.textContent.trim());
      list.append(li);
    });
  }
  if (!d.open) d.showModal();
}
