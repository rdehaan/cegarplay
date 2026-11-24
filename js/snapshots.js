// Project snapshots (FUTURE-DIRECTIONS, interface): named copies of the project being edited,
// kept in this browser, to go back to. No DOM; storage is passed in (the browser's storage in the page, a
// Map-like object in the tests), as js/workspace.js does. The Control tab draws them (js/init.js).
//
//   const s = new Snapshots(storage)
//   s.list(project)                -> [{ id, name, project, saved, auto }] of that project, newest first
//   s.save(project, name, text, { auto, now }) -> id   (text: the project as Project.save writes it)
//   s.load(id) -> text | null;  s.remove(id);  s.all() -> every snapshot, newest first
//
// A snapshot belongs to the project whose title it was taken of (`project`: the title, or
// "(untitled)"). Each project keeps at most CAP snapshots: past it, the oldest automatic one goes
// first, then the oldest. Storage errors (full, unavailable) are thrown to the caller, which says so.
export const SNAP_INDEX = 'cegarplay.snap';
export const SNAP_PREFIX = 'cegarplay.snap.';
export const SNAP_CAP = 20;
export const SNAP_NAME = /^[^\n\r]{1,80}$/;

export const projectKey = (title) => (typeof title === 'string' && title.trim() ? title.trim() : '(untitled)');

export class Snapshots {
  constructor(storage, { cap = SNAP_CAP } = {}) { this.s = storage; this.cap = cap; this.n = 0; }

  index() {
    try { const v = JSON.parse(this.s.getItem(SNAP_INDEX) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : []; } catch { return []; }
  }
  writeIndex(list) { this.s.setItem(SNAP_INDEX, JSON.stringify(list)); }

  all() { return this.index().slice().sort((a, b) => String(b.saved).localeCompare(String(a.saved)) || String(b.id).localeCompare(String(a.id))); }
  list(title) { const k = projectKey(title); return this.all().filter((x) => x.project === k); }

  save(title, name, text, { auto = false, now = new Date().toISOString() } = {}) {
    name = String(name || '').trim();
    if (!SNAP_NAME.test(name)) throw new Error('a name of 1 to 80 characters on one line');
    const id = `${now.replace(/[^0-9]/g, '').slice(0, 17)}-${(this.n++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.s.setItem(SNAP_PREFIX + id, text);          // throws when the storage is full
    const k = projectKey(title);
    let list = [...this.index(), { id, name, project: k, saved: now, auto: !!auto }];
    // the cap per project: the oldest automatic snapshot first, then the oldest
    const mine = () => list.filter((x) => x.project === k).sort((a, b) => String(a.saved).localeCompare(String(b.saved)));
    while (mine().length > this.cap) {
      const m = mine();
      const drop = m.find((x) => x.auto && x.id !== id) || m.find((x) => x.id !== id);
      list = list.filter((x) => x !== drop);
      try { this.s.removeItem(SNAP_PREFIX + drop.id); } catch { /* the index no longer names it */ }
    }
    try { this.writeIndex(list); } catch (e) { try { this.s.removeItem(SNAP_PREFIX + id); } catch { /* nothing kept */ } throw e; }
    return id;
  }

  load(id) { return this.s.getItem(SNAP_PREFIX + id); }

  remove(id) {
    this.s.removeItem(SNAP_PREFIX + id);
    this.writeIndex(this.index().filter((x) => x.id !== id));
  }
}
