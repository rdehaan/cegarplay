// Write test/draw-vectors.json: 200 draws computed by lua/draw.lua (the engine), which
// test/draw.test.mjs and tools/draw.py both assert. Run after a change to the mixer (never
// silently: the vectors pin the instances of every stored recipe).
import fs from 'node:fs';
import factory from '../vendor/clingo-wasm/clingo.js';

const root = new URL('..', import.meta.url);
const draw = fs.readFileSync(new URL('lua/draw.lua', root), 'utf8').replace(/\n?return draw\s*$/, '');
const cases = [];
const fns = [
  (i) => ['flip', [[100, 300, 500, 900][i % 4]], [i, i * 7 % 5]],
  (i) => ['int', [-5, 20 + i], [i, 'a']],
  (i) => ['weighted', [[1, 2, 3, i % 5 + 1]], [i]],
  (i) => ['perm', [8, i % 8 + 1], ['k', i % 3]],
  (i) => ['subset', [3, 8, i % 8 + 1], ['k2']],
  (i) => ['mallows', [6, [0, 300, 700, 1000][i % 4], i % 6 + 1], [`voter(${i % 5})`]],
  (i) => ['int', [0, 1 << 20], ['big', i]],
  (i) => ['flip', [500], [`e(${i},${i + 1})`, '"s"']],
];
for (let i = 0; i < 200; i++) {
  const [fn, args, keys] = fns[i % fns.length](i);
  cases.push({ seed: [0, 1, 42, 123456789][i % 4], attempt: i % 3, fn, args, keys });
}
const lit = (v) => Array.isArray(v) ? `{ ${v.map(lit).join(', ')} }` : typeof v === 'string' ? JSON.stringify(v) : String(v);
const lines = cases.map((c) => `print(draw.call(${c.seed}, ${c.attempt}, ${JSON.stringify(c.fn)}, ${[...c.args, ...c.keys].map(lit).join(', ')}))`);
const program = `#script (lua)\n${draw}\nfunction main(prg)\n${lines.join('\n')}\nend\n#end.\n`;
const out = [];
const m = await factory({ print: (l) => out.push(l), printErr: () => {} });
m.ccall('run', 'number', ['string', 'string'], [program, '']);
const vals = out.filter((l) => /^-?\d+$/.test(l)).map(Number);
if (vals.length !== cases.length) throw new Error(`expected ${cases.length} values, got ${vals.length}: ${out.slice(0, 5)}`);
cases.forEach((c, i) => { c.value = vals[i]; });
fs.writeFileSync(new URL('test/draw-vectors.json', root), JSON.stringify(cases, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`wrote ${cases.length} vectors`);
