// Recordings: the event stream of one run, kept, saved and replayed (docs/spec-recording.md).
// No DOM, no Node APIs (CompressionStream and Blob exist in browsers and in Node 18+).

export const RECORDING_FORMAT = 'cegarplay-recording';
export const RECORDING_VERSION = 1;
export const REPLAY_PATTERN = /^examples\/replays\/[A-Za-z0-9_-]+\.cprec$/;

// A hex vector (atom 1 = lowest bit of the last digit) -> booleans [1..n] (index 0 unused).
export function hexBits(hex, n) {
  const out = new Array(n + 1).fill(false);
  if (!hex) return out;
  const L = hex.length;
  for (let j = 1; j <= n; j++) {
    const d = parseInt(hex[L - 1 - ((j - 1) >> 2)], 16);
    out[j] = !!((d >> ((j - 1) & 3)) & 1);
  }
  return out;
}

export class Recording {
  constructor(header = {}) {
    this.header = { format: RECORDING_FORMAT, version: RECORDING_VERSION, ...header };
    this.events = [];       // { kind, data } in arrival order
    this.steps = [];        // R
    this.calls = [];        // C
    this.solutions = [];    // M
    this.traces = [];       // T
    this.stats = null;      // last S
    this.done = null;       // D
    this.H = null;
    this.I = null;
    this.audit = null;      // A verdict
  }

  add(kind, data) {
    this.events.push({ kind, data });
    switch (kind) {
      case 'R': this.steps.push(data); break;
      case 'C': this.calls.push(data); break;
      case 'M': this.solutions.push(data); break;
      case 'T': this.traces.push(data); break;
      case 'S': this.stats = data; break;
      case 'D': this.done = data; break;
      case 'H': this.H = data; break;
      case 'I': this.I = data; break;
      case 'A': if (data.verdict) this.audit = data; break;
      default: break;
    }
  }

  link(step) { return this.I && step.l ? this.I.links[step.l - 1] : null; }
  solverName(step) { return this.I && step.s ? this.I.solvers[step.s - 1] : null; }

  // The true interface atoms of the step's candidate, as texts.
  candidateAtoms(step) {
    const L = this.link(step);
    if (!L || !step.c) return [];
    const bits = hexBits(step.c, L.atoms.length);
    return L.atoms.filter((_, j) => bits[j + 1]);
  }

  // The refinement clause as texts: "a" (must be true) or "-a" (must be false).
  clauseLiterals(step) {
    const L = this.link(step);
    if (!L || !step.q) return [];
    return step.q.map((x) => (x > 0 ? '' : '-') + L.atoms[Math.abs(x) - 1]);
  }

  // The first step (clause refinement) that a solution falsifies; solution is a boolean
  // array [1..n] over the step's link, or a set/list of atom texts. Used by I4.
  firstViolated(solution, { link = 1 } = {}) {
    const L = this.I && this.I.links[link - 1];
    if (!L) return null;
    let bits = solution;
    if (!Array.isArray(solution) || typeof solution[1] !== 'boolean') {
      const set = new Set(solution);
      bits = [false, ...L.atoms.map((a) => set.has(a))];
    }
    for (const st of this.steps) {
      if (st.l !== link || !st.q || !(st.k === 'r' || st.k === 'a')) continue;
      // the clause holds when some literal holds
      const holds = st.q.some((x) => (x > 0 ? bits[x] : !bits[-x]));
      if (!holds) return st;
    }
    return null;
  }

  lines() {
    return [JSON.stringify(this.header), ...this.events.map((e) => `@@${e.kind} ${JSON.stringify(e.data)}`)];
  }

  text() { return this.lines().join('\n') + '\n'; }

  async toBlob() {
    const raw = new Blob([this.text()]);
    if (typeof CompressionStream === 'undefined') return raw;
    const stream = raw.stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
  }

  static fromText(text) {
    const lines = String(text).split('\n').filter((l) => l.length);
    let header;
    try { header = JSON.parse(lines[0]); } catch { throw new Error('not a CegarPlay recording (no header line)'); }
    if (!header || header.format !== RECORDING_FORMAT) throw new Error('not a CegarPlay recording');
    if (header.version > RECORDING_VERSION) throw new Error(`recording version ${header.version} is newer than this CegarPlay`);
    const r = new Recording(header);
    for (const l of lines.slice(1)) {
      if (!l.startsWith('@@') || l[3] !== ' ') continue;
      try { r.add(l[2], JSON.parse(l.slice(4))); } catch { /* skip a damaged line */ }
    }
    return r;
  }

  static async fromBlob(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let text;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read compressed recordings');
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else text = new TextDecoder().decode(buf);
    return Recording.fromText(text);
  }
}

// Summary numbers of a recording (for tests and tools).
export function summary(rec) {
  const kinds = {};
  for (const s of rec.steps) kinds[s.k] = (kinds[s.k] || 0) + 1;
  return { steps: rec.steps.length, kinds, calls: rec.calls.length, solutions: rec.solutions.length,
    outcome: rec.done && rec.done.outcome };
}
