// The editors' help: a tooltip for the word under the mouse (the loop script: js/loop-help.js; a
// fragment of the Programs tab: js/asp-scan.js), and the hint line under the loop editor for the
// statement at the cursor. Not for a loop in raw Lua (Edit as Lua). Only the page uses this module.
import { wordHelp, lineHint, wordAt } from './loop-help.js';
import { explainError } from './error-help.js';

const DELAY_MS = 350;
const IDLE_HINT = 'Point at a word of the script for its meaning; the line here explains the statement at the cursor.';

// one tooltip element for every editor
let tip = null, shownFor = '', timer = 0;
function tipElement() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'loop-tip';
  tip.id = 'loop-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  addEventListener('scroll', hideTip, { passive: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  return tip;
}
export function hideTip() { clearTimeout(timer); if (tip) tip.hidden = true; shownFor = ''; }

function showTip(help, x, y) {
  const t = tipElement();
  const title = document.createElement('strong');
  title.className = 'loop-tip-title';
  title.textContent = help.title;
  const kids = [title, document.createElement('span')];
  kids[1].textContent = help.text;
  for (const w of help.warnings || []) {
    const p = document.createElement('span');
    p.className = `loop-tip-warn ${w.type}`;
    p.textContent = w.text;
    kids.push(p);
  }
  t.replaceChildren(...kids);
  t.hidden = false;
  const w = Math.min(400, innerWidth - 16);
  t.style.maxWidth = `${w}px`;
  t.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - w - 8))}px`;
  // below the pointer, or above it when there is no room below
  const h = t.offsetHeight;
  t.style.top = `${(y + 20 + h <= innerHeight ? y + 20 : Math.max(8, y - h - 10))}px`;
}

// A tooltip on an ACE editor: help(row, col, word) -> { title, text, warnings? } | null.
// `id` tells editors apart (one tooltip is shown at a time).
export function attachTooltip(editor, id, help, active = () => true) {
  tipElement();
  const content = editor.renderer.content;
  content.addEventListener('mousemove', (e) => {
    if (!active()) { hideTip(); return; }
    const pos = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
    const line = editor.session.getLine(pos.row);
    // (screenToTextCoordinates clamps to the line: past its end or below the text is no word)
    const end = editor.renderer.textToScreenCoordinates(pos.row, line.length);
    const w = e.clientX <= end.pageX + 2 ? wordAt(line, pos.column) : null;
    const key = w ? `${id}:${pos.row}:${w.start}` : '';
    if (key === shownFor) return;
    const quick = !!shownFor && !tip.hidden;
    clearTimeout(timer);
    if (!w) { hideTip(); return; }
    tip.hidden = true;
    timer = setTimeout(() => {
      let h = null;
      try { h = help(pos.row, w.start + 1, w); } catch (err) { console.warn('editor help:', err); }
      shownFor = key;
      if (h) showTip(h, e.clientX, e.clientY);
    }, quick ? 0 : DELAY_MS);
  });
  content.addEventListener('mouseleave', hideTip);
  editor.on('change', hideTip);
}

export function attachLoopTips(app, editor, hintEl) {
  const frags = () => (app.project && app.project.fragments) || [];
  const active = () => (app.editors.loopLanguage || 'loop') === 'loop';
  attachTooltip(editor, 'loop', (row, col) => {
    const h = wordHelp(editor.getValue(), row, col, frags());
    const warnings = app.editors.marksAt('loop', row).map((a) => ({ type: a.type, text: a.text }));
    return h ? { ...h, warnings } : warnings.length ? { title: 'This line', text: '', warnings } : null;
  }, active);

  // ---- the hint line
  let pending = 0;
  function updateHint() {
    pending = 0;
    hintEl.hidden = !active();
    if (!active()) return;
    const row = editor.getCursorPosition().row;
    // an error (or a warning) on the cursor's line comes first: what it is, what to do, where to read
    const mark = editor.isFocused() ? app.editors.marksAt('loop', row)[0] : null;
    hintEl.classList.toggle('error', !!mark && mark.type === 'error');
    hintEl.classList.toggle('warn', !!mark && mark.type !== 'error');
    if (mark) {
      const [msg] = mark.text.split('\nWhat to do: ');
      const x = explainError(msg);
      const b = document.createElement('b');
      b.textContent = `Line ${row + 1}: `;
      const parts = [b, msg + (/[.:)]$/.test(msg) ? ' ' : '. ')];
      if (x.fix) parts.push(x.fix + ' ');
      if (mark.type === 'error' || !mark.lint) {
        const a = document.createElement('a');
        a.href = `#${x.section}`;
        a.textContent = `Manual: ${x.sectionTitle}`;
        parts.push(a);
      }
      hintEl.replaceChildren(...parts);
      hintEl.classList.remove('idle');
      return;
    }
    const text = editor.isFocused() ? lineHint(editor.getValue(), row, frags()) : '';
    hintEl.textContent = text || IDLE_HINT;
    hintEl.classList.toggle('idle', !text);
  }
  const later = () => { if (!pending) pending = requestAnimationFrame(updateHint); };
  editor.selection.on('changeCursor', later);
  editor.on('change', later);
  editor.on('focus', later);
  editor.on('blur', () => { if (!hintEl.matches(':hover')) later(); });
  editor.session.on('changeMode', later);
  editor.on('changeSession', later);
  updateHint();
  return { update: updateHint, hide: hideTip };
}
