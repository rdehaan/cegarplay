// Generators (docs/spec-instances.md section 4): an ASP program grounded with seeded draw
// functions; its shown atoms are an instance. No DOM, no Node APIs.
//
//   generator: { name, text, params: { n: 'int', p: 'permille' }, defaults: { n: 7, p: 300 } }
//   recipe:    { generator: 'gnp', params: { n: 7, p: 300 }, seed: 1 }
import { luaLongString, parseEvent, validateGenerator } from './driver.js';

export const PARAM_TYPES = ['int', 'permille'];
export const DRAW_FUNCTIONS = ['flip', 'int', 'weighted', 'perm', 'subset', 'mallows'];
const NAME = /^[a-z][A-Za-z0-9_]*$/;

// The parameter values of a recipe as clingo constants ["n=7", ...], with the problems found.
export function paramList(generator, params = {}) {
  const out = [], problems = [];
  const types = generator.params || {};
  for (const [k, type] of Object.entries(types)) {
    let v = params[k];
    if (v === undefined || v === '') v = generator.defaults && generator.defaults[k];
    if (v === undefined || v === '') { problems.push(`parameter ${k} has no value`); continue; }
    const x = Number(v);
    if (!Number.isInteger(x)) { problems.push(`parameter ${k} must be a whole number, got ${v}`); continue; }
    if (type === 'permille' && (x < 0 || x > 1000)) { problems.push(`parameter ${k} is a permille value (0..1000), got ${v}`); continue; }
    out.push(`${k}=${x}`);
  }
  for (const k of Object.keys(params)) if (!(k in types)) problems.push(`unknown parameter ${k}`);
  for (const k of Object.keys(types)) if (!NAME.test(k)) problems.push(`parameter name ${k} must start with a lower case letter`);
  return { list: out, problems };
}

// The constants a generator gives each of its instances ({ name: value } as strings): a value
// that names one of its parameters takes that parameter's value (the recipe's, else the default).
export function generatorConstants(generator, params = {}) {
  const out = {};
  const types = (generator && generator.params) || {};
  for (const [k, v] of Object.entries((generator && generator.constants) || {})) {
    const s = String(v).trim();
    if (s in types) {
      const x = params[s] !== undefined && params[s] !== '' ? params[s] : generator.defaults && generator.defaults[s];
      if (x !== undefined && x !== '') out[k] = String(x);
    } else if (s) out[k] = s;
  }
  return out;
}

// The program of one generator run (the Lua texts of lua/draw.lua and lua/generate.lua).
export function assembleGenerator(generator, params, seeds, luaTexts, { attempts = 100 } = {}) {
  const { list, problems } = paramList(generator, params);
  if (problems.length) throw new Error(problems.join('; '));
  const s = (Array.isArray(seeds) ? seeds : [seeds]).map((x) => Math.trunc(Number(x)) || 0);
  const strip = (t) => t.replace(/\n?return [A-Za-z_][A-Za-z0-9_]*\s*$/, '');
  const lines = ['#script (lua)'];
  lines.push(strip(luaTexts.draw), strip(luaTexts.generate));
  lines.push('function main(prg)');
  lines.push(`  gen.run{ text = ${luaLongString(generator.text || '')}, params = { ${list.map((c) => JSON.stringify(c)).join(', ')} }, ` +
    `seeds = { ${s.join(', ')} }, attempts = ${Math.max(1, attempts | 0)} }`);
  lines.push('end');
  lines.push('#end.');
  return lines.join('\n') + '\n';
}

// Run a generator for the given seeds. Returns { results: [{ facts, seed, attempt, exact } |
// { error, seed }], problems } where problems are validation problems (then no run happens).
export async function generate(generator, params, seeds, luaTexts, engineRun, opts = {}) {
  const { list, problems: pp } = paramList(generator, params);
  if (pp.length) return { results: [], problems: pp.map((message) => ({ line: 0, col: 0, message })) };
  const problems = await validateGenerator(generator, engineRun, list);
  if (problems.length) return { results: [], problems };
  const r = await engineRun(assembleGenerator(generator, params, seeds, luaTexts, opts), '');
  const results = (r.out || []).map(parseEvent).filter((e) => e && e.kind === 'G').map((e) => e.data);
  if (r.status === 'trap') results.push({ error: 'the engine stopped (trap)' });
  return { results, problems: [] };
}

// One recipe -> { facts, attempt, exact } or throws.
export async function runRecipe(project, recipe, luaTexts, engineRun) {
  const g = (project.generators || []).find((x) => x.name === recipe.generator);
  if (!g) throw new Error(`no generator named ${recipe.generator}`);
  const { results, problems } = await generate(g, recipe.params || {}, [recipe.seed || 0], luaTexts, engineRun, { attempts: recipe.attempts || 100 });
  if (problems.length) throw new Error(`generator ${g.name}: line ${problems[0].line}: ${problems[0].message}`);
  const x = results[0];
  if (!x || x.error) throw new Error(`generator ${g.name}: ${x ? x.error : 'no result'}`);
  return x;
}

// A short content hash (FNV-1a, 32 bits, hex) for caches.
export function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function recipeKey(project, recipe) {
  const g = (project.generators || []).find((x) => x.name === recipe.generator);
  // the parameter values as the run sees them (recipe params over the generator's defaults)
  const values = g ? paramList(g, recipe.params || {}).list : [];
  return hashText(JSON.stringify([g ? g.text : '', values, recipe.params || {}, recipe.seed || 0, recipe.attempts || 100]));
}
