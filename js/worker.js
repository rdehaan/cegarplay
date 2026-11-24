// Engine worker: one clingo-wasm instance; one blocking run per message; output streamed in batches.
// Control word (cross-origin isolated pages only): Int32Array on a SharedArrayBuffer,
//   0 run | 1 pause | 2 stop | 3 step (one read through, then back to 1; the page no longer sends
//   it since its Step button went). The runtime polls it through io.read() -> stdin.
// On a pause the first read answers 'pause' (the runtime then sends fresh statistics) and the
// next read blocks.
let control = null, module = null, out = [], err = [], lastFlush = 0, runId = null;

function flush() {
  if (out.length || err.length) { postMessage({ type: 'lines', id: runId, out, err }); out = []; err = []; }
  lastFlush = performance.now();
}

// stdin: answer 'go' or 'stop' once per io.read("l"); return null after the newline, or
// Emscripten keeps reading.
const feed = [];
let announced = false;
function stdin() {
  if (feed.length) return feed.shift();
  if (feed.done) { feed.done = false; return null; }
  flush();
  let cmd = 'go';
  if (control) {
    if (Atomics.load(control, 0) === 1 && !announced) { announced = true; cmd = 'pause'; }
    else {
      while (Atomics.load(control, 0) === 1) Atomics.wait(control, 0, 1);
      announced = false;
      const v = Atomics.load(control, 0);
      if (v === 2) cmd = 'stop';
      else if (v === 3) Atomics.compareExchange(control, 0, 3, 1);     // one step, then paused
    }
  }
  for (const ch of cmd + '\n') feed.push(ch.charCodeAt(0));
  feed.done = true;
  return feed.shift();
}

async function load(threads) {
  const url = threads ? '../vendor/clingo-wasm/clingo-mt.js' : '../vendor/clingo-wasm/clingo.js';
  const { default: factory } = await import(url);
  return factory({
    print: (l) => { out.push(l); if (performance.now() - lastFlush > 50) flush(); },
    printErr: (l) => { err.push(l); if (performance.now() - lastFlush > 50) flush(); },
    stdin,
  });
}

let ready = null;
onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    control = msg.control ? new Int32Array(msg.control) : null;
    const t0 = performance.now();
    ready = load(!!msg.threads);
    try { module = await ready; } catch (e) { postMessage({ type: 'failed', message: String(e) }); return; }
    postMessage({ type: 'ready', ms: Math.round(performance.now() - t0), threads: !!msg.threads });
    return;
  }
  if (msg.type === 'run') {
    if (!module) module = await ready;
    runId = msg.id;
    out = []; err = []; feed.length = 0; feed.done = false;
    lastFlush = performance.now();
    const t0 = performance.now();
    let status, message;
    try { status = module.ccall('run', 'number', ['string', 'string'], [msg.program, msg.options || '']); }
    catch (e) { status = 'trap'; message = String(e && e.message || e); }
    flush();
    postMessage({ type: 'done', id: msg.id, status, message, ms: Math.round(performance.now() - t0) });
  }
};
