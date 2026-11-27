// Generators (with Mine hard instances and the preview) of the Instances tab. These are methods of InstancesTab:
// js/instances-tab.js copies them onto its prototype, so `this` is the tab.
import { makeEditor } from './editors.js';
import { freshId, resolveInstance } from './instances.js';
import { generate, PARAM_TYPES, generatorConstants } from './generate.js';
import { mine } from './mine.js';
import { BatchStopped } from './control.js';
import { INSTANCE_ID } from './project.js';
import { h as el, $ } from './dom.js';
import { added, factsText, constText, parseConsts, partFold } from './instances-common.js';

export class GeneratorsPart {
  // ---- generators ------------------------------------
  get generators() { return this.app.project.generators || (this.app.project.generators = []); }
  get generator() { return this.generators.find((g) => g.name === this.gen) || null; }

  buildGenerators() {
    this.genSelect = el('select', { id: 'generator-select', 'aria-label': 'Generator' });
    this.genSelect.addEventListener('change', () => { this.gen = this.genSelect.value; this.clearGenResults(); this.renderGenerators(); });
    this.genName = el('input', { id: 'generator-name', size: 14, 'aria-label': 'Generator name' });
    this.genName.addEventListener('change', () => this.renameGenerator(this.genName.value));
    this.genParams = el('table', { class: 'internals-table', id: 'generator-params' });
    this.genConsts = el('input', { id: 'generator-constants', size: 24, placeholder: 'n=n, k=3', 'aria-label': 'Constants of its instances' });
    this.genConsts.addEventListener('change', () => this.setGenConstants(this.genConsts.value));
    this.genSeed = el('input', { id: 'generator-seed', size: 6, inputmode: 'numeric', value: '1', 'aria-label': 'First seed' });
    this.genStatus = el('p', { id: 'generator-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    this.preview = el('div', { id: 'generator-preview', class: 'generator-preview' });
    const box = el('div', { class: 'instance-editor', id: 'generator-editor' });
    this.genBody = el('div', { id: 'generator-body', hidden: true },
      el('div', { class: 'instance-fields' }, el('label', {}, 'Name ', this.genName),
        el('button', { class: 'control-button small-button', id: 'delete-generator-button', onclick: () => this.removeGenerator() }, 'Delete')),
      el('p', { class: 'note' }, 'ASP whose shown atoms are the instance. Draws: @flip(P, K...), @int(Lo, Hi, K...), @weighted((W1, ..., Wm), K...), ' +
        '@perm(N, I, K...), @subset(M, N, I, K...), @mallows(N, Phi, I, K...); P and Phi in thousandths. An unsatisfiable draw is redrawn.'),
      box,
      el('div', { class: 'table-wrapper' }, this.genParams),
      el('div', { class: 'instance-fields' }, el('label', { title: 'name=value, ...; a value that names a parameter takes its value' }, 'Constants of its instances ', this.genConsts)),
      el('p', { class: 'note' }, 'Given to every instance it makes (added to the instance\'s Constants): for example n=n passes the parameter n on as the constant n, k=3 a fixed value.'),
      el('div', { class: 'instances-bar' },
        el('button', { class: 'control-button small-button', id: 'add-param-button', onclick: () => this.addParam() }, 'Add parameter'),
        el('label', {}, 'Seed ', this.genSeed),
        el('button', { class: 'control-button', id: 'preview-button', onclick: () => this.previewSix() }, 'Preview 6'),
        el('button', { class: 'control-button', id: 'mine-button', onclick: () => this.mineHard(),
          title: 'Search 24 seeds of this generator (default parameters) for the instances with the most candidates per solution, then try removing single facts' }, 'Mine hard instances'),
        this.genClear = el('button', { class: 'control-button small-button', id: 'generator-clear-button', hidden: true, onclick: () => this.clearGenResults(),
          title: 'Remove the previewed or mined instances below (an edit of the generator removes them too)' }, 'Clear results')),
      this.genStatus, this.preview);
    this.genSummary = el('span', { class: 'note', id: 'generators-summary' });
    this.root.append(partFold('generators', 'Generators', this.genSummary,
      el('div', { class: 'instances-bar' }, this.genSelect,
        el('button', { class: 'control-button', id: 'add-generator-button', onclick: () => this.addGenerator() }, 'New generator')),
      this.genBody));
    this.genEditor = makeEditor(box, 'ace/mode/gringo');
    $('generators-part').addEventListener('toggle', () => { if ($('generators-part').open) this.genEditor.resize(true); });
    this.genEditor.on('change', () => {
      if (this.genLoading) return;
      const g = this.generator;
      if (g) { g.text = this.genEditor.getValue(); this.genEdited(); }
    });
  }

  renderGenerators() {
    const list = this.generators, g = this.generator;
    this.genSelect.textContent = '';
    this.genSelect.hidden = !list.length;
    for (const x of list) this.genSelect.append(el('option', { value: x.name }, x.name));
    if (g) this.genSelect.value = g.name;
    this.genBody.hidden = !g;
    this.genSummary.textContent = list.length ? list.map((x) => x.name).join(', ')
      : 'none: a generator writes random instances of the problem (preview, mine hard ones)';
    if (!g) return;
    this.genName.value = g.name;
    this.genConsts.value = constText(g.constants);
    this.genLoading = true;
    if (this.genEditor.getValue() !== g.text) this.genEditor.setValue(g.text || '', -1);
    this.genLoading = false;
    this.genParams.textContent = '';
    this.genParams.append(el('tr', {}, ...['Parameter', 'Type', 'Value', ''].map((h) => el('th', {}, h))));
    for (const [k, t] of Object.entries(g.params || {})) {
      const type = el('select', { 'aria-label': `Type of ${k}` }, ...PARAM_TYPES.map((x) => el('option', { value: x, selected: x === t }, x)));
      type.addEventListener('change', () => { g.params[k] = type.value; this.genEdited(); });
      const val = el('input', { size: 6, value: g.defaults && g.defaults[k] !== undefined ? String(g.defaults[k]) : '', 'aria-label': `Value of ${k}` });
      val.addEventListener('change', () => { g.defaults = { ...(g.defaults || {}), [k]: val.value.trim() === '' ? undefined : Number(val.value) }; this.genEdited(); });
      this.genParams.append(el('tr', {}, el('td', {}, k), el('td', {}, type), el('td', {}, val),
        el('td', {}, el('button', { class: 'control-button small-button', onclick: () => { delete g.params[k]; if (g.defaults) delete g.defaults[k]; this.renderGenerators(); this.genEdited(); } }, 'Remove'))));
    }
    requestAnimationFrame(() => this.genEditor.resize());
  }

  // The previewed or mined instances are of the generator as it was: an edit removes them.
  genEdited() { this.clearGenResults(); this.app.dirty(); }
  clearGenResults() {
    this.preview.textContent = '';
    this.genStatus.textContent = '';
    this.genEditor.getSession().setAnnotations([]);
    this.genClear.hidden = true;
  }
  showGenClear() { this.genClear.hidden = !this.preview.childElementCount; }

  addGenerator() {
    let name = 'gen';
    for (let i = 2; this.generators.some((g) => g.name === name); i++) name = `gen${i}`;
    this.generators.push({ name, text: '% one fact per node; each edge with probability p/1000\nnode(1..n).\nedge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.\n#show node/1.  #show edge/2.\n',
      params: { n: 'int', p: 'permille' }, defaults: { n: 5, p: 500 } });
    this.gen = name;
    this.clearGenResults();
    this.renderGenerators();
    this.app.dirty();
  }

  removeGenerator() {
    const i = this.generators.findIndex((g) => g.name === this.gen);
    if (i < 0) return;
    this.generators.splice(i, 1);
    this.gen = this.generators.length ? this.generators[0].name : null;
    this.preview.textContent = '';
    this.renderGenerators();
    this.app.dirty();
  }

  renameGenerator(v) {
    const g = this.generator;
    v = v.trim();
    if (!g || v === g.name) return;
    if (!INSTANCE_ID.test(v) || this.generators.some((x) => x.name === v)) { this.genStatus.textContent = `"${v}" is not a valid new name.`; this.genName.value = g.name; return; }
    for (const x of this.list) if (x.recipe && x.recipe.generator === g.name) x.recipe.generator = v;
    g.name = v; this.gen = v;
    this.renderGenerators();
    this.app.dirty();
  }

  setGenConstants(v) {
    const g = this.generator;
    if (!g) return;
    let c;
    try { c = parseConsts(v); } catch (e) { this.genStatus.textContent = `Constants: ${e.message}`; return; }
    for (const k of Object.keys(c)) if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) { this.genStatus.textContent = `Constants: ${k} must start with a lower case letter.`; return; }
    if (Object.keys(c).length) g.constants = c; else delete g.constants;
    this.genStatus.textContent = '';
    this.app.dirty();
  }

  // A recipe instance becomes a fixed one: its facts generated now and kept as text, with the
  // generator's constants added to its own.
  async writeOutFacts() {
    const x = this.list.find((i) => i.id === this.current);
    if (!x || !x.recipe || !this.app.ready || this.app.engine.active) return;
    let r;
    try { r = await resolveInstance(this.app.project, x.id, (p, o) => this.app.engine.exec(p, o), this.app.genLua()); }
    catch (e) { this.say(`Not written out: ${e.message || e}`, true); return; }
    x.facts = factsText(r.facts);
    x.constants = r.constants;
    delete x.mutations;
    this.render();
    this.showForm();
    this.app.dirty();
    this.say(`Wrote out the facts of ${x.id}: they are its own now.`);
  }

  addParam() {
    const g = this.generator;
    if (!g) return;
    const k = (window.prompt('Parameter name (a lower case letter first):') || '').trim();
    if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) return;
    g.params = { ...(g.params || {}), [k]: 'int' };
    this.renderGenerators();
    this.genEdited();
  }

  // Six instances from seeds s..s+5, each with its attempt number and label.
  // Mining (FUTURE-DIRECTIONS D8, js/mine.js): the hardest instances of this generator for the
  // loop as it is, by candidates per solution; each can be added as a recipe instance.
  async mineHard() {
    const g = this.generator;
    if (!g) return;
    const c = this.app.control;
    const b = c.beginBatch('mining');
    if (!b) return;
    const app = this.app;
    const env = { engineRun: c.batchExec(b), runtime: app.runtime, modules: app.modules, luaTexts: app.genLua() };
    this.preview.textContent = '';
    this.genStatus.textContent = 'Mining…';
    let r;
    try {
      r = await mine(structuredClone(app.collect()), { source: { generator: g.name, grid: {}, seeds: 24 }, objective: 'candidates-per-solution',
        budget: 48, keep: 5, seconds: 1, rounds: 2, mutations: 6, env,
        onProgress: (x) => { c.batchProgress(`${x.runs} runs`); this.genStatus.textContent = `Mining: stage ${x.stage}, ${x.runs} runs (${x.instance})…`; } });
    } catch (e) {
      this.genStatus.textContent = e instanceof BatchStopped || b.cancelled ? 'Mining stopped.' : `Mining failed: ${e.message || e}`;
      return;
    } finally { c.endBatch(b); }
    this.genStatus.textContent = `Mined ${r.runs} runs: the ${r.best.length} hardest instances, by candidates per solution.`;
    for (const x of r.best) {
      const card = el('div', { class: 'generator-card mined', 'data-mined': x.id });
      card.append(el('p', {}, `${x.id}: ${x.score.toFixed(2)} candidates per solution (${x.res ? `${x.res.candidates} candidates, ${x.res.solutions} solutions, ${x.res.outcome}` : 'no run'})` +
        `${x.instance.mutations && x.instance.mutations.length ? `; ${x.instance.mutations.length} facts removed` : ''}`),
        el('button', { class: 'control-button small-button', onclick: async () => {
          const inst = { ...structuredClone(x.instance), id: freshId(this.app.project, x.id) };
          // a fixed instance: its facts (with the removals) as text, the generator's constants added
          try {
            const r = await resolveInstance({ ...this.app.project, instances: [inst] }, inst.id, (p, o) => this.app.engine.exec(p, o), this.app.genLua());
            inst.facts = factsText(r.facts);
            inst.constants = r.constants;
            delete inst.mutations;
          } catch (e) { this.genStatus.textContent = `Not added: ${e.message || e}`; return; }
          const id = this.add(inst);
          added(card, id);
          this.genStatus.textContent = `Added instance ${id} (tag hard).`;
        } }, 'Add as instance'));
      this.preview.append(card);
    }
    this.showGenClear();
  }

  async previewSix() {
    const g = this.generator;
    if (!g || !this.app.ready || this.app.engine.active) return;
    const s0 = Math.trunc(Number(this.genSeed.value)) || 0;
    const seeds = [0, 1, 2, 3, 4, 5].map((i) => s0 + i);
    this.genStatus.textContent = 'Generating…';
    this.preview.textContent = '';
    let res;
    try { res = await generate(g, {}, seeds, this.app.genLua(), (p, o) => this.app.engine.exec(p, o)); }
    catch (e) { this.genStatus.textContent = `Not generated: ${e.message || e}`; return; }
    if (res.problems.length) {
      const p = res.problems[0];
      this.genStatus.textContent = `Not generated: ${p.line ? `line ${p.line}: ` : ''}${p.message}`;
      if (p.line) this.genEditor.getSession().setAnnotations(res.problems.filter((x) => x.line).map((x) => ({ row: x.line - 1, column: (x.col || 1) - 1, text: x.message, type: 'error' })));
      return;
    }
    this.genEditor.getSession().setAnnotations([]);
    const tried = res.results.filter((r) => !r.error).reduce((a, r) => a + r.attempt + 1, 0);
    const ok = res.results.filter((r) => !r.error).length;
    this.genStatus.textContent = ok ? `${ok} instances, ${ok} accepted of ${tried} draws.` : 'No instance.';
    for (const r of res.results) {
      const card = el('div', { class: 'generator-card', 'data-seed': String(r.seed) });
      if (r.error) card.append(el('p', { class: 'error' }, `Seed ${r.seed}: ${r.error}`));
      else {
        const params = Object.fromEntries(Object.keys(g.params || {}).filter((k) => g.defaults && g.defaults[k] !== undefined).map((k) => [k, g.defaults[k]]));
        const constants = generatorConstants(g, params);
        card.append(
          el('p', {}, `Seed ${r.seed}, attempt ${r.attempt}, `, el('span', { class: r.exact ? 'label-exact' : 'label-completed' }, r.exact ? 'exact' : 'solver-completed')),
          el('pre', { class: 'generator-facts' }, r.facts.split(' ').join('\n')),
          el('button', { class: 'control-button small-button', onclick: () => {
            const id = freshId(this.app.project, `${g.name}-s${r.seed}`);
            // a fixed instance: the facts as text (the recipe says where they came from)
            this.add({ id, facts: factsText(r.facts), recipe: { generator: g.name, params, seed: r.seed }, constants, tags: ['generated'] });
            added(card, id);
            this.say(`Added instance ${id} (generated by ${g.name}, seed ${r.seed}${constText(constants) ? `; constants ${constText(constants)}` : ''}).`);
          } }, 'Add as instance'));
      }
      this.preview.append(card);
    }
    this.showGenClear();
  }
}
