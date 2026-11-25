// The loop script editor's help (Loop tab): a tooltip for the word under the mouse, and a hint line
// under the editor for the statement at the cursor. The texts come from js/loop-help.js. Not for a
// loop in raw Lua (Edit as Lua). Only the page uses this module.
import { wordHelp, lineHint, wordAt } from './loop-help.js';

const DELAY_MS = 350;
const IDLE_HINT = 'Point at a word of the script for its meaning; the line here explains the statement at the cursor.';

export function attachLoopTips(app, editor, hintEl) {
  const frags = () => (app.project && app.project.fragments) || [];
  const active = () => (app.editors.loopLanguage || 'loop') === 'loop';

  // ---- the tooltip
  const tip = document.createElement('div');
  tip.className = 'loop-tip';
  tip.id = 'loop-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let timer = 0, shownFor = '';
  const hide = () => { clearTimeout(timer); tip.hidden = true; shownFor = ''; };

  function show(help, x, y) {
    const t = document.createElement('strong');
    t.className = 'loop-tip-title';
    t.textContent = help.title;
    const p = document.createElement('span');
    p.textContent = help.text;
    tip.replaceChildren(t, p);
    tip.hidden = false;
    const w = Math.min(380, innerWidth - 16);
    tip.style.maxWidth = `${w}px`;
    tip.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - w - 8))}px`;
    // below the pointer, or above it when there is no room below
    const h = tip.offsetHeight;
    tip.style.top = `${(y + 20 + h <= innerHeight ? y + 20 : Math.max(8, y - h - 10))}px`;
  }

  const content = editor.renderer.content;
  content.addEventListener('mousemove', (e) => {
    if (!active()) { hide(); return; }
    const pos = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
    const line = editor.session.getLine(pos.row);
    // (screenToTextCoordinates clamps to the line: past its end or below the text is no word)
    const end = editor.renderer.textToScreenCoordinates(pos.row, line.length);
    const w = e.clientX <= end.pageX + 2 ? wordAt(line, pos.column) : null;
    const key = w ? `${pos.row}:${w.start}` : '';
    if (key === shownFor) return;
    clearTimeout(timer);
    if (!w) { hide(); return; }
    tip.hidden = true;
    timer = setTimeout(() => {
      const help = wordHelp(editor.getValue(), pos.row, w.start + 1, frags());
      if (!help) { shownFor = key; return; }
      shownFor = key;
      show(help, e.clientX, e.clientY);
    }, shownFor ? 0 : DELAY_MS);
  });
  content.addEventListener('mouseleave', hide);
  editor.on('change', hide);
  addEventListener('scroll', hide, { passive: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

  // ---- the hint line
  let pending = 0;
  function updateHint() {
    pending = 0;
    hintEl.hidden = !active();
    if (!active()) return;
    const row = editor.getCursorPosition().row;
    const text = editor.isFocused() ? lineHint(editor.getValue(), row, frags()) : '';
    hintEl.textContent = text || IDLE_HINT;
    hintEl.classList.toggle('idle', !text);
  }
  const later = () => { if (!pending) pending = requestAnimationFrame(updateHint); };
  editor.selection.on('changeCursor', later);
  editor.on('change', later);
  editor.on('focus', later);
  editor.on('blur', later);
  editor.session.on('changeMode', later);
  editor.on('changeSession', later);
  updateHint();
  return { update: updateHint, hide };
}
