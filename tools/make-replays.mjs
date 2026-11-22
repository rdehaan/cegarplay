// Write one replay file per library example tagged fast: examples/replays/<id>.cprec
// (a gzip recording of a run with every step and call, docs/spec-recording.md).
//
//   node tools/make-replays.mjs [id ...]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { load } from '../js/project.js';
import { runProject, recordingOf } from './run.mjs';

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
  const rec = recordingOf(p, r.events, { example: e.id });
  const buf = Buffer.from(await (await rec.toBlob()).arrayBuffer());
  // keep the old file when only times differ (smaller commits)
  const file = new URL(`${e.id}.cprec`, dir);
  const timeless = (b) => zlib.gunzipSync(b).toString('utf8')
    .replace(/"(dt|t0|t|time|ground|ms|seconds_used)":-?[0-9.e-]+/g, '"$1":0');
  let same = false;
  try { same = timeless(fs.readFileSync(file)) === timeless(buf); } catch { same = false; }
  if (!same) { fs.writeFileSync(file, buf); changed++; }
  total += buf.length; n++;
}
console.log(`${n} replays (${changed} rewritten), ${(total / 1024).toFixed(0)} KB in examples/replays/`);
