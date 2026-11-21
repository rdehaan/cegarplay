// css/theme.css: the colour tokens of the light and the dark theme, and their use.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as H from './helpers.mjs';

const THEME = H.read('css/theme.css');
// The stylesheets that must take every colour from theme.css.
const SHEETS = ['css/main.css', 'guide/guide.css'].filter((p) => fs.existsSync(H.path(p)));

function vars(block) {
  const m = new Map();
  for (const [, k, v] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) m.set(k, v.trim());
  return m;
}
function blockAfter(text, opener) {
  const i = text.indexOf(opener);
  assert.ok(i >= 0, `theme.css has no block ${opener}`);
  return text.slice(i + opener.length, text.indexOf('}', i));
}
const LIGHT = vars(blockAfter(THEME, ':root {'));
const DARK_MEDIA = vars(blockAfter(THEME, ':root:not([data-theme="light"]) {'));
const DARK = vars(blockAfter(THEME, ':root[data-theme="dark"] {'));

test('theme.css: the two dark blocks are the same, and both themes define the same tokens', () => {
  assert.deepEqual([...DARK_MEDIA], [...DARK]);
  assert.deepEqual([...LIGHT.keys()].sort(), [...DARK.keys()].sort());
  assert.ok(THEME.includes('@media (prefers-color-scheme: dark)'));
});

test('stylesheets use no colour literal, and every token they use is defined', () => {
  assert.ok(SHEETS.includes('css/main.css'));
  const NAMED = /\b(?:orange|white|black|red|green|blue|yellow|gray|grey|silver|purple|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown|gold|beige|ivory|tan|khaki|crimson|coral|salmon|tomato|violet|indigo|cyan|magenta|lightgr[ae]y|darkgr[ae]y|whitesmoke|gainsboro)\b/i;
  for (const p of SHEETS) {
    const css = H.read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/white-space/g, '');
    const lines = css.split('\n');
    lines.forEach((line, i) => {
      assert.doesNotMatch(line, /#[0-9a-fA-F]{3,8}\b/, `${p}:${i + 1}: ${line.trim()}`);
      assert.doesNotMatch(line, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/, `${p}:${i + 1}: ${line.trim()}`);
      // Only declarations count (a named colour can be part of a selector or a font name).
      const decl = line.match(/:\s*([^;{]*);/);
      if (decl && !/^\s*--/.test(line)) assert.doesNotMatch(decl[1], NAMED, `${p}:${i + 1}: ${line.trim()}`);
    });
    for (const [, name] of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      assert.ok(LIGHT.has(name), `${p} uses ${name}, which the light theme does not define`);
      assert.ok(DARK.has(name), `${p} uses ${name}, which the dark theme does not define`);
    }
  }
});

// WCAG contrast of two #rgb / #rrggbb colours.
function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Text token on background token, as main.css and guide.css combine them.
const PAIRS = [
  ['text', 'panel'], ['text', 'page'], ['text-soft', 'page'], ['text-muted', 'panel'], ['text-faint', 'panel'],
  ['text-soft', 'panel'], ['tab-text', 'panel'], ['tab-hover', 'panel'], ['link', 'panel'], ['anchor', 'panel'],
  ['anchor-visited', 'panel'], ['link', 'hint-bg'], ['error', 'panel'], ['error', 'error-bg'], ['ok', 'ok-bg'],
  ['busy', 'busy-bg'], ['warn', 'warn-bg'], ['warn', 'panel'], ['text', 'paused-bg'], ['text', 'subtle'],
  ['text-soft', 'subtle'], ['text-muted', 'subtle'], ['text-muted', 'tag-bg'], ['text', 'highlight'],
  ['text', 'selected-bg'], ['text-faint', 'selected-bg'], ['text-soft', 'selected-bg'], ['text', 'code-bg'],
  ['text', 'button-bg'], ['text', 'locked-bg'], ['tooltip-text', 'tooltip-bg'], ['text-faint', 'page'],
  // the guide: highlighted code, "what changed" lines, asides
  ['syn-comment', 'code-bg'], ['syn-keyword', 'code-bg'], ['syn-string', 'code-bg'], ['syn-number', 'code-bg'],
  ['syn-variable', 'code-bg'], ['syn-special', 'code-bg'], ['text', 'error-bg'], ['text', 'ok-bg'],
  ['syn-keyword', 'error-bg'], ['syn-keyword', 'ok-bg'], ['text', 'hint-bg'], ['text', 'warn-bg'], ['link', 'subtle'],
];

test('dark theme: text tokens have contrast at least 4.5 against their backgrounds', () => {
  for (const [fg, bg] of PAIRS) {
    const c = contrast(DARK.get('--' + fg), DARK.get('--' + bg));
    assert.ok(c >= 4.5, `--${fg} on --${bg}: ${c.toFixed(2)}`);
  }
});

test('dark theme: the chart colours are distinguishable on the panel', () => {
  const charts = [1, 2, 3, 4, 5, 6, 7].map((i) => DARK.get(`--chart-${i}`));
  for (const c of charts) assert.ok(contrast(c, DARK.get('--panel')) >= 3, `${c} on the panel`);
  assert.equal(new Set(charts).size, charts.length);
});

// TODO B3: the light theme too (named system colours such as LinkText are skipped).
test('light theme: text tokens have contrast at least 4.5 against their backgrounds', () => {
  const hex = (v) => /^#[0-9a-fA-F]{3,6}$/.test(v);
  for (const [fg, bg] of PAIRS) {
    const a = LIGHT.get('--' + fg), b = LIGHT.get('--' + bg);
    if (!hex(a) || !hex(b)) continue;
    assert.ok(contrast(a, b) >= 4.5, `light: --${fg} ${a} on --${bg} ${b}: ${contrast(a, b).toFixed(2)}`);
  }
});
