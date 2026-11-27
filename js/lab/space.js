// Refinery: the precomputed space of one link. No DOM, no Node APIs.
//
//   labPlan(compiled, linkName, { loop, instance })   which link, which schemes, or why not
//   spaceBody(compiled, plan, { limit })               the Lua body of rt.lab_space
//   detailBody(compiled, plan, o)                      the Lua body of rt.lab_detail
//   parseSpace(lines | events, meta)                   Y lines -> LabSpace (with per-atom bitsets)
import { auditPlan, declarationLines } from '../driver.js';
import { Space } from '../space.js';
import { hashText as fnv } from '../util.js';
export { fnv };

export const LAB_LIMITS = { candidates: 200000, cex: 20, minimal: 200, exact: 3000, seconds: 30, runs: 1000 };

// The parts of a project that decide a space: the program, its instances (also generated ones), pools
export const projectText = (p) => JSON.stringify({ fragments: p.fragments, loop: p.loop, instances: p.instances, generators: p.generators,
  pools: p.pools, variants: p.variants, constants: p.settings && p.settings.constants, poolsSetting: p.settings && p.settings.pools });
export const spaceKey = (projectText, instance, variant, link) => [fnv(projectText), instance || '', variant || '', link || ''].join('|');

// Which link the lab looks at and what it supports (version 1).
// Returns { error } (nothing to look at), or { link, clause, clauses, block, schemes, unsupported?,
// loopUnsupported? } where schemes.loop/omniscient/block is true or a reason.
export function labPlan(compiled, linkName, { loop = null, instance = null } = {}) {
  if (loop && loop.language === 'lua') return { unsupported: 'a raw Lua loop: the lab reads the loop script\'s declarations' };
  if (!compiled || !compiled.ok) return { error: 'the lab needs a loop script without errors' };
  if (instance && instance.audit === false) return { unsupported: `the instance ${instance.id} is marked "audit: false" (too large to enumerate)` };
  if (compiled.solvers.some((s) => s.family) || compiled.links.some((L) => L.family)) return { unsupported: 'solver or link families' };
  if (loop && /\bon\s+partial\b/.test(loop.text || '')) return { unsupported: 'checks on partial candidates (on partial)' };
  // the link: as the audit chooses it (auditPlan), also for a loop refined only by blocks, which
  // the audit declines (blocks need no audit) but the lab compares with the other schemes
  const incoming = new Set(compiled.links.map((x) => x.to));
  let cands = compiled.links.filter((x) => !incoming.has(x.from));
  if (linkName) {
    const L0 = compiled.links.find((x) => x.name === linkName);
    if (!L0) return { error: `no link named ${linkName}` };
    if (incoming.has(L0.from)) return { unsupported: `link ${linkName} does not leave a top solver (${L0.from} has incoming links)` };
    cands = [L0];
  }
  // a loop without links (queries to one solver, as in ja-leximax or ja-dodgson) has no candidates
  // to check: nothing for the lab to compare
  if (!compiled.links.length) return { unsupported: 'the script declares no link (its solvers are queried, not refined by a check)' };
  if (!cands.length) return { error: 'the script declares no link that leaves a top solver' };
  const usesOf = (x) => (compiled.linkUses && compiled.linkUses[x.name]) || [];
  if (cands.length > 1) {
    const useful = cands.filter((x) => usesOf(x).some((u) => ['clause', 'clauses', 'block', 'core', 'lift'].includes(u)));
    if (useful.length !== 1) return { unsupported: `several links leave a top solver (${cands.map((x) => x.name).join(', ')})` };
    cands = useful;
  }
  const L = cands[0];
  const ap = auditPlan(compiled, L.name);
  const base = { link: L.name, from: L.from, to: L.to };
  if (compiled.links.filter((x) => x.from === L.from).length > 1) return { ...base, unsupported: `several links leave solver ${L.from}` };
  const expands = (compiled.parts || []).some((p) => p.solver === L.from && p.facts && p.facts.length && p.facts.every((f) => f.receiver !== 'abstraction'));
  if (expands || (ap.expand && ap.expand.length)) return { ...base, unsupported: 'the script expands the abstraction with rules (expand)' };
  const uses = (compiled.linkUses && compiled.linkUses[L.name]) || [];
  if (uses.includes('core') || ap.core) return { ...base, unsupported: 'refinement by cores' };
  if (compiled.links.some((x) => x.from === L.to)) return { ...base, unsupported: `solver ${L.to} passes models on to another solver (a chain)` };
  const clause = uses.includes('clause') || uses.includes('lift');
  const clauses = uses.includes('clauses');
  const block = !clause && !clauses && uses.includes('block');
  if (!clause && !clauses && !block) return { ...base, unsupported: `the script refines link ${L.name} by other means than ${L.name}.clause, ${L.name}.clauses or ${L.name}.block${uses.length ? ` (it uses ${uses.join(', ')})` : ''}` };
  const lift = !!(L.lift || uses.includes('lift'));
  const schemes = { loop: lift ? 'a lift link: its clauses are computed per counterexample, not from relevant/1' : true, omniscient: true, block: true };
  return { ...base, clause, clauses, block, lift, schemes };
}

const luaQ = (s) => JSON.stringify(String(s));
const indent = (lines) => lines.map((l) => '    ' + l).join('\n') + '\n';

export function spaceBody(compiled, plan, { limit = LAB_LIMITS.candidates } = {}) {
  const lines = declarationLines(compiled);
  // a block-only loop: every candidate's option is the block, read from the space (no relevant/1)
  lines.push(`rt.lab_space{ link = ${plan.link}, limit = ${Number(limit) | 0}, clause = ${plan.clause ? 'true' : 'false'}, clauses = ${plan.clauses ? 'true' : 'false'} }`);
  return indent(lines);
}

// o: { cand (hex), limit, sets: [{ r, v, members: [hex], over }], cap, lift }
export function detailBody(compiled, plan, o) {
  const lines = declarationLines(compiled);
  const sets = (o.sets || []).map((s) => `{ r = ${luaQ(s.r)}, v = ${luaQ(s.v)}, over = ${s.over ? 'true' : 'false'}, members = { ${(s.members || []).map(luaQ).join(', ')} } }`);
  lines.push(`rt.lab_detail{ link = ${plan.link}, cand = ${luaQ(o.cand)}, limit = ${Number(o.limit) | 0 || 20}, cap = ${Number(o.cap) | 0 || 20000}, lift = ${o.lift ? 'true' : 'false'},`);
  lines.push(`  sets = { ${sets.join(',\n    ')} } }`);
  return indent(lines);
}

// The Y data of a run: from raw output lines or parsed events.
export function yData(linesOrEvents) {
  const out = [];
  for (const x of linesOrEvents) {
    if (typeof x === 'string') { if (x.startsWith('@@Y ')) { try { out.push(JSON.parse(x.slice(4))); } catch { /* damaged */ } } }
    else if (x && x.kind === 'Y') out.push(x.data);
  }
  return out;
}

// hex (atom 1 = lowest bit of the last digit) -> W words
export function hexWords(hex, n, W = Math.max(1, Math.ceil(n / 32))) {
  const w = new Uint32Array(W);
  const L = hex.length;
  for (let j = 1; j <= n; j++) {
    const k = L - 1 - ((j - 1) >> 2);
    if (k < 0) break;
    const d = parseInt(hex[k], 16);
    if ((d >> ((j - 1) & 3)) & 1) w[(j - 1) >> 5] |= 1 << ((j - 1) & 31);
  }
  return w;
}
export function wordsHex(w, n) {
  let s = '';
  for (let d = Math.ceil(n / 4) - 1; d >= 0; d--) {
    let x = 0;
    for (let b = 0; b < 4; b++) { const j = d * 4 + b; if (j < n && ((w[j >> 5] >>> (j & 31)) & 1)) x |= 1 << b; }
    s += x.toString(16);
  }
  return s || '0';
}

export class LabSpace {
  // atoms: interface atom texts (1..n as atoms[0..n-1]); rows: [{ hex, ncex, opts: [[r, n, v?]] }]
  constructor(atoms, rows, meta = {}) {
    const n = atoms.length;
    this.atoms = atoms; this.n = n; this.meta = meta;
    this.key = meta.key || ''; this.link = meta.link || '';
    const sp = Space.fromHex(rows.map((r) => r.hex), n);
    this.space = sp;
    this.count = sp.count; this.W = sp.W; this.words = sp.words; this.hex = sp.hex; this.index = sp.index;
    const C = this.count, W = this.W;
    this.sol = new Uint8Array(C);
    this.ncex = new Int32Array(C);
    this.optStart = new Int32Array(C + 1);
    let nopt = 0;
    for (const r of rows) nopt += r.opts.length;
    // block-only loops: the option of every bad candidate is the whole interface
    const blockOnly = !!meta.blockOnly;
    if (blockOnly) nopt = rows.filter((r) => r.ncex > 0).length;
    this.nopt = nopt;
    this.optR = new Uint32Array(nopt * W); this.optV = new Uint32Array(nopt * W);
    this.optN = new Int32Array(nopt); this.optKind = new Uint8Array(nopt);
    const full = new Uint32Array(W);
    for (let j = 0; j < n; j++) full[j >> 5] |= 1 << (j & 31);
    this.full = full;
    let o = 0;
    rows.forEach((r, i) => {
      this.optStart[i] = o;
      this.ncex[i] = r.ncex;
      if (r.ncex === 0) this.sol[i] = 1;
      if (blockOnly) {
        if (r.ncex > 0) {
          this.optR.set(full, o * W);
          this.optV.set(this.words.subarray(i * W, i * W + W), o * W);
          this.optN[o] = r.ncex; this.optKind[o] = 2; o++;
        }
        return;
      }
      for (const op of r.opts) {
        const rw = hexWords(op[0], n, W);
        this.optR.set(rw, o * W);
        if (op.length > 2) {
          this.optV.set(hexWords(op[2], n, W), o * W);
          this.optKind[o] = 1;
        } else {
          for (let k = 0; k < W; k++) this.optV[o * W + k] = this.words[i * W + k] & rw[k];
        }
        this.optN[o] = op[1];
        o++;
      }
    });
    this.optStart[C] = o;
    // per-atom bitsets over candidates
    const CW = Math.max(1, Math.ceil(C / 32));
    this.CW = CW;
    this.bitsT = new Uint32Array(n * CW);
    for (let i = 0; i < C; i++) {
      for (let j = 0; j < n; j++) if ((this.words[i * W + (j >> 5)] >>> (j & 31)) & 1) this.bitsT[j * CW + (i >> 5)] |= 1 << (i & 31);
    }
    this.allBits = new Uint32Array(CW);
    for (let i = 0; i < C; i++) this.allBits[i >> 5] |= 1 << (i & 31);
    this.solBits = new Uint32Array(CW); this.badBits = new Uint32Array(CW);
    const sols = [], bad = [];
    for (let i = 0; i < C; i++) {
      if (this.sol[i]) { this.solBits[i >> 5] |= 1 << (i & 31); sols.push(i); } else { this.badBits[i >> 5] |= 1 << (i & 31); bad.push(i); }
    }
    this.sols = Int32Array.from(sols); this.bad = Int32Array.from(bad);
  }
  candWords(i) { return this.words.subarray(i * this.W, (i + 1) * this.W); }
  optRw(o) { return this.optR.subarray(o * this.W, (o + 1) * this.W); }
  optVw(o) { return this.optV.subarray(o * this.W, (o + 1) * this.W); }
  options(i) { const out = []; for (let o = this.optStart[i]; o < this.optStart[i + 1]; o++) out.push(o); return out; }
  ownerOf(o) { let lo = 0, hi = this.count - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.optStart[m] <= o) lo = m; else hi = m - 1; } return lo; }
  atomsOf(words, names = true) { const out = []; for (let j = 0; j < this.n; j++) if ((words[j >> 5] >>> (j & 31)) & 1) out.push(names ? this.atoms[j] : j + 1); return out; }
  indexOf(hex) { const i = this.index.get(String(hex || '').replace(/^0+/, '') || '0'); return i === undefined ? -1 : i; }
  summary() {
    let opts = 0;
    for (const i of this.bad) opts += this.optStart[i + 1] - this.optStart[i];
    return { candidates: this.count, solutions: this.sols.length, bad: this.bad.length, atoms: this.n, options: opts,
      counterexamples: this.ncex.reduce((a, b) => a + b, 0) };
  }
  // a plain object that survives structuredClone and JSON (typed arrays as arrays in JSON)
  toJSON() {
    return { format: 'cegarplay-lab-space', version: 1, key: this.key, link: this.link, atoms: this.atoms, meta: this.meta,
      candidates: this.hex.map((h, i) => {
        const opts = [];
        for (let o = this.optStart[i]; o < this.optStart[i + 1]; o++) {
          const e = [wordsHex(this.optRw(o), this.n), this.optN[o]];
          if (this.optKind[o] === 1) e.push(wordsHex(this.optVw(o), this.n));
          opts.push(e);
        }
        return { hex: h, ncex: this.ncex[i], opts };
      }) };
  }
  static fromJSON(j) {
    return new LabSpace(j.atoms, j.candidates.map((c) => ({ hex: c.hex, ncex: c.ncex, opts: c.opts })), j.meta || {});
  }
}

// Y data -> LabSpace, or { limit } / { error }.
export function parseSpace(linesOrEvents, meta = {}) {
  const ys = yData(linesOrEvents);
  const lim = ys.find((y) => y.t === 'limit');
  if (lim) return { limit: lim.limit };
  const end = ys.find((y) => y.t === 'end');
  if (!end) return { error: 'the enumeration did not finish' };
  const rows = [];
  for (const y of ys) if (y.t === 'c') for (const c of y.c) rows.push({ hex: c[0], ncex: c[1], opts: c[2] });
  return new LabSpace(end.atoms, rows, { ...meta, enumerated: end });
}
