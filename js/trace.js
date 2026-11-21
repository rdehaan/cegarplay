// Trace and replay view (spec-app.md section 9).

// Split a space-separated list of atoms; spaces inside parentheses or strings do not split.
export function splitAtoms(s) {
  const out = [];
  let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < (s || '').length; i++) {
    const c = s[i];
    if (inStr) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ' ' && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// "-edge(1,2)" -> "edge/2"
export function predicateOf(atom) {
  const a = atom.replace(/^-/, '');
  const i = a.indexOf('(');
  if (i < 0) return a + '/0';
  let depth = 0, n = 1, inStr = false;
  for (let j = i; j < a.length; j++) {
    const c = a[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 1) n++;
  }
  return a.slice(0, i) + '/' + n;
}

const KIND = { reject: 'Rejected inside the search', add: 'Clause added between solves', expand: 'Rules grounded (expand)', accept: 'Accepted as a solution' };

export class TraceView {
  constructor(root) {
    this.root = root;
    this.events = [];
    this.cap = 0;
    this.pos = 0;
    root.innerHTML = `
      <p class="note" id="trace-empty">No steps recorded.</p>
      <div id="trace-view" hidden>
        <div class="trace-controls">
          <button class="control-button" id="trace-prev">&#x2190; Previous</button>
          <input type="range" id="trace-slider" min="1" max="1" value="1">
          <button class="control-button" id="trace-next">Next &#x2192;</button>
          <span id="trace-label" class="trace-label"></span>
        </div>
        <p id="trace-kind" class="trace-kind"></p>
        <div class="trace-panels">
          <div class="trace-panel"><h4>Candidate</h4><div id="trace-candidate" class="atoms"></div></div>
          <div class="trace-panel"><h4>Counterexample</h4><div id="trace-counterexample" class="atoms"></div></div>
          <div class="trace-panel"><h4>Refinement</h4><div id="trace-refinement" class="atoms"></div></div>
        </div>
        <p id="trace-cap" class="note"></p>
      </div>`;
    this.slider = root.querySelector('#trace-slider');
    this.slider.addEventListener('input', () => { this.pos = Number(this.slider.value) - 1; this.show(); });
    root.querySelector('#trace-prev').addEventListener('click', () => this.go(this.pos - 1));
    root.querySelector('#trace-next').addEventListener('click', () => this.go(this.pos + 1));
  }

  clear(cap = 0) {
    this.events = [];
    this.cap = cap;
    this.pos = 0;
    this.dirty = true;
    this.render();
  }

  add(t) {
    const atEnd = this.pos >= this.events.length - 1;
    this.events.push(t);
    if (this.events.length === 1) this.pos = 0;
    else if (atEnd && this.follow) this.pos = this.events.length - 1;
    this.dirty = true;
  }

  go(i) {
    if (!this.events.length) return;
    this.pos = Math.max(0, Math.min(this.events.length - 1, i));
    this.show();
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;
    const n = this.events.length;
    this.root.querySelector('#trace-empty').hidden = n > 0;
    this.root.querySelector('#trace-view').hidden = n === 0;
    if (!n) return;
    this.slider.max = String(n);
    this.show();
  }

  show() {
    const n = this.events.length;
    if (!n) return;
    const t = this.events[this.pos];
    this.slider.value = String(this.pos + 1);
    this.root.querySelector('#trace-label').textContent = `step ${this.pos + 1} of ${n}`;
    this.root.querySelector('#trace-kind').textContent = `${KIND[t.kind] || t.kind} · solver ${t.solver}`;
    const lits = (t.literals || []).map((l) => l.replace(/^-/, ''));
    const inRef = new Set(lits);
    const facts = t.facts || [];
    for (const f of facts) for (const a of splitAtoms(f)) inRef.add(a);
    const factText = facts.join(' ');
    const cand = splitAtoms(t.candidate).sort();
    this.fill('#trace-candidate', cand, (a) => inRef.has(a) || (facts.length && factText.includes(a)));
    this.fill('#trace-counterexample', splitAtoms(t.counterexample).sort(), () => false,
      t.counterexample === undefined ? (t.kind === 'accept' ? 'none: the check found no counterexample' : 'not recorded') : '');
    const ref = t.literals ? [...t.literals].sort((a, b) => a.replace(/^-/, '').localeCompare(b.replace(/^-/, ''))) : [...facts].sort();
    const head = t.literals ? 'one of these must hold:' : t.facts ? 'facts grounded with the refine part:' : '';
    this.fill('#trace-refinement', ref, () => false, t.kind === 'accept' ? 'none' : '', head);
    const capEl = this.root.querySelector('#trace-cap');
    capEl.textContent = this.cap && n >= this.cap
      ? `The trace holds only the first ${n} steps. Raise "Trace steps" in the Loop tab to record more.` : '';
  }

  fill(sel, atoms, hl, empty = '', head = '') {
    const box = this.root.querySelector(sel);
    box.textContent = '';
    if (head) { const h = document.createElement('div'); h.className = 'atoms-head'; h.textContent = head; box.append(h); }
    if (!atoms.length) { const d = document.createElement('div'); d.className = 'note'; d.textContent = empty || '(none)'; box.append(d); return; }
    // one line per predicate; the atoms of a predicate wrap
    const frag = document.createDocumentFragment();
    let line = null, pred = null;
    for (const a of atoms) {
      const p = predicateOf(a);
      if (!line || p !== pred) {
        line = document.createElement('div');
        line.className = 'atom-group';
        frag.append(line);
        pred = p;
      }
      const d = document.createElement('span');
      d.className = hl(a) ? 'atom hl' : 'atom';
      d.textContent = a;
      line.append(d, ' ');
    }
    box.append(frag);
  }
}
