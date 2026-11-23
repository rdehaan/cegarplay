// The workspace (FUTURE-DIRECTIONS D9): named projects kept in this browser next to the project
// being edited (which autosave keeps under cegarplay.project). No DOM; storage is passed in, so
// the tests can use a Map. Download and Upload stay the git-friendly route.
//
//   const w = new Workspace(localStorage)
//   w.list() -> [{ name, title, saved }] (newest first); w.has(name); w.save(name, text); w.load(name); w.remove(name)
export const WS_PREFIX = 'cegarplay.ws.';
export const WS_INDEX = 'cegarplay.ws';
export const WS_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;

export class Workspace {
  constructor(storage) { this.s = storage; }
  index() {
    try { const v = JSON.parse(this.s.getItem(WS_INDEX) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  writeIndex(list) { this.s.setItem(WS_INDEX, JSON.stringify(list)); }
  list() { return this.index().slice().sort((a, b) => String(b.saved).localeCompare(String(a.saved))); }
  has(name) { return this.index().some((x) => x.name === name); }
  // text: the project as Project.save writes it; title: shown in the list
  save(name, text, title = '', now = new Date().toISOString()) {
    if (!WS_NAME.test(name)) throw new Error('a name of letters, digits, spaces, _ . and - (at most 60)');
    this.s.setItem(WS_PREFIX + name, text);      // throws when the storage is full
    this.writeIndex([...this.index().filter((x) => x.name !== name), { name, title, saved: now }]);
  }
  load(name) { return this.s.getItem(WS_PREFIX + name); }
  remove(name) {
    this.s.removeItem(WS_PREFIX + name);
    this.writeIndex(this.index().filter((x) => x.name !== name));
  }
}
