// TODO C1: share links (js/share.js) round trip, compressed and plain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { encodeShare, decodeShare, shareData } from '../js/share.js';
import { load, save } from '../js/project.js';

for (const id of ['graph-coloring', 'lang-raw-lua']) {
  test(`share link round trip: ${id}`, async () => {
    const p = load(H.read(`examples/${id}.json`));
    p.runs = [{ t: 1 }];
    for (const compress of [true, false]) {
      const data = await encodeShare(p, { compress });
      assert.match(data, /^[zu][A-Za-z0-9_-]+$/);
      const q = await decodeShare(data);
      assert.deepEqual(q.runs, []);
      assert.equal(save(q), save({ ...p, runs: [] }));
    }
    const z = await encodeShare(p, { compress: true }), u = await encodeShare(p, { compress: false });
    assert.ok(z.length < u.length);
  });
}

test('share links: bad data gives a readable error; shareData reads #p=', async () => {
  await assert.rejects(decodeShare('zAAAA'), /damaged/);
  await assert.rejects(decodeShare('x123'), /unknown format/);
  await assert.rejects(decodeShare('u' + Buffer.from('{"format":"nope"}').toString('base64url')), /./);
  await assert.rejects(decodeShare('u!!'), /unexpected characters/);
  assert.equal(shareData('#p=abc'), 'abc');
  assert.equal(shareData('#manual-x'), null);
});

test('share links: a link that unpacks to too much is refused', async () => {
  const big = new TextEncoder().encode('{"a":"' + 'x'.repeat(9 * 1024 * 1024) + '"}');
  const s = new Blob([big]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(s).arrayBuffer());
  let b = ''; for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = 'z' + btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await assert.rejects(decodeShare(data), /unpacks to more than 8 MB/);
});
