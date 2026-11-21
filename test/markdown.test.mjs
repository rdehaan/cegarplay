// js/markdown.js: the renderer of the manual.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { renderMarkdown, renderInline, slugify } from '../js/markdown.js';

test('headings get stable, unique ids', () => {
  const headings = [];
  const html = renderMarkdown('# Title\n\n## The `loop` language\n\n## Notes\n\n### Notes', { headings });
  assert.match(html, /<h1 id="manual-title">Title<\/h1>/);
  assert.match(html, /<h2 id="manual-the-loop-language">The <code>loop<\/code> language<\/h2>/);
  assert.match(html, /<h3 id="manual-notes-2">Notes<\/h3>/);
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 2, 3]);
  assert.equal(headings[1].text, 'The loop language');
  assert.equal(slugify('Import and export'), 'import-and-export');
});

test('paragraphs, inline markup and escaping', () => {
  assert.equal(renderMarkdown('a\nb\n\nc'), '<p>a b</p>\n<p>c</p>');
  assert.equal(renderInline('**b** and *i* and `x < y` and <script>'),
    '<b>b</b> and <i>i</i> and <code>x &lt; y</code> and &lt;script&gt;');
  assert.equal(renderInline('`a * b * c` snake_case_name 2 * 3 * 4'), '<code>a * b * c</code> snake_case_name 2 * 3 * 4');
  assert.equal(renderInline('`**not bold**`'), '<code>**not bold**</code>');
});

test('links: safe URLs only; ?example= links load an example', () => {
  assert.equal(renderInline('[x](#manual-a)'), '<a href="#manual-a">x</a>');
  assert.equal(renderInline('[x](javascript:alert)'), 'x');
  assert.equal(renderInline('[gc](?example=gc-shape4)'), '<a href="?example=gc-shape4" data-load-example="gc-shape4">gc</a>');
  assert.match(renderInline('[w](https://example.org/)'), /target="_blank" rel="noopener"/);
});

test('fenced code: loop and asp become ACE blocks, others <pre>', () => {
  const html = renderMarkdown('```loop\nsearch A:\n    on candidate M:\n```\n\n```asp\na :- b, c < 2.\n```\n\n```json\n{"a": "<b>"}\n```');
  assert.match(html, /<div class="example-code" data-mode="loop">search A:\n {4}on candidate M:<\/div>/);
  assert.match(html, /<div class="example-code" data-mode="gringo">a :- b, c &lt; 2.<\/div>/);
  assert.match(html, /<pre class="code-block" data-lang="json"><code>\{&quot;a&quot;: &quot;&lt;b&gt;&quot;\}<\/code><\/pre>/);
  // a code block keeps blank lines and # lines
  assert.match(renderMarkdown('```\n# not a heading\n\nx\n```'), /<code># not a heading\n\nx<\/code>/);
});

test('nested lists with continuation lines', () => {
  const html = renderMarkdown('- one\n  more\n  - sub\n- two\n\n1. first\n2. second');
  assert.equal(html, '<ul><li>one more<ul><li>sub</li></ul></li><li>two</li></ul>\n<ol><li>first</li><li>second</li></ol>');
});

test('pipe tables, with | inside code and escaped', () => {
  const html = renderMarkdown('| A | B |\n| --- | --- |\n| `a | b` | c \\| d |\n| e |');
  assert.match(html, /<th>A<\/th><th>B<\/th>/);
  assert.match(html, /<td><code>a \| b<\/code><\/td><td>c \| d<\/td>/);
  assert.match(html, /<tr><td>e<\/td><td><\/td><\/tr>/);
});

test('block quotes and rules', () => {
  assert.equal(renderMarkdown('> a\n> b\n\n---'), '<blockquote><p>a b</p></blockquote>\n<hr>');
});

test('the manual renders: every section, every library id linked, internal links resolve', () => {
  const md = H.read('manual.md');
  const headings = [];
  const html = renderMarkdown(md, { headings });
  assert.ok(headings.filter((h) => h.level === 2).length >= 12);
  const ids = new Set(headings.map((h) => h.id));
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `link to #${id}`);
  const lib = JSON.parse(H.read('examples/library.json'));
  for (const [, id] of html.matchAll(/data-load-example="([^"]+)"/g)) assert.ok(lib.examples.some((e) => e.id === id), id);
  // The guide's examples are named on the guide's pages (test/guide.test.mjs), not one by one here.
  for (const e of lib.examples.filter((x) => x.group !== 'guide')) assert.ok(md.includes('`' + e.id + '`'), `manual names ${e.id}`);
  assert.ok(!/<script/i.test(html));
  // the tutorial's links into the manual resolve too
  for (const [, id] of H.read('tutorial.html').matchAll(/href="#(manual-[^"]+)"/g)) assert.ok(ids.has(id), `tutorial link #${id}`);
});
