// One result card for every verdict panel (FUTURE-DIRECTIONS, interface): the audit and the
// symbolic audit (Output tab), Fuzz and the exercise check (Instances tab). Same layout everywhere:
// a heading, explanatory paragraphs, optional extra content (a list, facts), a table of labelled
// values, notes, and a row of next steps.
//
//   resultCard(el, { verdict, title, paragraphs, content, rows, notes, actions, actionsLead })
//     verdict     'sound' | 'unsound' | 'limit' | 'budget' | 'pass' | 'fail' | 'info' (colour)
//     paragraphs  [text | { text, id, class }]
//     content     [Node]: placed after the paragraphs
//     rows        [[label, value, { class }?]]: a definition list
//     notes       [text]: small print
//     actions     [{ name, label, title, id, class, onClick }]: buttons, data-action = name
//
// The container keeps its id; the card sets data-verdict and the classes it styles.
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
};

// the colours of the card: a pass is a sound verdict, a fail an unsound one, budget a limit
const TONE = { sound: 'sound', pass: 'sound', unsound: 'unsound', fail: 'unsound', limit: 'limit', budget: 'limit', unsupported: 'limit', info: 'info' };

export function resultCard(el, { verdict = 'info', title = '', paragraphs = [], content = [], rows = [], notes = [], actions = [], actionsLead = 'Next:' } = {}) {
  el.textContent = '';
  el.hidden = false;
  el.classList.add('audit-panel', 'result-card');
  el.dataset.verdict = verdict;
  el.dataset.tone = TONE[verdict] || 'info';
  // a verdict is status: announced politely, the card named by its heading
  el.setAttribute('aria-live', 'polite');
  if (title) {
    const hid = el.id ? `${el.id}-title` : null;
    el.append(h('h3', { id: hid }, title));
    if (hid) el.setAttribute('aria-labelledby', hid); else el.setAttribute('aria-label', title);
  }
  for (const p of paragraphs) {
    if (p == null || p === '') continue;
    el.append(typeof p === 'string' ? h('p', {}, p) : h('p', { id: p.id, class: p.class }, p.text));
  }
  for (const c of content) if (c) el.append(c);
  if (rows.length) {
    const dl = h('dl');
    for (const [k, v, o] of rows) dl.append(h('dt', {}, k), h('dd', { class: o && o.class }, v));
    el.append(dl);
  }
  for (const n of notes) if (n) el.append(h('p', { class: 'note' }, n));
  if (actions.length) {
    const box = h('div', { class: 'result-actions audit-next' }, actionsLead ? h('span', { class: 'note' }, actionsLead + ' ') : null);
    for (const a of actions) {
      box.append(h('button', { type: 'button', class: ['control-button', 'small-button', a.class].filter(Boolean).join(' '), id: a.id,
        'data-action': a.name, title: a.title, onclick: a.onClick }, a.label));
    }
    el.append(box);
  }
  return el;
}
