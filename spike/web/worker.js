// Minimal engine worker: one blocking clingo run per message; stdout lines streamed in batches.
// Control channel (optional, needs cross-origin isolation): Int32Array on a SharedArrayBuffer,
//   ctl[0] = 0 run | 1 pause | 2 stop.  Lua polls it synchronously through io.read() -> Module.stdin.
let ctl = null, modPromise = null, batch = [], lastFlush = 0;
const flush = () => { if (batch.length) { postMessage({ type: 'lines', lines: batch }); batch = []; } lastFlush = performance.now(); };
const feed = [];
function stdin() {
  if (feed.length) return feed.shift();
  if (feed.done) { feed.done = false; return null; }          // end of this read
  flush();
  let cmd = 'go';
  if (ctl) {
    while (Atomics.load(ctl, 0) === 1) Atomics.wait(ctl, 0, 1); // paused: sleep until the flag changes
    if (Atomics.load(ctl, 0) === 2) cmd = 'stop';
  }
  for (const ch of cmd + '\n') feed.push(ch.charCodeAt(0));
  feed.done = true;
  return feed.shift();
}
async function load(mt) {
  const { default: factory } = await import(mt ? './vendor/clingo-mt.js' : './vendor/clingo.js');
  return factory({
    print: (l) => { batch.push(l); if (performance.now() - lastFlush > 50) flush(); },
    printErr: (l) => { batch.push('!! ' + l); },
    stdin,
  });
}
onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') { ctl = msg.sab ? new Int32Array(msg.sab) : null; const t0 = performance.now(); modPromise = load(msg.mt); await modPromise; postMessage({ type: 'ready', ms: Math.round(performance.now() - t0) }); return; }
  if (msg.type === 'run') {
    const m = await modPromise; const t0 = performance.now(); let status;
    try { status = m.ccall('run', 'number', ['string', 'string'], [msg.program, msg.options]); }
    catch (e) { status = 'TRAP ' + e; }
    flush();
    postMessage({ type: 'done', status, ms: Math.round(performance.now() - t0) });
  }
};
