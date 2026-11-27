// Helpers shared by the Instances tab (js/instances-tab.js) and its parts.
import { costText } from './project.js';
import { fmt } from './util.js';
import { h as el } from './dom.js';

// A part of the tab (Generators, Spaces): folded under its heading, with a one-line summary
// beside it, so a project that does not use it shows one line. Whether it is open is kept in this
// browser (cegarplay.instances-open, a list of keys).
const OPEN_KEY = 'cegarplay.instances-open';
function openParts() { try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || []; } catch { return []; } }
export function partFold(key, title, summary, ...children) {
  const d = el('details', { class: 'instances-part', id: `${key}-part` },
    el('summary', {}, el('h3', {}, title), ' ', summary), ...children);
  d.open = openParts().includes(key);
  d.addEventListener('toggle', () => {
    try {
      const s = new Set(openParts());
      if (d.open) s.add(key); else s.delete(key);
      if (s.size) localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); else localStorage.removeItem(OPEN_KEY);
    } catch { /* no storage */ }
  });
  return d;
}

// the Expected column: "12", "optimum 8" or both
export const expectedText = (e) => !e ? '–' : [Number.isInteger(e.solutions) ? fmt(e.solutions) : null, e.optimum != null ? `optimum ${costText(e.optimum)}` : null].filter(Boolean).join(', ') || '–';
// A card's "Add as instance" after a click: says so, and is not clicked twice
export function added(card, id) {
  const b = card.querySelector('button');
  if (b) { b.textContent = `Added ✓ (${id})`; b.disabled = true; }
}

// generated facts ("a. b(1). c.") one per line
export const factsText = (facts) => String(facts || '').split(/(?<=\.)\s+/).filter(Boolean).join('\n') + '\n';
export const constText = (c) => Object.entries(c || {}).map(([k, v]) => `${k}=${v}`).join(', ');
export function parseConsts(text) {
  const out = {};
  for (const part of String(text).split(/[,\s]+/).filter(Boolean)) {
    const m = /^([a-z][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (!m) throw new Error(`"${part}" is not name=value`);
    out[m[1]] = m[2];
  }
  return out;
}

export const RUN_ALL_TITLE = 'Run every instance in the table in turn (the instance picked in the top bar does not matter), with the variant picked in the top bar';

// What Fuzz does, said at the top of its result card.
export const FUZZ_WHAT = 'Fuzz looks for a small instance on which the loop is unsound. It audits instances from small to large (every refinement the loop could make; ' +
  'a solution removed means unsound), stops at the first unsound one, removes facts from it while it stays unsound, and shows the step of the loop\'s own run that loses the solution.';

// What a Fuzz source goes over, in words.
export function fuzzSourceText(source, project, suite) {
  if (source.constants) {
    const parts = Object.entries(source.constants).map(([k, v]) => `${k} = ${v[0]}..${v[v.length - 1]}`);
    return `the project with ${parts.join(' and ')} (every numeric constant from 1 up to its value in the Loop tab; not the instances in the table)`;
  }
  if (source.generator) return `the instances of suite ${suite ? suite.name : '?'} (generator ${source.generator}${source.grid ? `, ${Object.entries(source.grid).map(([k, v]) => `${k} in ${JSON.stringify(v)}`).join(', ')}` : ''}, ${source.seeds || 1} seed${(source.seeds || 1) === 1 ? '' : 's'} each)`;
  const n = (project.instances || []).length;
  return `the ${n} instance${n === 1 ? '' : 's'} in the table`;
}
