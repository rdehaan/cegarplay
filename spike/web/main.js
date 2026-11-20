const log = (...a) => { const s = a.join(' '); document.getElementById('log').textContent += s + '\n'; console.log(s); };
const results = (window.__results = {});
function spawn({ mt = false, sab = null } = {}) {
  const w = new Worker('./worker.js', { type: 'module' });
  const h = { w, lines: [], onLines: null };
  h.ready = new Promise((res) => { h._ready = res; });
  w.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'ready') h._ready(d.ms);
    else if (d.type === 'lines') { h.lines.push(...d.lines); h.onLines && h.onLines(d.lines); }
    else if (d.type === 'done') h._done && h._done(d);
  };
  w.onerror = (e) => { log('worker error: ' + e.message); h._done && h._done({ status: 'WORKER-ERROR ' + e.message, ms: -1 }); };
  h.run = (program, options) => new Promise((res) => { h.lines = []; h._done = res; w.postMessage({ type: 'run', program, options }); });
  w.postMessage({ type: 'init', mt, sab });
  return h;
}
const get = async (u) => (await fetch(u)).text();
const pick = (lines, re) => lines.filter((l) => re.test(l));

async function main() {
  const gc6 = await get('./gc6_standalone.lp'), gc7 = await get('./gc7_standalone.lp');
  results.crossOriginIsolated = self.crossOriginIsolated;
  log('crossOriginIsolated =', self.crossOriginIsolated);

  // A. full CEGAR run in a module worker
  let h = spawn(); const loadMs = await h.ready;
  let r = await h.run(gc6, '-Wnone 0 -q');
  results.A = { loadMs, runMs: r.ms, status: r.status, stats: pick(h.lines, /CEGAR-STATS|^Models/) };
  log('A. gc6 in worker:', JSON.stringify(results.A));

  // B. hard abort: terminate mid-run, then respawn
  let seen = 0; h.onLines = (ls) => { seen += ls.length; };
  const prog7 = gc7.replace('stats.check_calls = stats.check_calls + 1', 'stats.check_calls = stats.check_calls + 1\n  if stats.check_calls % 2000 == 0 then print("@@progress checks=" .. stats.check_calls .. " refinements=" .. stats.refinements) end');
  const p = h.run(prog7, '-Wnone 0 -q');
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = performance.now(); h.w.terminate(); const last = h.lines[h.lines.length - 1];
  h = spawn(); const respawnMs = await h.ready; r = await h.run('{a;b}.', '0 -q -V0');
  results.B = { progressLinesBeforeAbort: seen, lastProgress: last, respawnAndReadyMs: Math.round(performance.now() - t0), workerReportedInitMs: respawnMs, statusAfterRespawn: r.status };
  log('B. hard abort:', JSON.stringify(results.B));

  // C. pause / resume / soft stop through SharedArrayBuffer + io.read() poll (needs cross-origin isolation)
  if (self.crossOriginIsolated) {
    const sab = new SharedArrayBuffer(8), ctl = new Int32Array(sab);
    const hc = spawn({ sab }); await hc.ready;
    const prog = gc7
      .replace('stats.check_calls = stats.check_calls + 1', 'stats.check_calls = stats.check_calls + 1\n  if stats.check_calls % 500 == 0 then print("@@progress checks=" .. stats.check_calls); if io.read("l") == "stop" then STOPPED = true; PRG:interrupt(); return end end')
      .replace('function main(prg)', 'function main(prg)\n  PRG = prg')
      .replace('print(string.format("CEGAR-STATS', 'print("@@stopped=" .. tostring(STOPPED))\n  print(string.format("CEGAR-STATS');
    const stamps = []; hc.onLines = (ls) => ls.forEach((l) => l.startsWith('@@progress') && stamps.push([Math.round(performance.now()), l]));
    const done = hc.run(prog, '-Wnone 0 -q');
    await new Promise((r) => setTimeout(r, 600));
    Atomics.store(ctl, 0, 1);                                   // pause
    await new Promise((r) => setTimeout(r, 300)); const nAtPause = stamps.length;
    await new Promise((r) => setTimeout(r, 700)); const nAfterPause = stamps.length;   // must not advance while paused
    Atomics.store(ctl, 0, 0); Atomics.notify(ctl, 0);            // resume
    await new Promise((r) => setTimeout(r, 500)); const nAfterResume = stamps.length;
    Atomics.store(ctl, 0, 2); Atomics.notify(ctl, 0);            // soft stop
    const rc = await done;
    results.C = { nAtPause, nAfterPause, nAfterResume, status: rc.status, tail: pick(hc.lines, /@@stopped|CEGAR-STATS|^Models|INTERRUPT/) };
    log('C. pause/resume/soft-stop:', JSON.stringify(results.C));

    // D. threaded build with the Lua propagator
    const hd = spawn({ mt: true }); const mtLoad = await hd.ready;
    const rd = await hd.run(gc6, '-Wnone 0 -q -t 2');
    results.D = { mtLoad, runMs: rd.ms, status: rd.status, stats: pick(hd.lines, /CEGAR-STATS|^Models|Threads|!!/) };
    log('D. threads (-t 2):', JSON.stringify(results.D));
  }
  results.finished = true;
}
main().catch((e) => { log('FAILED ' + (e.stack || e)); results.error = String(e); results.finished = true; });
