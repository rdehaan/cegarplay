// Hard-instance mining (docs/spec-instances.md section 7): search seeds and parameters of a
// generator for instances that maximise a cost, then mutate single facts. No DOM, no Node APIs.
//
//   mine(project, { source, objective, budget, env, keep }) -> { best: [...], cells, runs }
//
// source: a generator grid { generator, grid, seeds }; objective: 'candidates-per-solution',
// 'clauses', 'time', or { ratio: metric, of: variantA, over: variantB }.
import { fuzzInstances, countOf } from './fuzz.js';
import { derive } from './project.js';
import { resolveProject } from './instances.js';
import { normaliseFacts } from './shrink.js';

export const OBJECTIVES = ['candidates-per-solution', 'clauses', 'time'];

export function score(res, objective) {
  if (!res || res.error) return -Infinity;
  if (objective === 'clauses') return res.refinements;
  if (objective === 'time') return res.time;
  return res.candidates / Math.max(1, res.solutions);
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const cellOf = (params) => JSON.stringify(Object.entries(params || {}).sort());

async function plain(project, x, env, variant, seconds) {
  let p = { ...project, instances: [x.instance, ...(project.instances || []).filter((i) => i.id !== x.instance.id)] };
  if (env.luaTexts) p = await resolveProject(p, x.instance.id, env.engineRun, env.luaTexts);
  const d = derive(p, { instance: x.instance.id, variant });
  d.settings = { ...d.settings, seconds, candidates: 0 };
  return d;
}

async function evaluate(project, x, env, objective, seconds) {
  if (objective && typeof objective === 'object' && objective.ratio) {
    const a = await countOf(await plain(project, x, env, objective.of, seconds), env);
    const b = await countOf(await plain(project, x, env, objective.over, seconds), env);
    const s = score(a, objective.ratio) / Math.max(1e-9, score(b, objective.ratio));
    return { score: s, res: a };
  }
  const res = await countOf(await plain(project, x, env, undefined, seconds), env);
  // a run cut by the time limit counts with what it reached (it is at least that hard)
  return { score: score(res, objective), res };
}

export async function mine(project, { source, objective = 'candidates-per-solution', budget = 200, keep = 10, seconds = 1, rounds = 3,
  mutations = 20, env, onProgress = () => {} } = {}) {
  const list = fuzzInstances(project, source);
  let runs = 0;
  // stage 1: successive halving over the seeds and grid points
  let pool = list.map((x) => ({ x, score: -Infinity, mutations: [] }));
  let limit = seconds;
  for (let r = 0; r < rounds && pool.length > keep && runs < budget; r++) {
    for (const c of pool) {
      if (runs >= budget) break;
      const e = await evaluate(project, c.x, env, objective, limit);
      runs++;
      c.score = e.score; c.res = e.res;
      onProgress({ stage: 1, round: r + 1, runs, instance: c.x.id, score: c.score });
    }
    pool.sort((a, b) => b.score - a.score);
    pool = pool.slice(0, Math.max(keep, Math.ceil(pool.length / 3)));
    limit *= 3;
  }
  for (const c of pool) if (c.score === -Infinity && runs < budget) { const e = await evaluate(project, c.x, env, objective, limit); runs++; c.score = e.score; c.res = e.res; }
  pool.sort((a, b) => b.score - a.score);
  // per grid cell: the median score of the stage-1 runs (for the report)
  const byCell = new Map();
  for (const c of pool) { const k = cellOf(c.x.params); (byCell.get(k) || byCell.set(k, []).get(k)).push(c.score); }
  // stage 2: mutate single facts of the best three; keep a change when the schema holds and the
  // objective rises
  const schema = project.fragments.find((f) => f.name === 'schema');
  for (const c of pool.slice(0, 3)) {
    if (runs >= budget) break;
    const d = await plain(project, c.x, env, undefined, limit);
    const inst = d.fragments.find((f) => f.name === 'instance');
    const norm = await normaliseFacts(inst ? inst.text : '', env.engineRun, d.settings.constants);
    if (norm.error) continue;
    let facts = norm.facts, best = c.score;
    for (let m = 0; m < mutations && runs < budget && facts.length > 1; m++) {
      // remove fact m mod n (a deterministic walk; adding facts needs a fact pool: not done)
      const k = m % facts.length;
      const next = facts.filter((_, i) => i !== k);
      const xi = { ...c.x, instance: { ...c.x.instance, facts: next.join('\n') + '\n', recipe: undefined } };
      delete xi.instance.recipe;
      if (schema) {
        const r = await env.engineRun(`${next.join('\n')}\n${schema.text}\n`, '--outf=3');
        if (r.status !== 10 && r.status !== 30) continue;
      }
      const e = await evaluate(project, xi, env, objective, limit);
      runs++;
      onProgress({ stage: 2, runs, instance: c.x.id, score: e.score });
      if (e.score > best) { best = e.score; c.mutations.push(`- ${facts[k]}`); facts = next; c.res = e.res; }
    }
    c.score = best;
  }
  pool.sort((a, b) => b.score - a.score);
  const best = pool.slice(0, keep).map((c) => ({
    id: `hard-${c.x.id}`, score: c.score, params: c.x.params, cellMedian: median(byCell.get(cellOf(c.x.params)) || [c.score]),
    instance: { id: `hard-${c.x.id}`, recipe: c.x.instance.recipe, mutations: c.mutations, constants: c.x.instance.constants || {}, tags: ['hard'] },
    res: c.res && { solutions: c.res.solutions, candidates: c.res.candidates, refinements: c.res.refinements, time: c.res.time, outcome: c.res.outcome },
  }));
  return { best, runs, cells: byCell.size };
}
