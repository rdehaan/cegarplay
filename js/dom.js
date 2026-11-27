// DOM helpers shared by the page's modules (not for js/compiler.js, js/driver.js, js/project.js:
// those stay DOM-free; see js/util.js).

export const $ = (id) => document.getElementById(id);

// h('button', { class: 'x', onclick: f, disabled: true }, 'text', child, ...): an element.
// Attributes that are null, undefined or false are left out; true gives an empty attribute;
// on<event> adds a listener. Children that are null, undefined or false are skipped; arrays
// are flattened.
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

export const SVGNS = 'http://www.w3.org/2000/svg';
// svg('rect', { width: 10 }, 'text'): an SVG element, with its text if given.
export function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

// The value of a CSS custom property of the page (a theme colour), with a grey fallback.
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

// Save a file: data is a Blob, or text with its media type.
export function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
