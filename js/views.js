// Domain views: an ASP fragment turns one recorded step into marks, drawn as
// SVG. The logic (facts, programs, marks, layouts, suggestions, cache) uses no DOM; the
// renderer (renderView, ViewPanel) touches the DOM only when called.
//
// A view: { name, fragments: [...], positions: { "node(1)": [x, y] } }. Its program is the
// instance, the named fragments (one of them holds `#program scene.` and `#program frame.`
// parts) and the step facts. It runs as plain clingo: the scene and frame parts are renamed to
// base, so no Lua main (and no trap) is involved; draw/1 atoms are the marks.
import { hashText, escapeHtml as esc } from './util.js';

// ---- terms --------------------------------------------------------------------------------
// Parse a clingo symbol text into { name, args } | { num } | { str } | tuple { name: '', args }.
export function parseTerm(text) {
  let i = 0;
  const s = String(text);
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function term() {
    ws();
    const c = s[i];
    if (c === '"') {
      let out = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') { i++; out += s[i] === 'n' ? '\n' : s[i]; } else out += s[i];
        i++;
      }
      i++;
      return { str: out };
    }
    if (c === '(') {
      i++;
      const args = list(')');
      return args.length === 1 && !args.trailingComma ? args[0] : { name: '', args };
    }
    let neg = false;
    if (c === '-') { neg = true; i++; ws(); }
    if (/[0-9]/.test(s[i])) {
      const m = /^[0-9]+/.exec(s.slice(i));
      i += m[0].length;
      return { num: neg ? -Number(m[0]) : Number(m[0]) };
    }
    const m = /^[_a-zA-Z#][A-Za-z0-9_']*/.exec(s.slice(i));
    if (!m) throw new Error(`cannot read a term at "${s.slice(i, i + 20)}"`);
    i += m[0].length;
    ws();
    let args = [];
    if (s[i] === '(') { i++; args = list(')'); }
    return { name: (neg ? '-' : '') + m[0], args };
  }
  function list(close) {
    const out = [];
    ws();
    if (s[i] === close) { i++; return out; }
    for (;;) {
      out.push(term());
      ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === close) { out.trailingComma = true; i++; return out; } continue; }
      if (s[i] === close) { i++; return out; }
      throw new Error(`expected , or ${close} in "${s}"`);
    }
  }
  const t = term();
  ws();
  if (i < s.length) throw new Error(`unexpected text after a term: "${s.slice(i)}"`);
  return t;
}
export function termText(t) {
  if (t.num !== undefined) return String(t.num);
  if (t.str !== undefined) return JSON.stringify(t.str);
  if (!t.args || !t.args.length) return t.name === '' ? '()' : t.name;
  const a = t.args.map(termText).join(',');
  return t.name === '' ? `(${a}${t.args.length === 1 ? ',' : ''})` : `${t.name}(${a})`;
}
const plainText = (t) => (t.str !== undefined ? t.str : termText(t));

// ---- step facts ---------------------------------------------------------------------------
const KIND = { r: 'reject', a: 'add', e: 'expand', s: 'solution', x: 'error' };
// The atoms of a space-separated atom text (any nesting of parentheses, strings with spaces).
function atomsOf(text) {
  const s = String(text || ''), out = [];
  let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// The facts of one step: step/1, kind/1, cand/1, cex/1 (T events only) and lit/2 (an atom and
// true or false: the value the clause asks for). step: a T event, or an R event with the
// interface atoms of its link (iface: atom texts, index j - 1 = atom j).
export function frameFacts(step, iface = []) {
  const out = [];
  if (typeof step.kind === 'string' && step.k === undefined) {           // a T event (also an expansion: facts, no literals)
    out.push(`step(${step.i}).`, `kind(${step.kind}).`);
    for (const a of atomsOf(step.candidate)) out.push(`cand(${a}).`);
    for (const a of atomsOf(step.counterexample)) out.push(`cex(${a}).`);
    for (const l of step.literals || []) {
      const neg = l.startsWith('-') || l.startsWith('not ');
      out.push(`lit(${l.replace(/^(-|not )/, '')},${neg ? 'false' : 'true'}).`);
    }
    for (const f of step.facts || []) out.push(`fact(${f}).`);
    return out;
  }
  out.push(`step(${step.i}).`, `kind(${KIND[step.k] || 'step'}).`);
  if (step.c) {
    const bits = hexToBits(step.c, iface.length);
    iface.forEach((a, j) => { if (bits[j]) out.push(`cand(${a}).`); });
  }
  for (const q of step.q || []) {
    const a = iface[Math.abs(q) - 1];
    if (a) out.push(`lit(${a},${q > 0 ? 'true' : 'false'}).`);
  }
  for (const f of step.f || []) out.push(`fact(${f}).`);
  return out;
}
function hexToBits(hex, n) {
  const bits = new Array(n).fill(false);
  for (let j = 0; j < n; j++) {
    const d = Math.floor(j / 4), pos = hex.length - 1 - d;
    if (pos < 0) break;
    bits[j] = ((parseInt(hex[pos], 16) >> (j % 4)) & 1) === 1;
  }
  return bits;
}

// ---- programs -----------------------------------------------------------------------------
// The project a view of a recorded run reads: the facts of the instance the run used first.
export function viewProject(project, instanceId) {
  const x = instanceId && (project.instances || []).find((i) => i.id === instanceId);
  const inst = x ? (typeof x.facts === 'string' ? x.facts : null) : null;
  const consts = { ...((project.settings && project.settings.constants) || {}), ...((x && x.constants) || {}) };
  const fragments = inst !== null ? [{ name: 'instance', text: inst }, ...project.fragments.filter((f) => f.name !== 'instance')] : project.fragments;
  return { ...project, fragments, settings: { ...(project.settings || {}), constants: consts } };
}

const viewText = (project, view) => {
  const texts = [];
  const inst = project.fragments.find((f) => f.name === 'instance');
  if (inst && !(view.fragments || []).includes('instance')) texts.push(inst.text);
  for (const n of view.fragments || []) {
    const f = project.fragments.find((x) => x.name === n);
    if (!f) throw new Error(`view ${view.name}: no fragment named ${n}`);
    texts.push(f.text || '');
  }
  // the project's constants as #const lines, so the text alone decides the frame (and its hash);
  // a fragment's own '#const k = default.' gets the project's value instead (as -c k=v would)
  const parts = [];
  for (const [k, v] of Object.entries((project.settings && project.settings.constants) || {})) {
    if (!/^[a-z][A-Za-z0-9_]*$/.test(k) || !/^[^\s"']+$/.test(String(v))) continue;
    const def = new RegExp(`#const\\s+${k}\\s*=[^.]*\\.(?!\\d)`, 'g');
    let own = false;
    for (let i = 0; i < texts.length; i++) {
      if (def.test(texts[i])) { own = true; texts[i] = texts[i].replace(def, `#const ${k} = ${v}.`); }
      def.lastIndex = 0;
    }
    if (!own) parts.push(`#const ${k} = ${v}.`);
  }
  return [...parts, ...texts].join('\n');
};
// The scene: base and scene parts (frame parts are left out: plain clingo grounds base only).
export function sceneProgram(project, view) {
  return viewText(project, view).replace(/#program\s+scene\s*\.\s*/g, '#program base.\n') + '\n';
}
// One frame: base, scene and frame parts with the step facts.
export function viewProgram(project, view, facts) {
  const t = viewText(project, view).replace(/#program\s+(scene|frame)\s*\.\s*/g, '#program base.\n');
  return `${t}\n#program base.\n${facts.join('\n')}\n`;
}
export const VIEW_OPTIONS = '--outf=2 -V0 -n1';

// The draw/1 atoms of a run with VIEW_OPTIONS -> { atoms, error }.
export function viewAtoms(run) {
  const text = (run.out || []).join('\n');
  if (run.status === 65 || run.status === 'trap' || !text.trim().startsWith('{')) {
    return { atoms: [], error: (run.err || []).join('\n').trim() || `clingo exited with status ${run.status}` };
  }
  let res;
  try { res = JSON.parse(text); } catch (e) { return { atoms: [], error: `cannot read the output: ${e.message}` }; }
  if (!String(res.Result).startsWith('SAT')) return { atoms: [], error: `the view program is ${String(res.Result).toLowerCase()}` };
  const w = res.Call && res.Call[0] && res.Call[0].Witnesses && res.Call[0].Witnesses[0];
  // only draw/1 atoms are marks (a view without #show draw/1 shows its helper atoms too)
  return { atoms: (w ? w.Value : []).filter((a) => a.startsWith('draw(')), error: null };
}

// ---- marks --------------------------------------------------------------------------------
export const MARKS = { node: 1, edge: 2, cell: 2, item: 2, rank: 3, attr: 3, emph: 1, ghost: 1, note: 1, layout: 1, pos: 3 };
export const LAYOUTS = ['grid', 'list', 'circle', 'layers', 'graph'];
export const ATTR_KEYS = ['fill', 'stroke', 'label', 'weight'];

// atoms: texts of draw/1 atoms (or of their arguments). Returns { elements, attrs, emph, ghost,
// notes, layout, pos, problems }. Elements are keyed by the text of their term.
export function parseMarks(atoms, viewName = 'view') {
  const out = { elements: new Map(), attrs: new Map(), emph: new Set(), ghost: new Set(), notes: [], layout: null, pos: new Map(), problems: [] };
  const bad = (m, why) => out.problems.push(`view ${viewName}: ${why} in ${m}`);
  for (const a of atoms) {
    let t;
    try { t = parseTerm(a); } catch (e) { bad(a, e.message); continue; }
    if (t.name === 'draw' && t.args.length === 1) t = t.args[0];
    const name = t.name, args = t.args || [];
    if (!(name in MARKS) || MARKS[name] !== args.length) { bad(termText(t), `unknown mark ${name || termText(t)}/${args.length}`); continue; }
    const key = termText(t);
    switch (name) {
      case 'node': out.elements.set(key, { kind: 'node', key, label: plainText(args[0]) }); break;
      case 'edge': out.elements.set(key, { kind: 'edge', key, from: `node(${termText(args[0])})`, to: `node(${termText(args[1])})` }); break;
      case 'cell': {
        if (args[0].num === undefined || args[1].num === undefined) { bad(key, 'a cell needs two integers'); break; }
        out.elements.set(key, { kind: 'cell', key, row: args[0].num, col: args[1].num, label: '' });
        break;
      }
      case 'item': out.elements.set(key, { kind: 'item', key, label: plainText(args[0]), order: args[1].num ?? 0 }); break;
      case 'rank': out.elements.set(key, { kind: 'rank', key, list: plainText(args[0]), order: args[1].num ?? 0, label: plainText(args[2]) }); break;
      case 'attr': {
        const k = plainText(args[1]);
        if (!ATTR_KEYS.includes(k)) { bad(key, `unknown attribute ${k} (use ${ATTR_KEYS.join(', ')})`); break; }
        if (k === 'weight' && args[2].num === undefined) { bad(key, 'weight takes a number'); break; }
        const e = termText(args[0]);
        const m = out.attrs.get(e) || {};
        m[k] = k === 'weight' ? args[2].num : plainText(args[2]);
        out.attrs.set(e, m);
        break;
      }
      case 'emph': out.emph.add(termText(args[0])); break;
      case 'ghost': out.ghost.add(termText(args[0])); break;
      case 'note': out.notes.push(plainText(args[0])); break;
      case 'layout': {
        const l = plainText(args[0]);
        if (!LAYOUTS.includes(l)) bad(key, `unknown layout ${l} (use ${LAYOUTS.join(', ')})`); else out.layout = l;
        break;
      }
      case 'pos': {
        if (args[1].num === undefined || args[2].num === undefined) { bad(key, 'pos takes two integers'); break; }
        out.pos.set(termText(args[0]), [args[1].num, args[2].num]);
        break;
      }
      default: break;
    }
  }
  return out;
}

// fill / stroke classes -> eight palette slots, in order of first use (per view panel)
export class Palette {
  constructor() { this.slots = new Map(); }
  slot(name) {
    if (!this.slots.has(name)) this.slots.set(name, this.slots.size % 8 + 1);
    return this.slots.get(name);
  }
}

// ---- layouts ------------------------------------------------------------------------------
// Positions in a 0..1000 square for nodes, cells, items and ranks. Fixed seed: the same scene
// gives the same positions. fixed: Map key -> [x, y] (pos marks and dragged positions).
export function layoutScene(scene, kind, fixed = new Map()) {
  const els = [...scene.elements.values()];
  const nodes = els.filter((e) => e.kind === 'node');
  const pos = new Map();
  const W = 1000;
  const lay = kind || (els.some((e) => e.kind === 'cell') ? 'grid' : els.some((e) => e.kind === 'edge') ? 'graph' : els.some((e) => e.kind === 'item' || e.kind === 'rank') ? 'list' : 'circle');
  // cells by row and column
  const cells = els.filter((e) => e.kind === 'cell');
  if (cells.length) {
    const rows = Math.max(...cells.map((c) => c.row)), cols = Math.max(...cells.map((c) => c.col));
    const r0 = Math.min(...cells.map((c) => c.row)), c0 = Math.min(...cells.map((c) => c.col));
    const step = W / Math.max(rows - r0 + 1, cols - c0 + 1);
    for (const c of cells) pos.set(c.key, [(c.col - c0 + 0.5) * step, (c.row - r0 + 0.5) * step]);
    pos.cellSize = step;
  }
  const items = els.filter((e) => e.kind === 'item').sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  items.forEach((e, i) => pos.set(e.key, [80, 40 + i * Math.min(60, (W - 80) / Math.max(1, items.length))]));
  const ranks = els.filter((e) => e.kind === 'rank');
  const lists = [...new Set(ranks.map((r) => r.list))];
  for (const r of ranks) pos.set(r.key, [((lists.indexOf(r.list) + 0.5) / lists.length) * W, 60 + (r.order - 1) * 70]);
  if (nodes.length) {
    const n = nodes.length;
    if (lay === 'grid') {
      const side = Math.ceil(Math.sqrt(n)), step = W / side;
      nodes.forEach((e, i) => pos.set(e.key, [(i % side + 0.5) * step, (Math.floor(i / side) + 0.5) * step]));
    } else if (lay === 'list') {
      nodes.forEach((e, i) => pos.set(e.key, [120, 40 + i * Math.min(60, (W - 80) / n)]));
    } else if (lay === 'circle' || n <= 2) {
      nodes.forEach((e, i) => pos.set(e.key, [W / 2 + 0.4 * W * Math.cos(2 * Math.PI * i / n - Math.PI / 2), W / 2 + 0.4 * W * Math.sin(2 * Math.PI * i / n - Math.PI / 2)]));
    } else if (lay === 'layers') {
      const edges = els.filter((e) => e.kind === 'edge');
      const depth = new Map([[nodes[0].key, 0]]);
      const adj = new Map(nodes.map((x) => [x.key, []]));
      for (const e of edges) { if (adj.has(e.from) && adj.has(e.to)) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); } }
      for (const start of nodes) {
        if (!depth.has(start.key)) depth.set(start.key, 0);
        const q = [start.key];
        while (q.length) { const a = q.shift(); for (const b of adj.get(a)) if (!depth.has(b)) { depth.set(b, depth.get(a) + 1); q.push(b); } }
      }
      const levels = new Map();
      for (const x of nodes) { const d = depth.get(x.key); (levels.get(d) || levels.set(d, []).get(d)).push(x.key); }
      const L = Math.max(...levels.keys()) + 1;
      for (const [d, ks] of levels) ks.forEach((k, i) => pos.set(k, [((i + 0.5) / ks.length) * W, ((d + 0.5) / L) * W]));
    } else {
      // graph: a force layout with a fixed seed (Fruchterman-Reingold, 300 rounds)
      let s = 12345;
      const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 2 ** 32; };
      const P = nodes.map((e, i) => fixed.get(e.key) ? [...fixed.get(e.key)] : [W / 2 + 0.3 * W * Math.cos(2 * Math.PI * i / n) + 20 * rnd(), W / 2 + 0.3 * W * Math.sin(2 * Math.PI * i / n) + 20 * rnd()]);
      const idx = new Map(nodes.map((e, i) => [e.key, i]));
      const E = els.filter((e) => e.kind === 'edge').map((e) => [idx.get(e.from), idx.get(e.to)]).filter(([a, b]) => a !== undefined && b !== undefined && a !== b);
      const k = 0.8 * Math.sqrt((W * W) / n);
      let t = W / 10;
      for (let round = 0; round < 300; round++) {
        const D = P.map(() => [0, 0]);
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
          let dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1];
          let d = Math.hypot(dx, dy) || 0.01;
          const f = (k * k) / d;
          D[a][0] += dx / d * f; D[a][1] += dy / d * f; D[b][0] -= dx / d * f; D[b][1] -= dy / d * f;
        }
        for (const [a, b] of E) {
          const dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1];
          const d = Math.hypot(dx, dy) || 0.01, f = (d * d) / k;
          D[a][0] -= dx / d * f; D[a][1] -= dy / d * f; D[b][0] += dx / d * f; D[b][1] += dy / d * f;
        }
        for (let a = 0; a < n; a++) {
          if (fixed.has(nodes[a].key)) continue;
          const d = Math.hypot(D[a][0], D[a][1]) || 0.01;
          P[a][0] += D[a][0] / d * Math.min(d, t); P[a][1] += D[a][1] / d * Math.min(d, t);
        }
        t *= 0.985;
      }
      // fit into the square
      const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
      const mx = Math.min(...xs), Mx = Math.max(...xs), my = Math.min(...ys), My = Math.max(...ys);
      const sc = (W - 120) / Math.max(1, Mx - mx, My - my);
      nodes.forEach((e, i) => pos.set(e.key, [60 + (P[i][0] - mx) * sc, 60 + (P[i][1] - my) * sc]));
    }
  }
  for (const [k, p] of fixed) if (pos.has(k)) pos.set(k, [...p]);
  pos.layout = lay;
  return pos;
}

// ---- suggestions ----------------------------------------------------------------------------
// A view as ASP text from predicate signatures. iface: interface atom texts; facts: the fact
// atom texts of the shared program (and instance). A binary fact predicate over the domain of a
// unary interface predicate makes a graph; an interface atom p(X,V) an attribute of node X; a
// predicate with two integer arguments a grid; anything else: one node per interface atom.
export function suggestView(iface, facts = []) {
  const sig = (a) => { const t = parseTerm(a); return { t, name: t.name, n: (t.args || []).length }; };
  const I = iface.map(sig), F = facts.map(sig);
  const lines = ['% A view suggested from the predicate signatures; edit freely.', '#program scene.'];
  const frame = ['#program frame.'];
  const show = '#show draw/1.';
  const byName = (list) => { const m = new Map(); for (const x of list) { const k = `${x.name}/${x.n}`; (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
  const IN = byName(I), FN = byName(F);
  const unaryI = [...IN.entries()].filter(([k]) => k.endsWith('/1'));
  const dom = new Set(unaryI.flatMap(([, xs]) => xs.map((x) => termText(x.t.args[0]))));
  const graphPred = [...FN.entries()].find(([k, xs]) => k.endsWith('/2') && xs.every((x) => dom.has(termText(x.t.args[0])) && dom.has(termText(x.t.args[1]))));
  const gridPred = [...IN.entries()].find(([k, xs]) => (k.endsWith('/2') || k.endsWith('/3')) && xs.every((x) => x.t.args[0].num !== undefined && x.t.args[1].num !== undefined));
  if (graphPred && unaryI.length) {
    const [gk] = graphPred;
    const [ik] = unaryI[0];
    const g = gk.split('/')[0], p = ik.split('/')[0];
    lines.push('draw(layout(graph)).', `draw(node(X)) :- ${p}_dom(X).`, `draw(edge(X,Y)) :- ${g}(X,Y).`);
    for (const x of dom) lines.push(`${p}_dom(${x}).`);
    for (const [k] of unaryI) {
      const q = k.split('/')[0];
      frame.push(`draw(attr(node(X), fill, ${q})) :- cand(${q}(X)).`, `draw(emph(node(X))) :- lit(${q}(X), _).`);
    }
    frame.push('draw(note(K)) :- kind(K).');
    return [...lines, '', ...frame, show].join('\n') + '\n';
  }
  if (gridPred) {
    const [k, xs] = gridPred;
    const p = k.split('/')[0], n = Number(k.split('/')[1]);
    lines.push('draw(layout(grid)).');
    for (const x of xs) lines.push(`draw(cell(${termText(x.t.args[0])},${termText(x.t.args[1])})).`);
    const rest = n === 3 ? ',V' : '';
    frame.push(`draw(attr(cell(R,C), fill, ${n === 3 ? 'V' : 'in'})) :- cand(${p}(R,C${rest})).`);
    if (n === 3) frame.push(`draw(attr(cell(R,C), label, V)) :- cand(${p}(R,C,V)).`);
    frame.push(`draw(emph(cell(R,C))) :- lit(${p}(R,C${n === 3 ? ',_' : ''}), _).`, 'draw(note(K)) :- kind(K).');
    return [...lines, '', ...frame, show].join('\n') + '\n';
  }
  const binI = [...IN.entries()].filter(([k]) => k.endsWith('/2'));
  lines.push(`draw(layout(${iface.length > 36 ? 'grid' : 'circle'})).`);
  if (binI.length && !unaryI.length) {
    // p(X,V): one node per X, the value as an attribute
    const xsAll = new Set(binI.flatMap(([, xs]) => xs.map((x) => termText(x.t.args[0]))));
    for (const x of xsAll) lines.push(`draw(node(${x})).`);
    for (const [k] of binI) {
      const p = k.split('/')[0];
      frame.push(`draw(attr(node(X), fill, V)) :- cand(${p}(X,V)).`, `draw(attr(node(X), label, V)) :- cand(${p}(X,V)).`, `draw(emph(node(X))) :- lit(${p}(X,_), _).`);
    }
  } else {
    for (const a of iface) lines.push(`draw(node(${a})).`);
    frame.push('draw(attr(node(A), fill, in)) :- cand(A).', 'draw(emph(node(A))) :- lit(A, _).');
  }
  frame.push('draw(note(K)) :- kind(K).');
  return [...lines, '', ...frame, show].join('\n') + '\n';
}

// ---- a frame cache --------------------------------------------------------------------------
export class FrameCache {
  constructor(limit = 200) { this.limit = limit; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) { this.map.set(k, v); while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); }
}

// Frames on one engine: a request for a step the cursor has left is dropped; cached frames
// make no engine call. run(program, options) -> { status, out, err }.
export class FrameSource {
  constructor(run) { this.run = run; this.cache = new FrameCache(200); this.calls = 0; this.tickets = new Map(); this.busy = null; }
  get latest() { return this.tickets.get('main') || 0; }
  // channel: requests of one channel replace each other (the main view, the compare view);
  // channels do not cancel each other. One engine call at a time.
  async frame(program, channel = 'main') {
    const key = hashText(program);
    const hit = this.cache.get(key);
    const ticket = (this.tickets.get(channel) || 0) + 1;
    this.tickets.set(channel, ticket);
    if (hit) return hit;
    const current = () => this.tickets.get(channel) === ticket;
    while (this.busy) {
      await this.busy.catch(() => {});
      if (!current()) return null;
    }
    if (!current()) return null;
    const p = (async () => { this.calls++; return viewAtoms(await this.run(program, VIEW_OPTIONS)); })();
    this.busy = p;
    try {
      const r = await p;
      if (!r.error) this.cache.set(key, r);
      return current() ? r : null;
    } finally { this.busy = null; }
  }
}

// ---- export ---------------------------------------------------------------------------------
// The SVG of one frame as a standalone file: no DOM, fixed light colours (the eight palette slots
// in the order of first use), elements in scene order. Deterministic: the same marks and
// positions give the same text.
export const EXPORT_PALETTE = ['#2980b9', '#e67e22', '#27ae60', '#8e44ad', '#c0392b', '#16a085', '#d4ac0d', '#7f8c8d'];
const r1 = (x) => Math.round(x * 10) / 10;
export function frameSVG(scene, frame, pos, { palette = new Palette(), title = 'view', x0 = 0 } = {}) {
  const out = [];
  const size = pos.cellSize || 0;
  const fillOf = (k) => { const a = frame.attrs.get(k) || {}; return a.fill ? EXPORT_PALETTE[palette.slot(a.fill) - 1] : '#ffffff'; };
  const strokeOf = (k, d) => { const a = frame.attrs.get(k) || {}; return a.stroke ? EXPORT_PALETTE[palette.slot(a.stroke) - 1] : d; };
  const widthOf = (k, d) => { const a = frame.attrs.get(k) || {}; return a.weight !== undefined ? a.weight : frame.emph.has(k) ? 8 : d; };
  const op = (k) => (frame.ghost.has(k) ? ' opacity="0.25"' : '');
  const els = [...scene.elements.values()];
  for (const e of els.filter((x) => x.kind === 'edge')) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    out.push(`<line x1="${r1(a[0] + x0)}" y1="${r1(a[1])}" x2="${r1(b[0] + x0)}" y2="${r1(b[1])}" stroke="${strokeOf(e.key, '#bbbbbb')}" stroke-width="${widthOf(e.key, 4)}"${op(e.key)}><title>${esc(e.key)}</title></line>`);
  }
  for (const e of els.filter((x) => x.kind !== 'edge')) {
    const p = pos.get(e.key);
    if (!p) continue;
    const a = frame.attrs.get(e.key) || {};
    const label = a.label !== undefined ? a.label : e.label || '';
    const common = `fill="${fillOf(e.key)}" stroke="${strokeOf(e.key, frame.emph.has(e.key) ? '#222222' : '#777777')}" stroke-width="${widthOf(e.key, 3)}"${op(e.key)}`;
    const x = r1(p[0] + x0), y = r1(p[1]);
    if (e.kind === 'cell') out.push(`<rect x="${r1(x - size / 2 + 2)}" y="${r1(y - size / 2 + 2)}" width="${r1(size - 4)}" height="${r1(size - 4)}" ${common}><title>${esc(e.key)}</title></rect>`);
    else if (e.kind === 'item' || e.kind === 'rank') out.push(`<rect x="${r1(x - 60)}" y="${r1(y - 20)}" width="120" height="40" rx="6" ${common}><title>${esc(e.key)}</title></rect>`);
    else out.push(`<circle cx="${x}" cy="${y}" r="28" ${common}><title>${esc(e.key)}</title></circle>`);
    if (label) out.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="24" fill="#222222">${esc(label)}</text>`);
  }
  frame.notes.forEach((n, k) => out.push(`<text x="${x0}" y="${1060 + 30 * k}" font-family="sans-serif" font-size="26" fill="#222222">${esc(n)}</text>`));
  return out.join('\n');
}
export function svgFile(body, width = 1000, height = 1000, title = 'view') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 ${width + 80} ${height + 160}" width="${width + 80}" height="${height + 160}">\n<title>${esc(title)}</title>\n<rect x="-40" y="-40" width="${width + 80}" height="${height + 160}" fill="#ffffff"/>\n${body}\n</svg>\n`;
}
