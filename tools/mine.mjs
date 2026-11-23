// Mine hard instances of a project's generator (FUTURE-DIRECTIONS D8; js/mine.js).
//
//   node tools/mine.mjs <project.json | library id> [--generator NAME] [--grid name=v1,v2,...]...
//                       [--seeds N] [--objective candidates-per-solution|clauses|time]
//                       [--budget N] [--keep N] [--seconds S] [--json] [--add FILE]
//
// Prints the best instances (score, counts, recipe). --add FILE writes the project with them
// added as recipe instances (tag hard). Exit code 0, 1 on a problem, 2 on bad usage.
import fs from 'node:fs';
import { load, save } from '../js/project.js';
import { mine, OBJECTIVES } from '../js/mine.js';
import { freshId } from '../js/instances.js';
import { loadTarget } from './audit.mjs';

const lua = (n) => fs.readFileSync(new URL(`../lua/${n}`, import.meta.url), 'utf8');

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/mine.mjs <project.json | library id> [--generator NAME] [--grid name=v1,v2] [--seeds N] [--objective OBJ] [--budget N] [--keep N] [--seconds S] [--json] [--add FILE]');
  process.exit(2);
}

async function main(argv) {
  const { engineRun } = await import('./run.mjs');
  const args = [...argv];
  let target = null, generator = null, seeds = 24, objective = 'candidates-per-solution', budget = 60, keep = 5, seconds = 1, json = false, add = null;
  const grid = {};
  while (args.length) {
    const a = args.shift();
    if (a === '--generator') generator = args.shift() || usage('--generator needs a name');
    else if (a === '--grid') {
      const kv = args.shift() || usage('--grid needs name=v1,v2');
      const i = kv.indexOf('=');
      if (i < 1) usage(`bad --grid ${kv}`);
      grid[kv.slice(0, i)] = kv.slice(i + 1).split(',').map((x) => (/^-?\d+$/.test(x) ? Number(x) : x));
    } else if (a === '--seeds') { seeds = Number(args.shift()); if (!(seeds >= 1)) usage('bad --seeds'); }
    else if (a === '--objective') { objective = args.shift(); if (!OBJECTIVES.includes(objective)) usage(`--objective: ${OBJECTIVES.join(', ')}`); }
    else if (a === '--budget') { budget = Number(args.shift()); if (!(budget >= 1)) usage('bad --budget'); }
    else if (a === '--keep') { keep = Number(args.shift()); if (!(keep >= 1)) usage('bad --keep'); }
    else if (a === '--seconds') { seconds = Number(args.shift()); if (!(seconds > 0)) usage('bad --seconds'); }
    else if (a === '--json') json = true;
    else if (a === '--add') add = args.shift() || usage('--add needs a file');
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (target) usage('only one project');
    else target = a;
  }
  if (!target) usage();
  let project;
  try { project = loadTarget(target); } catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(2); }
  const gens = project.generators || [];
  const g = generator ? gens.find((x) => x.name === generator) : gens[0];
  if (!g) usage(generator ? `no generator named ${generator}` : 'the project has no generator');
  const env = { engineRun, runtime: lua('runtime.lua'), luaTexts: { draw: lua('draw.lua'), generate: lua('generate.lua') },
    modules: { ground: lua('ground.lua'), audit: lua('audit.lua'), replay: lua('replay.lua') } };
  let r;
  try {
    r = await mine(project, { source: { generator: g.name, grid, seeds }, objective, budget, keep, seconds, rounds: 2, mutations: 6, env,
      onProgress: (x) => { if (!json) process.stderr.write(`\rstage ${x.stage}, ${x.runs} runs`); } });
  } catch (e) { console.error(`\n${e.message}`); process.exit(1); }
  if (!json) process.stderr.write('\n');
  for (const b of r.best) {
    if (json) console.log(JSON.stringify(b));
    else console.log(`${b.id}: score ${b.score.toFixed(2)} (cell median ${b.cellMedian.toFixed(2)}); ${b.res ? `${b.res.candidates} candidates, ${b.res.solutions} solutions, ${b.res.outcome}` : 'no run'}; recipe ${JSON.stringify(b.instance.recipe)}${b.instance.mutations.length ? `, ${b.instance.mutations.length} facts removed` : ''}`);
  }
  if (!json) console.log(`${r.runs} runs over ${r.cells} grid cells`);
  if (add) {
    const p = load(fs.readFileSync(typeof target === 'string' && fs.existsSync(target) ? target : new URL(`../examples/${target}.json`, import.meta.url), 'utf8'));
    p.instances = p.instances || [];
    for (const b of r.best) p.instances.push({ ...b.instance, id: freshId(p, b.id) });
    fs.writeFileSync(add, save(p));
    if (!json) console.log(`wrote ${add} with ${r.best.length} more instances`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
