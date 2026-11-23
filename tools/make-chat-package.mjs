// Build dist/chat-package/: a flat folder of files that lets Claude in web chat (no
// repository) write library examples.   node tools/make-chat-package.mjs [outdir]
import fs from 'node:fs';
import { load, save } from '../js/project.js';

const root = new URL('..', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');

export function buildPackage() {
  const lib = JSON.parse(read('examples/library.json'));
  const files = {};
  const ids = lib.examples.map((e) => '`' + e.id + '`').join(', ');
  files['00-START-HERE.md'] = read('docs/chat-package/START-HERE.md').replace('{{IDS}}', ids);
  files['manual.md'] = read('manual.md');
  files['tutorial.html'] = read('tutorial.html');
  files['library.json'] = read('examples/library.json');
  files['cegarcheck.py'] = read('tools/cegarcheck.py');
  for (const e of lib.examples) {
    const text = read(`examples/${e.id}.json`);
    files[`example-${e.id}.json`] = text;
    // a project kit's readme, also as its own file (easier to read than a JSON string)
    const readme = JSON.parse(text).readme;
    if (typeof readme === 'string' && readme.trim()) files[`readme-${e.id}.md`] = readme.trim() + '\n';
  }
  const p = load(read('examples/starter.json'));
  p.title = 'My problem';
  p.description = 'Replace: the problem in 1-3 sentences, what the loop does, what to look at.';
  p.readme = '# My problem\n\nOptional (a project kit): the background, what the abstraction and the check model, the baseline and the variants, what "better" means, and open questions. Delete this field if not needed.\n';
  const t = JSON.parse(save(p, { runs: false }));
  delete t.runs;
  t.library = { id: 'my-problem', group: 'other', summary: 'Replace: one sentence with the solution count.',
    shape: 'shape1', tags: ['fast'], expected: 4 };
  files['contrib-template.json'] = JSON.stringify(t, null, 2) + '\n';
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`) : new URL('dist/chat-package/', root);
  const dir = out.href.endsWith('/') ? out : new URL(out.href + '/');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  const files = buildPackage();
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(new URL(name, dir), text);
    total += Buffer.byteLength(text);
  }
  console.log(`${Object.keys(files).length} files, ${Math.round(total / 1024)} KB in ${dir.pathname}`);
}
