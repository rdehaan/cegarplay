// Bounded verification of a refinement strategy over an instance space.
// No DOM, no Node APIs: used by the page, the CLI
// (tools/audit.mjs --space) and the tests.
import { deriveSpace, spaceBound, spaceCombos, ProjectError } from './project.js';
import { validateSpace } from './driver.js';

// The problems of a space at one value of its bound: [{ line, col, message }] (empty = fine).
export async function spaceProblems(project, name, engineRun, k) {
  const sp = (project.spaces || []).find((x) => x.name === name);
  if (!sp) return [{ line: 1, col: 1, message: `no space named '${name}'` }];
  const bound = spaceBound(sp);
  // the first combination of the other parameters (a range at its lowest value)
  let first = {};
  try { first = spaceCombos(sp)[0] || {}; } catch (e) { return [{ line: 1, col: 1, message: e.message }]; }
  const values = { ...(sp.defaults || {}), ...first };
  if (k !== undefined) values[bound] = k;
  for (const p of Object.keys(sp.params)) if (values[p] === undefined) values[p] = 1;
  const schema = (project.fragments || []).find((f) => f.name === 'schema');
  return validateSpace(sp, engineRun, Object.entries(values).map(([a, v]) => `${a}=${v}`), schema ? schema.text : '');
}

// Iterative deepening: one symbolic audit per k = from..to on the space's instances (k is the
// value of the bound parameter, whatever its name), and at each k one per combination of the other
// parameters (spaceCombos: fixed values and ranges), stopping at the first that is not sound.
// env.runBounded(project, { seconds, k, params }) runs one bounded audit of a derived project and
// returns its verdict (the A event's data) or null.
// Returns { verdict, k, params, witness, reason, bound, perK: [{ k, params, verdict, rounds, refinements, t }] }.
export async function verifySpace(project, { space, from, to, seconds = 60, variant, env, onK = null } = {}) {
  const sp = (project.spaces || []).find((x) => x.name === space);
  if (!sp) throw new ProjectError(`no space named '${space}'`);
  // the first k: given, else the space's `from`, else 1
  if (from === undefined || from === null) from = sp.from ?? 1;
  const bound = spaceBound(sp);
  const last = to ?? (sp.defaults && sp.defaults[bound] !== undefined ? Number(sp.defaults[bound]) : from);
  if (env.engineRun) {
    const errs = await spaceProblems(project, space, env.engineRun, from);
    if (errs.length) return { verdict: 'error', k: from, reason: `space ${space}, line ${errs[0].line}: ${errs[0].message}`, perK: [] };
  }
  const combos = spaceCombos(sp);
  const ranged = Object.keys(sp.ranges || {}).length > 0;
  const perK = [];
  let lastV = null;
  for (let k = from; k <= last; k++) {
    for (const params of combos) {
      const p = deriveSpace(project, space, { ...params, [bound]: k }, { variant });
      const v = await env.runBounded(p, { seconds, k, params });
      const row = { k, ...(ranged ? { params } : {}), verdict: v ? v.verdict : 'error', rounds: v ? v.rounds : null, refinements: v ? v.refinements : null, t: v && v.t != null ? v.t : null };
      perK.push(row);
      lastV = v;
      if (onK) onK(row, v);
      if (!v || v.verdict !== 'sound') {
        const witness = v && v.witness ? { ...v.witness, k, ...(ranged ? { params } : {}) } : null;
        return { verdict: v ? v.verdict : 'error', k, params, witness, reason: v ? v.reason || null : 'no verdict', space, bound, perK, last: v };
      }
    }
  }
  return { verdict: 'sound', k: last, witness: null, reason: null, space, bound, perK, last: perK.length ? lastV : null };
}
