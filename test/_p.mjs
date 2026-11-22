import * as H from './helpers.mjs';
const p = H.example('tutorial-first-run'); p.settings = { ...p.settings, solutions: 0, trace: 0, record: { steps: 'all', n: 0, calls: false, proof: true } };
const r = await H.runProject(p);
console.log(H.done(r), H.ofKind(r, 'Q')[0].atoms.length, r.out.filter(l => l.startsWith('@@R') && l.includes('"k":"r"')).slice(0, 2), r.out.filter(l => l.startsWith('@@R')).length);
