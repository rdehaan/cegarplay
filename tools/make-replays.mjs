// Write one replay file per library example tagged fast: examples/replays/<id>.cprec
// (a gzip recording of a run with every step and call, docs/spec-recording.md).
//
//   node tools/make-replays.mjs [id ...]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { load } from '../js/project.js';
import { runProject, recordingOf } from './run.mjs';
import factory from '../vendor/clingo-wasm/clingo.js';
import { viewProject, sceneProgram, viewProgram, frameFacts, viewAtoms, hashText, VIEW_OPTIONS } from '../js/views.js';
import { pairSteps } from '../js/recording.js';

// precomputed frames of an example's first view: program hash -> marks (examples/views/<id>.json)
async function engineRun(program, options) {
  const out = [], err = [];
  const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); } catch (e) { status = 'trap'; }
  return { status, out, err };
}
async function viewFrames(project, rec) {
  const v = (project.views || [])[0];
  if (!v) return null;
  const p = viewProject(project, rec.header.instance);
  const progs = [sceneProgram(p, v)];
  // the frames the page asks for: every step of pairSteps (T facts where a T event exists)
  const steps = pairSteps(rec).map((st) => (st.t ? frameFacts(st.t) : frameFacts(st.r, ((rec.I && rec.I.links[(st.r.l || 1) - 1]) || { atoms: [] }).atoms)));
  for (const f of steps.slice(0, 200)) progs.push(viewProgram(p, v, f));
  const out = {};
  for (const prog of progs) {
    const a = viewAtoms(await engineRun(prog, VIEW_OPTIONS));
    if (!a.error) out[hashText(prog)] = a.atoms;
  }
  return out;
}

const root = new URL('..', import.meta.url);
const dir = new URL('examples/replays/', root);
fs.mkdirSync(dir, { recursive: true });
const lib = JSON.parse(fs.readFileSync(new URL('examples/library.json', root), 'utf8'));
const want = process.argv.slice(2);
let total = 0, n = 0, changed = 0;
for (const e of lib.examples) {
  if (want.length ? !want.includes(e.id) : !(e.tags || []).includes('fast')) continue;
  const p = load(fs.readFileSync(new URL(`examples/${e.id}.json`, root), 'utf8'));
  p.settings = { ...p.settings, record: { steps: 'all', n: 0, calls: true } };
  const r = await runProject(p, { backstop: true });
  if (r.problems && r.problems.length) { console.error(`${e.id}: ${r.problems[0].message}`); continue; }
  const rec = recordingOf(p, r.events, { example: e.id, instance: r.project ? r.project.instance || null : null });
  const buf = Buffer.from(await (await rec.toBlob()).arrayBuffer());
  // keep the old file when only times differ (smaller commits): time fields, and the progress
  // S events, which a timer flushes at varying places (only the final S is compared)
  const file = new URL(`${e.id}.cprec`, dir);
  const timeless = (b) => {
    const lines = zlib.gunzipSync(b).toString('utf8').replace(/"(dt|t0|t|time|ground|ms|seconds_used)":-?[0-9.e-]+/g, '"$1":0').split('\n');
    const lastS = lines.map((l) => l.startsWith('@@S ')).lastIndexOf(true);
    return lines.filter((l, i) => !l.startsWith('@@S ') || i === lastS).join('\n');
  };
  let same = false;
  try { same = timeless(fs.readFileSync(file)) === timeless(buf); } catch { same = false; }
  if (!same) { fs.writeFileSync(file, buf); changed++; }
  total += buf.length; n++;
  const frames = await viewFrames(load(fs.readFileSync(new URL(`examples/${e.id}.json`, root), 'utf8')), rec);
  if (frames) {
    fs.mkdirSync(new URL('examples/views/', root), { recursive: true });
    fs.writeFileSync(new URL(`examples/views/${e.id}.json`, root), JSON.stringify(frames) + '\n');
  }
}
console.log(`${n} replays (${changed} rewritten), ${(total / 1024).toFixed(0)} KB in examples/replays/`);
