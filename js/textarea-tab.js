// Tab in a plain text area (the Campaign tab's suite JSON, the project readme): Tab inserts two
// spaces or indents the selected lines, Shift+Tab outdents them. Without this the browser moves
// the focus to the next control. Escape, then Tab, leaves the field (no keyboard trap; the ACE
// editors work the same way). Edits go through insertText where the browser has it, so Ctrl+Z
// undoes them.

const UNIT = '  ';

// The new text and selection for a Tab (outdent: Shift+Tab) on value with selection [start, end).
// Pure, for the tests: returns { value, start, end }.
export function tabEdit(value, start, end, outdent = false) {
  const multi = value.slice(start, end).includes('\n');
  if (!outdent && !multi) {
    return { value: value.slice(0, start) + UNIT + value.slice(end), start: start + UNIT.length, end: start + UNIT.length };
  }
  // whole lines: from the start of the first selected line to the end of the last one (a
  // selection that ends just after a newline does not take in the next line)
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  let to = value.indexOf('\n', last);
  if (to < 0) to = value.length;
  const lines = value.slice(from, to).split('\n');
  // the change of each line: +2 when indenting, minus the leading spaces removed (at most 2)
  const delta = lines.map((l) => (outdent ? -Math.min(UNIT.length, l.match(/^ */)[0].length) : UNIT.length));
  const block = lines.map((l, i) => (outdent ? l.slice(-delta[i]) : UNIT + l)).join('\n');
  const total = delta.reduce((x, y) => x + y, 0);
  const s = Math.max(from, start + delta[0]);
  const e = Math.max(s, end + (multi ? total : delta[0]));
  return { value: value.slice(0, from) + block + value.slice(to), start: s, end: e };
}

function apply(t, r) {
  // replace only the changed span, through insertText when possible (keeps the undo history)
  const old = t.value;
  let a = 0;
  while (a < old.length && a < r.value.length && old[a] === r.value[a]) a++;
  let b = 0;
  while (b < old.length - a && b < r.value.length - a && old[old.length - 1 - b] === r.value[r.value.length - 1 - b]) b++;
  t.setSelectionRange(a, old.length - b);
  const text = r.value.slice(a, r.value.length - b);
  let done = false;
  try { done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text); } catch { done = false; }
  if (!done || t.value !== r.value) { t.value = r.value; t.dispatchEvent(new Event('input', { bubbles: true })); }
  t.setSelectionRange(r.start, r.end);
}

// Make Tab indent in a text area. The title says how to leave it.
export function tabIndent(t) {
  let leave = false;
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { leave = true; return; }
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || leave || t.disabled || t.readOnly) { if (e.key !== 'Shift') leave = false; return; }
    e.preventDefault();
    apply(t, tabEdit(t.value, t.selectionStart, t.selectionEnd, e.shiftKey));
  });
  t.addEventListener('blur', () => { leave = false; });
  const hint = 'Tab indents, Shift+Tab outdents; Esc then Tab leaves the field.';
  t.title = t.title ? `${t.title} ${hint}` : hint;
  t.setAttribute('aria-description', hint);
  return t;
}
