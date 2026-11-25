// Refinery, milestone 1: on every `fast` library example the audit supports, the Refinery's
// soundness of the loop scheme equals the audit's verdict, and its counts equal the audit's
// (sharded over test/lab-library-[1-3].test.mjs). Unsupported loops (cores, expand, ...) are
// counted, not compared: the lab says why it does not look at them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTarget, auditProject } from '../tools/audit.mjs';
import { nodeExec, LUA } from '../tools/lab.mjs';
import * as Lab from '../js/lab/core.js';

const LIB = JSON.parse(fs.readFileSync(new URL('../examples/library.json', import.meta.url), 'utf8')).examples;
export const FAST = LIB.filter((e) => (e.tags || []).includes('fast')).map((e) => e.id);

export async function checkLibrary(shard, shards) {
  const wrong = [], seen = { compared: 0, unsupported: 0 };
  for (const [k, id] of FAST.entries()) {
    if (k % shards !== shard) continue;
    const p = loadTarget(id);
    let sp = null, why = null;
    try {
      const ctx = await Lab.prepare(p, {}, nodeExec, LUA);
      sp = await Lab.computeSpace(ctx);
    } catch (e) { why = e; }
    if (why) {
      // the lab declines only loops it does not support (version 1), with the reason
      if (why.code === 4 && /expand|cores|several links|partial|families|audit: false|raw Lua|chain|other means|no link/.test(why.message)) { seen.unsupported++; continue; }
      wrong.push(`${id}: ${why.message} (code ${why.code})`);
      continue;
    }
    const a = await auditProject(p, { seconds: 120 });
    const v = a.verdict;
    // a loop refined only by blocks: the audit declines (blocks need no audit); the Refinery's scheme is the block
    if (!v && sp.meta.blockOnly) { seen.blockOnly = (seen.blockOnly || 0) + 1; if (Lab.loopSoundness(sp).sound !== true) wrong.push(`${id}: a block scheme reported unsound`); continue; }
    if (!v || !['sound', 'unsound'].includes(v.verdict)) { wrong.push(`${id}: audit gave ${v ? v.verdict : 'no verdict'}`); continue; }
    seen.compared++;
    const s = Lab.loopSoundness(sp);
    if (v.candidates !== sp.count) wrong.push(`${id}: ${sp.count} candidates, audit ${v.candidates}`);
    if (v.solutions !== sp.sols.length) wrong.push(`${id}: ${sp.sols.length} solutions, audit ${v.solutions}`);
    if (v.kinds.includes('clause') || v.kinds.includes('clauses')) {
      if (s.sound !== (v.verdict === 'sound')) wrong.push(`${id}: lab says ${s.sound ? 'sound' : 'unsound'}, audit ${v.verdict}`);
      if (v.pairs !== sp.summary().options) wrong.push(`${id}: ${sp.summary().options} options, audit ${v.pairs} pairs`);
      if (v.verdict === 'unsound' && s.unsound !== v.unsound) wrong.push(`${id}: ${s.unsound} unsound options, audit ${v.unsound}`);
      if (v.verdict === 'unsound' && s.atRisk !== v.at_risk) wrong.push(`${id}: ${s.atRisk} solutions at risk, audit ${v.at_risk}`);
    }
  }
  assert.deepEqual(wrong, []);
  return seen;
}
