// Copy the clingo-wasm engine from test/node_modules into vendor/clingo-wasm/.
//   node tools/vendor.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkgDir = path.join(root, 'test', 'node_modules', 'clingo-wasm');
const src = path.join(pkgDir, 'dist');
const dst = path.join(root, 'vendor', 'clingo-wasm');
const files = ['clingo.js', 'clingo.wasm', 'clingo-mt.js', 'clingo-mt.wasm'];

if (!fs.existsSync(src)) {
  console.error(`missing ${src}: run "cd test && npm install" first`);
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
fs.mkdirSync(dst, { recursive: true });
const lines = [`clingo-wasm ${version}`];
for (const f of files) {
  const data = fs.readFileSync(path.join(src, f));
  fs.writeFileSync(path.join(dst, f), data);
  lines.push(`${crypto.createHash('sha256').update(data).digest('hex')}  ${f}`);
}
fs.writeFileSync(path.join(dst, 'package.json'), '{ "type": "module" }\n');
fs.writeFileSync(path.join(dst, 'VERSION'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
