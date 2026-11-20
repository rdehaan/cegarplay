// Internals tab: engine facts, generated Lua, raw event lines.
import { makeEditor } from './editors.js';

const MAX_RAW = 2000;

export class Internals {
  constructor(app) {
    this.app = app;
    this.lua = makeEditor(document.getElementById('generated-lua'), 'ace/mode/lua', { readOnly: true });
    this.rawEl = document.getElementById('raw-events');
    this.lines = [];
    this.facts();
  }

  facts() {
    const app = this.app, e = app.engine;
    const rows = [
      ['Engine', app.engineVersion || '…'],
      ['Build', e.threads ? 'clingo-mt (threads)' : 'clingo (single thread)'],
      ['Cross-origin isolated', e.isolated ? 'yes' : 'no'],
      ['Pause, step and stop', e.isolated && e.control ? 'available' : 'not available (page not isolated)'],
      ['Worker start-up', e.readyMs == null ? '…' : `${e.readyMs} ms`],
    ];
    const t = document.getElementById('engine-facts');
    t.innerHTML = '';
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.textContent = k;
      const td = document.createElement('td'); td.textContent = v;
      tr.append(th, td);
      t.append(tr);
    }
  }

  program(project, compiled, assembled) {
    this.lines = [];
    this.rawEl.textContent = '';
    this.pending = [];
    const text = compiled ? compiled.lua : project.loop.text;
    this.lua.setValue(text, -1);
    const n = assembled.program.split('\n').length;
    document.getElementById('program-size').textContent =
      `Assembled program: ${assembled.program.length.toLocaleString('en-US')} characters, ${n.toLocaleString('en-US')} lines; ` +
      `the loop runs from line ${assembled.loopStartLine} to ${assembled.loopEndLine}.`;
    this.facts();
  }

  header() { this.facts(); }

  raw(line) {
    if (this.lines.length >= MAX_RAW) return;
    this.lines.push(line);
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.rawEl.textContent = this.lines.join('\n') + (this.lines.length >= MAX_RAW ? `\n(capped at ${MAX_RAW} lines)` : '');
    });
  }
}
