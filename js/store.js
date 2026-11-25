// Campaign rows: an IndexedDB store `cells` in the database
// `cegarplay`, keyed by cell key, and a memory store with the same interface. Rows travel as JSON
// lines (one row per line), the format tools/bench.mjs writes. No DOM.
const DB = 'cegarplay', STORE = 'cells';

export class MemoryStore {
  constructor(rows = []) { this.map = new Map(rows.map((r) => [r.key, r])); }
  async get(key) { return this.map.get(key) || null; }
  async put(row) { this.map.set(row.key, row); }
  async all() { return [...this.map.values()]; }
  async clear() { this.map.clear(); }
}

function req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }

export class IdbStore {
  static async open(name = DB) {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' }); };
    const s = new IdbStore();
    s.db = await req(r);
    return s;
  }
  tx(mode) { return this.db.transaction(STORE, mode).objectStore(STORE); }
  async get(key) { return (await req(this.tx('readonly').get(key))) || null; }
  async put(row) { await req(this.tx('readwrite').put(row)); }
  async all() { return req(this.tx('readonly').getAll()); }
  async clear() { await req(this.tx('readwrite').clear()); }
}

export function exportRows(rows) { return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''); }

export function importRows(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    let r;
    try { r = JSON.parse(l); } catch (e) { throw new Error(`line ${i + 1}: not JSON (${e.message})`); }
    if (!r || typeof r.key !== 'string') throw new Error(`line ${i + 1}: a row needs a key`);
    out.push(r);
  });
  return out;
}
