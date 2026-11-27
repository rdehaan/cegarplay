// Small helpers shared by the page and the tools. No DOM, no Node APIs: js/driver.js,
// js/project.js and the Node tools may import this module.

// 32-bit FNV-1a of a text, as 8 hex digits (run history, recordings, caches).
export function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// A number with thousands separators (1,234); null or undefined as a dash; anything else as text.
export const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n == null ? '–' : String(n));

// "1 candidate", "1,234 candidates"; the plural can be given ("1 child", "2 children").
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

// HTML text and attribute values.
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// CSV: one field (quoted when it needs to be), and rows of fields as a file.
export const csvField = (x) => { const t = x == null ? '' : String(x); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const csvRows = (rows) => rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
