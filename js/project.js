// Project model, load/save, import of cegar.py files, exports. No DOM, no Node APIs.
import { compile } from './compiler.js';
import { assemble, DEFAULT_SETTINGS, stripAspComments } from './driver.js';

export const FORMAT = 'cegarplay';
export const VERSION = 1;
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
    version: VERSION,
    title,
    description: '',
    fragments: DEFAULT_FRAGMENTS.map((name) => ({ name, text: '' })),
    loop: { language: 'loop', text: template('shape1') },
    settings: { ...DEFAULT_SETTINGS, constants: {} },
    runs: [],
  };
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
  if (!Array.isArray(p.fragments)) throw new ProjectError('fragments must be a list');
  const names = new Set();
  out.fragments = p.fragments.map((f, i) => {
    if (!f || typeof f !== 'object') throw new ProjectError(`fragment ${i + 1} is not an object`);
    if (typeof f.name !== 'string' || !FRAGMENT_NAME.test(f.name)) throw new ProjectError(`fragment ${i + 1}: invalid name ${JSON.stringify(f.name)} (use lower case letters, digits and _)`);
    if (names.has(f.name)) throw new ProjectError(`duplicate fragment name '${f.name}'`);
    names.add(f.name);
    return { ...f, text: typeof f.text === 'string' ? f.text : '' };
  });
  const loop = p.loop && typeof p.loop === 'object' ? p.loop : {};
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
  return out;
}

export function save(project, { runs = true } = {}) {
  const p = { ...project };
  if (!runs) p.runs = [];
  return JSON.stringify(p, null, 2) + '\n';
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

export function canExportLp(project) {
  const names = project.fragments.map((f) => f.name);
  return names.length === 4 && DEFAULT_FRAGMENTS.every((n) => names.includes(n));
}

export function exportLp(project) {
  if (!canExportLp(project)) throw new ProjectError('export as .lp needs exactly the fragments shared, abstraction, glue and check');
  const get = (n) => project.fragments.find((f) => f.name === n).text;
  const sec = [['shared', 'shared'], ['guess', 'abstraction'], ['glue', 'glue'], ['check', 'check']];
  return sec.map(([h, n]) => `#program ${h}.\n${get(n).replace(/\s+$/, '')}\n`).join('\n');
}

export function exportStandalone(project, runtimeLua) {
  let compiled = null;
  if (project.loop.language === 'loop') {
    const c = compile(project.loop.text, { fragments: project.fragments.map((f) => f.name) });
    if (!c.ok) throw new ProjectError('the loop script has errors: ' + c.errors.map((e) => `line ${e.line}: ${e.message}`).join('; '));
    compiled = c;
  }
  const { program } = assemble(project, compiled, runtimeLua, { plain: true });
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
