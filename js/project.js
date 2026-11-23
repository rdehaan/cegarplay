// Project model, load/save, import of cegar.py files, standalone export. No DOM, no Node APIs.
import { compile } from './compiler.js';
import { assemble, DEFAULT_SETTINGS, stripAspComments, modulesFor } from './driver.js';

export const FORMAT = 'cegarplay';
export const VERSION = 2;
// Keys of format version 2 (docs/spec-instances.md). A project that uses none saves as version 1.
export const V2_KEYS = ['instances', 'generators', 'variants', 'suites', 'views', 'pools'];
export const INSTANCE_ID = /^[A-Za-z0-9_-]+$/;
// The fragment a run gets from its instance; no user fragment may have this name.
export const INSTANCE_FRAGMENT = 'instance';
export const DEFAULT_FRAGMENTS = ['shared', 'abstraction', 'glue', 'check'];
export const FRAGMENT_NAME = /^[a-z][a-z0-9_]*$/;

const DECL = (legacy = '') => `solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue${legacy}
`;

export const TEMPLATES = {
  shape1: {
    label: 'Shape 1: check inside the search',
    text: (l) => DECL(l) + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
`,
  },
  shape2: {
    label: 'Shape 2: solve, check, refine, solve again',
    text: (l) => DECL(l) + `
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
`,
  },
  shape3: {
    label: 'Shape 3: ground rules per counterexample',
    text: (l) => DECL(l) + `
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.expand(refine, cex = X.atoms(color/2))
    else:
        accept M
        A.add(G.block(M))
`,
  },
  shape4: {
    label: 'Shape 4: search, collect, ground in batches',
    text: (l) => DECL(l) + `
pending = []
repeat:
    search A:
        on candidate M:
            X = C.solve(assume G(M))
            if X:
                pending.push(X)
                reject M with G.block(M)
                if pending.size >= 20: restart
    grounded = pending.size
    for X in pending:
        A.expand(refine, cex = X.atoms(color/2))
    pending.clear()
until A.exhausted and grounded == 0
`,
  },
  reference: {
    label: 'Reference run (block only)',
    text: (l) => DECL(l) + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.block(M)
`,
  },
};
export const template = (key, { legacy = false } = {}) => TEMPLATES[key].text(legacy ? ' legacy' : '');

export function newProject(title = 'Untitled') {
  return {
    format: FORMAT,
    version: 1,
    title,
    description: '',
    fragments: DEFAULT_FRAGMENTS.map((name) => ({ name, text: '' })),
    loop: { language: 'loop', text: template('shape1') },
    settings: { ...DEFAULT_SETTINGS, constants: {} },
    runs: [],
  };
}

// A small project that runs as it is, with comments that say what goes where.
export const STARTER = {
  shared: `% Rules every solver needs: domains, constants, common definitions.
item(1..n).
`,
  abstraction: `% Proposes candidates. Every solution must be a candidate; the check removes the rest.
% Here: any non-empty set of items.
1 { pick(I) : item(I) }.
#show pick/1.
`,
  glue: `% The atoms the abstraction and the check share: glue(T) makes T an interface atom.
glue(pick(I)) :- item(I).
`,
  check: `% Looks for a counterexample to the candidate; the interface atoms (pick/1) are fixed.
% Here: a candidate is wrong if it picks an item but not a smaller one.
{ gap(I,J) : item(I), item(J), I < J } = 1.
:- gap(I,J), pick(I).
:- gap(I,J), not pick(J).
% relevant(T): the interface atoms the counterexample depends on. The refinement says
% that one of them must change.
relevant(pick(I)) :- gap(I,J).
relevant(pick(J)) :- gap(I,J).
`,
};

export function starterProject() {
  const p = newProject('New project');
  p.description = 'A small starting point: sets of items that contain every item below a picked one (n solutions). Replace the fragments with your own problem.';
  for (const f of p.fragments) f.text = STARTER[f.name] || '';
  p.settings.constants = { n: '4' };
  p.settings.solutions = 0;
  return p;
}

export class ProjectError extends Error {}

// Validate and fill defaults. Unknown keys are kept.
export function load(json) {
  let p = json;
  if (typeof json === 'string') {
    try { p = JSON.parse(json); } catch (e) { throw new ProjectError(`not a JSON file: ${e.message}`); }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ProjectError('not a CegarPlay project: expected a JSON object');
  if (p.format !== FORMAT) {
    if (!('format' in p) && ['aux_program', 'level_gen_program', 'goal_program', 'level_state', 'level_settings'].some((k) => k in p)) {
      throw new ProjectError('this is a logic-game file, not a CegarPlay project');
    }
    throw new ProjectError(`not a CegarPlay project (format is ${JSON.stringify(p.format)}, expected "${FORMAT}")`);
  }
  if (typeof p.version === 'number' && p.version > VERSION) throw new ProjectError(`project version ${p.version} is newer than this CegarPlay (${VERSION})`);
  const out = { ...p };
  out.version = VERSION;
  out.title = typeof p.title === 'string' ? p.title : 'Untitled';
  out.description = typeof p.description === 'string' ? p.description : '';
  // readme (FUTURE-DIRECTIONS E1): Markdown for a project kit, shown in the Control tab
  if ('readme' in p) {
    if (typeof p.readme !== 'string') throw new ProjectError('readme must be a string (Markdown)');
    if (!p.readme.trim()) delete out.readme;
  }
  if (!Array.isArray(p.fragments)) throw new ProjectError('fragments must be a list');
  const names = new Set();
  out.fragments = p.fragments.map((f, i) => {
    if (!f || typeof f !== 'object') throw new ProjectError(`fragment ${i + 1} is not an object`);
    if (typeof f.name !== 'string' || !FRAGMENT_NAME.test(f.name)) throw new ProjectError(`fragment ${i + 1}: invalid name ${JSON.stringify(f.name)} (use lower case letters, digits and _)`);
    if (names.has(f.name)) throw new ProjectError(`duplicate fragment name '${f.name}'`);

    names.add(f.name);
    return { ...f, text: typeof f.text === 'string' ? f.text : '' };
  });
  let loop = p.loop && typeof p.loop === 'object' ? p.loop : {};
  // The name "instance" is reserved for the facts of an instance. A fragment of an older project
  // with that name is renamed, and so are its uses in the declarations of a loop script.
  if (names.has(INSTANCE_FRAGMENT)) {
    let alt = 'instance_facts';
    for (let i = 2; names.has(alt); i++) alt = `instance_facts${i}`;
    out.fragments = out.fragments.map((f) => (f.name === INSTANCE_FRAGMENT ? { ...f, name: alt } : f));
    names.delete(INSTANCE_FRAGMENT); names.add(alt);
    if (typeof loop.text === 'string' && loop.language !== 'lua') {
      loop = { ...loop, text: loop.text.replace(/^(\s*(?:solver|link)\b.*)$/gm, (l) => l.replace(/\binstance\b/g, alt)) };
    }
  }
  const language = loop.language === 'lua' ? 'lua' : 'loop';
  if (loop.language !== undefined && loop.language !== 'lua' && loop.language !== 'loop') throw new ProjectError(`loop.language must be "loop" or "lua"`);
  out.loop = { ...loop, language, text: typeof loop.text === 'string' ? loop.text : template('shape1') };
  const st = p.settings && typeof p.settings === 'object' ? p.settings : {};
  out.settings = { ...DEFAULT_SETTINGS, ...st };
  const consts = st.constants && typeof st.constants === 'object' && !Array.isArray(st.constants) ? st.constants : {};
  out.settings.constants = Object.fromEntries(Object.entries(consts).map(([k, v]) => [k, String(v)]));
  for (const k of ['solutions', 'seconds', 'candidates', 'trace', 'seed']) {
    const v = Number(out.settings[k]);
    out.settings[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_SETTINGS[k];
  }
  out.runs = Array.isArray(p.runs) ? p.runs : [];
  if ('instances' in p) out.instances = loadInstances(p.instances);
  if ('variants' in p) out.variants = loadVariants(p.variants, names);
  if ('generators' in p) out.generators = loadGenerators(p.generators);
  if ('pools' in p) {
    if (!Array.isArray(p.pools)) throw new ProjectError('pools must be a list');
    const seen = new Set();
    out.pools = p.pools.map((x, i) => {
      if (!isObj(x) || typeof x.name !== 'string' || !/^[a-z][A-Za-z0-9_]*$/.test(x.name)) throw new ProjectError(`pool ${i + 1}: name must start with a lower case letter`);
      if (seen.has(x.name)) throw new ProjectError(`duplicate pool name '${x.name}'`);
      seen.add(x.name);
      if (!Array.isArray(x.items) || !x.items.every((it) => Array.isArray(it) && it.every((a) => typeof a === 'string'))) throw new ProjectError(`pool ${x.name}: items must be lists of atom texts`);
      return { ...x, domain: typeof x.domain === 'string' ? x.domain : '' };
    });
  }
  if ('views' in p) {
    if (!Array.isArray(p.views)) throw new ProjectError('views must be a list');
    const seen = new Set();
    out.views = p.views.map((v, i) => {
      if (!isObj(v) || typeof v.name !== 'string' || !INSTANCE_ID.test(v.name)) throw new ProjectError(`view ${i + 1}: name must match [A-Za-z0-9_-]+`);
      if (seen.has(v.name)) throw new ProjectError(`duplicate view name '${v.name}'`);
      seen.add(v.name);
      if (!Array.isArray(v.fragments) || !v.fragments.every((f) => typeof f === 'string')) throw new ProjectError(`view ${v.name}: fragments must be a list of fragment names`);
      for (const f of v.fragments) if (!names.has(f)) throw new ProjectError(`view ${v.name}: no fragment named ${f}`);
      if (v.positions !== undefined && !isObj(v.positions)) throw new ProjectError(`view ${v.name}: positions must be an object`);
      return { ...v };
    });
  }
  if ('suites' in p) {
    if (!Array.isArray(p.suites)) throw new ProjectError('suites must be a list');
    const seen = new Set();
    out.suites = p.suites.map((x, i) => {
      if (!isObj(x) || typeof x.name !== 'string' || !INSTANCE_ID.test(x.name)) throw new ProjectError(`suite ${i + 1}: name must match [A-Za-z0-9_-]+`);
      if (seen.has(x.name)) throw new ProjectError(`duplicate suite name '${x.name}'`);
      seen.add(x.name);
      return { ...x };
    });
  }
  if ('exercise' in p) out.exercise = loadExercise(p.exercise, out.instances || []);
  if ('instance' in st && st.instance !== null && st.instance !== '' && typeof st.instance !== 'string') throw new ProjectError('settings.instance must be an instance id or ""');
  if ('variant' in st && st.variant !== null && typeof st.variant !== 'string') throw new ProjectError('settings.variant must be a variant name or ""');
  out.version = usesV2(out) ? 2 : 1;
  return out;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const strMap = (x, what) => {
  if (x === undefined) return {};
  if (!isObj(x)) throw new ProjectError(`${what} must be an object`);
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v)]));
};

function loadInstances(list) {
  if (!Array.isArray(list)) throw new ProjectError('instances must be a list');
  const ids = new Set();
  return list.map((x, i) => {
    const where = `instance ${i + 1}`;
    if (!isObj(x)) throw new ProjectError(`${where} is not an object`);
    if (typeof x.id !== 'string' || !INSTANCE_ID.test(x.id)) throw new ProjectError(`${where}: id must match [A-Za-z0-9_-]+`);
    if (ids.has(x.id)) throw new ProjectError(`duplicate instance id '${x.id}'`);
    ids.add(x.id);
    const out = { ...x, id: x.id, facts: typeof x.facts === 'string' ? x.facts : x.recipe ? undefined : '' };
    if (out.facts === undefined) delete out.facts;
    if (x.facts !== undefined && typeof x.facts !== 'string') throw new ProjectError(`instance ${x.id}: facts must be a string`);
    out.constants = strMap(x.constants, `instance ${x.id}: constants`);
    if (x.expected !== undefined) {
      if (!isObj(x.expected)) throw new ProjectError(`instance ${x.id}: expected must be an object`);
      const n = x.expected.solutions;
      if (!(n === null || n === undefined || (Number.isInteger(n) && n >= 0))) throw new ProjectError(`instance ${x.id}: expected.solutions must be a whole number or null`);
      const o = x.expected.optimum;
      if (!(o === null || o === undefined || Number.isInteger(o) || (Array.isArray(o) && o.length > 0 && o.every(Number.isInteger)))) {
        throw new ProjectError(`instance ${x.id}: expected.optimum must be a whole number, a list of whole numbers (one per priority level) or null`);
      }
    }
    if (x.tags !== undefined && !(Array.isArray(x.tags) && x.tags.every((t) => typeof t === 'string'))) throw new ProjectError(`instance ${x.id}: tags must be a list of strings`);
    out.tags = x.tags || [];
    if (x.recipe !== undefined && !isObj(x.recipe)) throw new ProjectError(`instance ${x.id}: recipe must be an object`);
    return out;
  });
}

export const GENERATOR_PARAM_TYPES = ['int', 'permille'];
function loadGenerators(list) {
  if (!Array.isArray(list)) throw new ProjectError('generators must be a list');
  const seen = new Set();
  return list.map((g, i) => {
    if (!isObj(g)) throw new ProjectError(`generator ${i + 1} is not an object`);
    if (typeof g.name !== 'string' || !INSTANCE_ID.test(g.name)) throw new ProjectError(`generator ${i + 1}: name must match [A-Za-z0-9_-]+`);
    if (seen.has(g.name)) throw new ProjectError(`duplicate generator name '${g.name}'`);
    seen.add(g.name);
    if (typeof g.text !== 'string') throw new ProjectError(`generator ${g.name}: text must be a string`);
    const params = g.params === undefined ? {} : g.params;
    if (!isObj(params)) throw new ProjectError(`generator ${g.name}: params must be an object`);
    for (const [k, t] of Object.entries(params)) {
      if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) throw new ProjectError(`generator ${g.name}: parameter name '${k}' must start with a lower case letter`);
      if (!GENERATOR_PARAM_TYPES.includes(t)) throw new ProjectError(`generator ${g.name}: parameter ${k} has type '${t}' (use int or permille)`);
    }
    if (g.defaults !== undefined && !isObj(g.defaults)) throw new ProjectError(`generator ${g.name}: defaults must be an object`);
    return { ...g, params };
  });
}

function loadVariants(list, fragmentNames) {
  if (!Array.isArray(list)) throw new ProjectError('variants must be a list');
  const seen = new Set();
  return list.map((v, i) => {
    if (!isObj(v)) throw new ProjectError(`variant ${i + 1} is not an object`);
    if (typeof v.name !== 'string' || !INSTANCE_ID.test(v.name)) throw new ProjectError(`variant ${i + 1}: name must match [A-Za-z0-9_-]+`);
    if (seen.has(v.name) || v.name === 'default') throw new ProjectError(`variant name '${v.name}' is used twice or reserved`);
    seen.add(v.name);
    const out = { ...v };
    if (v.loop !== undefined) {
      if (typeof v.loop === 'string') out.loop = { language: 'loop', text: v.loop };
      else if (isObj(v.loop) && typeof v.loop.text === 'string') out.loop = { language: v.loop.language === 'lua' ? 'lua' : 'loop', text: v.loop.text };
      else throw new ProjectError(`variant ${v.name}: loop must be a string or { language, text }`);
    }
    out.swap = strMap(v.swap, `variant ${v.name}: swap`);
    for (const [a, b] of Object.entries(out.swap)) {
      if (!fragmentNames.has(a) || !fragmentNames.has(b)) throw new ProjectError(`variant ${v.name}: swap names an unknown fragment (${a} -> ${b})`);
    }
    out.constants = strMap(v.constants, `variant ${v.name}: constants`);
    if (v.settings !== undefined && !isObj(v.settings)) throw new ProjectError(`variant ${v.name}: settings must be an object`);
    if (v.note !== undefined && typeof v.note !== 'string') throw new ProjectError(`variant ${v.name}: note must be a string`);
    return out;
  });
}

// Whether a project needs format version 2 (a key of V2_KEYS that is not empty).
export function usesV2(project) {
  return V2_KEYS.some((k) => Array.isArray(project[k]) && project[k].length > 0) ||
    !!(project.settings && project.settings.instance);
}

export function save(project, { runs = true } = {}) {
  const p = { ...project };
  if (!runs) p.runs = [];
  p.version = usesV2(project) ? 2 : 1;
  for (const k of V2_KEYS) if (Array.isArray(p[k]) && p[k].length === 0) delete p[k];
  if (p.settings && 'instance' in p.settings && !usesV2(project)) { p.settings = { ...p.settings }; delete p.settings.instance; }
  if (p.settings && 'variant' in p.settings && !(project.variants || []).length) { p.settings = { ...p.settings }; delete p.settings.variant; }
  return JSON.stringify(p, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Derived projects: a variant and an instance applied (implementation.md, groundwork 1).
// Both return a new plain project; the stored one is not touched.
// ---------------------------------------------------------------------------

export function applyVariant(project, name) {
  if (!name || name === 'default') return project;
  const v = (project.variants || []).find((x) => x.name === name);
  if (!v) throw new ProjectError(`no variant named '${name}'`);
  const p = structuredClone(project);
  const text = Object.fromEntries(project.fragments.map((f) => [f.name, f.text]));
  for (const [a, b] of Object.entries(v.swap || {})) {
    const f = p.fragments.find((x) => x.name === a);
    if (f) f.text = text[b];
  }
  if (v.loop) p.loop = { ...p.loop, ...v.loop };
  p.settings = { ...p.settings, ...(v.settings || {}), constants: { ...p.settings.constants, ...(v.constants || {}) } };
  p.variant = name;
  return p;
}

// The instance a run uses: the id given, else settings.instance, else the first instance.
// settings.instance = "" means "the project as written" (only for constants-only instances).
export function selectedInstance(project, id) {
  const list = project.instances || [];
  if (!list.length) {
    if (id) throw new ProjectError(`no instance named '${id}' (the project has no instances)`);
    return null;
  }
  const want = id !== undefined && id !== null ? id : project.settings && project.settings.instance;
  if (want === '') return null;
  if (want === undefined || want === null) return list[0];
  const x = list.find((i) => i.id === want);
  if (x) return x;
  // an id given explicitly must exist; a stale settings.instance falls back to the first
  if (id !== undefined && id !== null) throw new ProjectError(`no instance named '${want}'`);
  return list[0];
}

export function applyInstance(project, id) {
  const x = typeof id === 'object' && id ? id : selectedInstance(project, id);
  if (!x) return project;
  if (x.facts === undefined && x.recipe) throw new ProjectError(`instance ${x.id}: its facts are not generated yet`);
  const p = structuredClone(project);
  p.fragments = [{ name: INSTANCE_FRAGMENT, text: x.facts || '' }, ...p.fragments.filter((f) => f.name !== INSTANCE_FRAGMENT)];
  p.settings = { ...p.settings, constants: { ...p.settings.constants, ...(x.constants || {}) } };
  p.instance = x.id;
  return p;
}

// The variant the run bar picked (settings.variant), if it names a variant; else undefined.
export function pickedVariant(project) {
  const v = project.settings && project.settings.variant;
  return v && (project.variants || []).some((x) => x.name === v) ? v : undefined;
}

// The plain project of one run: variant first, then instance.
export function derive(project, { instance, variant } = {}) {
  return applyInstance(applyVariant(project, variant), instance);
}

// ---------------------------------------------------------------------------
// ASP text scanning (comments and strings)
// ---------------------------------------------------------------------------

// Calls visit(i) for every index in normal text (not in a comment or string); visit may return
// a number of characters to skip.
function scanCode(text, visit) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '%') {
      if (text[i + 1] === '*') {
        const e = text.indexOf('*%', i + 2);
        i = e < 0 ? n : e + 2;
      } else {
        const e = text.indexOf('\n', i);
        i = e < 0 ? n : e;
      }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    const skip = visit(i);
    i += skip || 1;
  }
}

export { stripAspComments as stripComments };
const stripComments = stripAspComments;

// All #program directives outside comments and strings: [{ index, end, name, params }]
export function programDirectives(text) {
  const out = [];
  const re = /#program\s+([a-z_][A-Za-z0-9_']*)\s*(\(([^)]*)\))?\s*\./y;
  scanCode(text, (i) => {
    if (text[i] !== '#') return 1;
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return 1;
    out.push({ index: i, end: re.lastIndex, name: m[1], params: m[3] !== undefined ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [] });
    return m[0].length;
  });
  return out;
}

const SPLIT = { shared: 'shared', guess: 'abstraction', base: 'abstraction', glue: 'glue', check: 'check' };

export function splitLp(text) {
  const parts = { shared: [], abstraction: [], glue: [], check: [] };
  let cur = 'abstraction', last = 0;
  for (const d of programDirectives(text)) {
    if (d.params.length || !(d.name in SPLIT)) continue;      // e.g. #program refine(k). stays in place
    parts[cur].push(text.slice(last, d.index));
    cur = SPLIT[d.name];
    last = d.end;
  }
  parts[cur].push(text.slice(last));
  const out = {};
  for (const [k, v] of Object.entries(parts)) out[k] = v.join('\n').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
  for (const k of Object.keys(out)) if (out[k] === '\n') out[k] = '';
  return out;
}

export function usesGlueAtoms(text) { return /\bglue\s*\(/.test(stripComments(text)); }

export function importLp(text, title = 'Imported') {
  const parts = splitLp(text);
  const p = newProject(title);
  p.fragments = DEFAULT_FRAGMENTS.map((name) => ({ name, text: parts[name] }));
  const legacy = parts.glue.trim() !== '' && !usesGlueAtoms(parts.glue);
  p.loop = { language: 'loop', text: template('shape1', { legacy }) };
  return p;
}

// modules: { ground, ... } the Lua module texts (lua/<name>.lua) a project may need (lift, certify).
export function exportStandalone(project, runtimeLua, modules = {}) {
  project = derive(project, { variant: pickedVariant(project) });   // the run bar's instance and variant
  let compiled = null;
  if (project.loop.language === 'loop') {
    const c = compile(project.loop.text, { fragments: project.fragments.map((f) => f.name) });
    if (!c.ok) throw new ProjectError('the loop script has errors: ' + c.errors.map((e) => `line ${e.line}: ${e.message}`).join('; '));
    compiled = c;
  }
  const need = modulesFor(project.settings, { compiled, loop: project.loop });
  for (const m of need) if (!modules[m]) throw new ProjectError(`the export needs lua/${m}.lua`);
  const { program } = assemble(project, compiled, runtimeLua, { plain: true, modules: need.map((m) => modules[m]) });
  const header = [
    `% ${project.title || 'CegarPlay project'}: standalone program exported from CegarPlay.`,
    '%',
    '% Run it with:  clingo file.lp --outf=3',
    '%',
    '% clingo must be built with Lua. The PyPI clingo package is not; the Ubuntu',
    '% gringo package and conda-forge builds are (check: clingo --version says "with Lua").',
    '% Settings and constants are fixed in the SETTINGS and CONSTS lines below.',
    '',
  ].join('\n');
  return header + program;
}

// ---------------------------------------------------------------------------------------------
// Expected results of an instance (manual, "Instances"): expected.solutions, the solution count
// of an exhausted run; expected.optimum, the cost of every reported solution of a finished run
// (an optimisation loop that stops at its optimum need not be exhausted). A cost is clingo's
// list, one number per priority level; a single number means a one-level cost.
export const costList = (c) => (c === null || c === undefined ? null : Array.isArray(c) ? c.map(Number) : [Number(c)]);
const sameCost = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const sameOrNone = (a, b) => (a === null && b === null) || sameCost(a, b);
export const costText = (c) => { const l = costList(c); return l ? l.join(' ') : '–'; };

// A running summary of the costs of a run's solutions: add(cost) per M event.
export function costTracker() {
  return { cost: null, same: true, n: 0, add(c) { const l = costList(c); if (this.n === 0) this.cost = l; else if (!sameOrNone(this.cost, l)) this.same = false; this.n++; } };
}

// r = { outcome, exhausted, solutions, cost, same } (cost and same from a costTracker).
// Returns { checked, ok, want } : checked when some expectation applies to this run.
export function expectedCheck(expected, r) {
  if (!expected || !r) return { checked: false, ok: null, want: '' };
  const sol = Number.isInteger(expected.solutions) ? expected.solutions : null;
  const opt = expected.optimum === null || expected.optimum === undefined ? null : costList(expected.optimum);
  const want = [sol !== null ? `${sol} solutions` : null, opt ? `optimum ${opt.join(' ')}` : null].filter(Boolean).join(', ');
  const finished = r.outcome === 'finished';
  const solChecked = sol !== null && finished && r.exhausted === true;
  const optChecked = opt !== null && finished;
  const solOk = r.solutions === sol;
  const optOk = r.solutions > 0 && r.same !== false && sameCost(costList(r.cost), opt);
  const checked = solChecked || optChecked;
  return { checked, ok: checked ? (!solChecked || solOk) && (!optChecked || optOk) : null, want };
}

// The status line of Run all: rows = [{ expected, result }] in run order. It never says that
// everything matches when nothing was checked; it names why instances went unchecked.
export function runAllSummary(rows) {
  let bad = 0, checked = 0, noExpect = 0, unfinished = 0, notExhausted = 0;
  for (const { expected, result } of rows) {
    const v = expectedCheck(expected, result);
    if (v.checked) { checked++; if (!v.ok) bad++; continue; }
    if (!v.want) noExpect++;
    else if (!result || result.outcome !== 'finished') unfinished++;
    else notExhausted++;
  }
  const n = rows.length;
  const why = [
    noExpect ? `${noExpect} without an expected count or optimum` : null,
    unfinished ? `${unfinished} not finished (error, stop or time limit)` : null,
    notExhausted ? `${notExhausted} stopped before all solutions were found` : null,
  ].filter(Boolean);
  const head = `Ran ${n} instance${n === 1 ? '' : 's'}; ${checked} of ${n} checked`;
  const tail = why.length ? `; not checked: ${why.join(', ')}.` : '.';
  const text = checked === 0 ? `${head}: nothing to compare${tail}`
    : bad ? `${head}: ${bad} with a count or optimum other than expected (marked ✗)${tail}`
    : `${head}, all match${tail}`;
  return { text, n, checked, bad, noExpect, unfinished, notExhausted };
}

// ---------------------------------------------------------------------------------------------
// Self-checking exercises (FUTURE-DIRECTIONS F1). A project's exercise block:
//   { text, instances: [ids] | "all", audit: true | [ids], budgets: [{ instance, candidates, refinements }] }
// instances: whose expected count or optimum must match (default "all": every instance with an
// expectation); audit: the instances whose audit must say "sound" (true = the same instances);
// budgets: at most this many candidates (or refinements) on that instance, which forces a
// refinement stronger than blocking. The page's Check button and tools/grade.mjs use
// exerciseItems and gradeItem; neither ever reports a pass for an item it could not check.
export function loadExercise(x, instances) {
  if (!isObj(x)) throw new ProjectError('exercise must be an object');
  const ids = new Set(instances.map((i) => i.id));
  const known = (id, what) => { if (!ids.has(id)) throw new ProjectError(`exercise: ${what} names no instance '${id}'`); return id; };
  const out = { ...x };
  if (x.text !== undefined && typeof x.text !== 'string') throw new ProjectError('exercise.text must be a string');
  if (x.instances !== undefined && x.instances !== 'all') {
    if (!Array.isArray(x.instances)) throw new ProjectError('exercise.instances must be a list of instance ids or "all"');
    x.instances.forEach((id) => known(id, 'instances'));
  }
  if (x.audit !== undefined && typeof x.audit !== 'boolean') {
    if (!Array.isArray(x.audit)) throw new ProjectError('exercise.audit must be true, false or a list of instance ids');
    x.audit.forEach((id) => known(id, 'audit'));
  }
  if (x.budgets !== undefined) {
    if (!Array.isArray(x.budgets)) throw new ProjectError('exercise.budgets must be a list');
    x.budgets.forEach((b, i) => {
      if (!isObj(b)) throw new ProjectError(`exercise.budgets[${i + 1}] must be an object`);
      known(b.instance, `budgets[${i + 1}]`);
      for (const k of ['candidates', 'refinements']) {
        if (b[k] !== undefined && !(Number.isInteger(b[k]) && b[k] >= 0)) throw new ProjectError(`exercise.budgets[${i + 1}].${k} must be a whole number`);
      }
      if (b.candidates === undefined && b.refinements === undefined) throw new ProjectError(`exercise.budgets[${i + 1}]: give candidates or refinements`);
    });
  }
  return out;
}

// The items to check, in order: [{ kind: 'expected' | 'audit' | 'budget', instance, key, max, label }].
export function exerciseItems(project) {
  const x = project.exercise;
  if (!x) return [];
  const list = project.instances || [];
  const hasExp = (i) => i.expected && (Number.isInteger(i.expected.solutions) || (i.expected.optimum !== null && i.expected.optimum !== undefined));
  const ids = x.instances === undefined || x.instances === 'all' ? list.filter(hasExp).map((i) => i.id) : x.instances;
  const items = ids.map((id) => ({ kind: 'expected', instance: id, label: `${id}: ${expectedCheck(list.find((i) => i.id === id).expected, { outcome: 'x' }).want || 'no expectation'}` }));
  const aud = x.audit === true ? ids : Array.isArray(x.audit) ? x.audit : [];
  for (const id of aud) items.push({ kind: 'audit', instance: id, label: `${id}: the audit finds no unsound refinement` });
  for (const b of x.budgets || []) {
    for (const key of ['candidates', 'refinements']) {
      if (b[key] !== undefined) items.push({ kind: 'budget', instance: b.instance, key, max: b[key], label: `${b.instance}: at most ${b[key]} ${key}` });
    }
  }
  return items;
}

// result: for 'expected' and 'budget' a run { outcome, exhausted, solutions, cost, same, candidates,
// refinements } (all solutions), for 'audit' { verdict } (or null when the run failed).
// Returns { ok: true | false, detail }; ok is false whenever the item could not be checked.
export function gradeItem(item, instance, result) {
  if (!result) return { ok: false, detail: 'not checked: the run did not start' };
  if (item.kind === 'audit') {
    if (result.verdict === 'sound') return { ok: true, detail: 'sound' };
    if (result.verdict === 'unsound') return { ok: false, detail: `unsound: ${result.unsound} refinements would remove a solution` };
    return { ok: false, detail: `not checked: the audit ended without a verdict (${result.verdict || result.outcome || 'error'})` };
  }
  if (result.outcome !== 'finished') return { ok: false, detail: `not checked: the run ended with ${result.outcome || 'an error'}` };
  if (item.kind === 'expected') {
    const v = expectedCheck(instance && instance.expected, result);
    if (!v.checked) return { ok: false, detail: `not checked: ${v.want ? 'the run stopped before all solutions were found' : 'the instance has no expectation'}` };
    return v.ok ? { ok: true, detail: `${result.solutions} solutions${result.cost ? `, cost ${costText(result.cost)}` : ''}` }
      : { ok: false, detail: `got ${result.solutions} solutions${result.cost ? `, cost ${costText(result.cost)}` : ''}; expected ${v.want}` };
  }
  const got = result[item.key];
  if (typeof got !== 'number') return { ok: false, detail: `not checked: no ${item.key} count` };
  return got <= item.max ? { ok: true, detail: `${got} ${item.key}` } : { ok: false, detail: `${got} ${item.key}, more than ${item.max}` };
}

export function exerciseSummary(graded) {
  const n = graded.length, ok = graded.filter((g) => g.ok).length;
  return { n, ok, pass: n > 0 && ok === n, text: n === 0 ? 'Nothing to check.' : ok === n ? `All ${n} checks pass.` : `${ok} of ${n} checks pass.` };
}
