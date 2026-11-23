// PLAN3 phase S7: every library space reaches its expected verdict and k (sharded over
// test/spaces-library-[1-3].test.mjs; the slow ones only with SLOW=1).
import assert from 'node:assert/strict';
import { SLOW } from './helpers.mjs';
import { loadTarget, spaceAudit } from '../tools/audit.mjs';
import { SPACES } from '../tools/library.mjs';

// spaces whose last step takes more than a few seconds (PROGRESS.md, phase S7)
export const SLOW_SPACES = new Set(['default-extensions/theories', 'strong-nash/games', 'stable-models/programs', 'abduction/theories', 'min-dnf/n', 'slitherlink/n', 'sudoku-unique/k', 'akari/n']);

export async function checkSpaces(shard, shards) {
  const wrong = [];
  let i = 0;
  for (const [id, spaces] of Object.entries(SPACES)) {
    for (const sp of spaces) {
      if (i++ % shards !== shard) continue;
      if (SLOW_SPACES.has(`${id}/${sp.name}`) && !SLOW) continue;
      const r = await spaceAudit(loadTarget(id), { space: sp.name, to: sp.expected.k, seconds: 60 });
      if (r.verdict !== sp.expected.verdict || r.k !== sp.expected.k) {
        wrong.push(`${id}/${sp.name}: ${r.verdict} at k = ${r.k} (expected ${sp.expected.verdict} at ${sp.expected.k})${r.reason ? `; ${r.reason}` : ''}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
}
