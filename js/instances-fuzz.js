// Fuzz (and saving its instance) of the Instances tab. These are methods of InstancesTab:
// js/instances-tab.js copies them onto its prototype, so `this` is the tab.
import { freshId } from './instances.js';
import { fuzz, shrinkInstance, diagnose, defaultSource, auditOf, symbolicOf } from './fuzz.js';
import { BatchStopped } from './control.js';
import { applyVariant } from './project.js';
import { resultCard } from './result-card.js';
import { h as el } from './dom.js';
import { FUZZ_WHAT, fuzzSourceText } from './instances-common.js';

export class FuzzPart {
  // ---- fuzz ----------------------------------------------
  async fuzz() {
    const app = this.app;
    if (this.fuzzing) return;
    const b = app.control.beginBatch('fuzz');
    if (!b) return;
    this.fuzzing = true;
    // every engine call of Fuzz goes through the batch: Stop or Abort ends it at the next call
    const env = { engineRun: app.control.batchExec(b), runtime: app.runtime, modules: app.modules, luaTexts: app.genLua() };
    // the variant picked in the top bar (its 'reference' variant, if any, stays available)
    const project = applyVariant(structuredClone(app.collect()), app.variants ? app.variants.selected() || undefined : undefined);
    const suite = (project.suites || []).find((s) => s.instances && (s.instances.generator || s.instances.constants));
    // smallest first: a grid 1..v over the numeric constants, else a suite's grid, else the instances
    const def = defaultSource(project);
    const source = def.constants ? def : suite ? suite.instances : def;
    this.fuzzCard.hidden = true;
    // what Fuzz goes over, said in the card whatever comes out
    const variant = app.variants ? app.variants.selected() : '';
    this.fuzzWhat = `${fuzzSourceText(source, project, suite)}, ${variant ? `with the variant ${variant}` : 'with no variant'} (the top bar's)`;
    const seen = [];
    try {
      this.say('Fuzz: auditing instances from small to large…');
      const r = await fuzz(project, { source, env, onProgress: (x) => { seen.push(x); this.say(`Fuzz: ${x.tried} of ${x.total} instances (${x.instance}: ${x.verdict})…`); } });
      if (!r.found) { this.showFuzzNone(r, seen); this.say(`Fuzz: no unsound instance among ${r.tried}${r.skipped ? ` (${r.skipped} skipped)` : ''}; see the card below.`); return; }
      if (r.mode !== 'audit') {
        resultCard(this.fuzzCard, { verdict: 'unsound', title: 'Fuzz: an instance where the loop and the reference differ',
          paragraphs: [FUZZ_WHAT, `Tried: ${this.fuzzWhat}.`, `On ${r.found.instance.id} the loop finds ${r.found.counts[0]} solutions and the variant "reference" ${r.found.counts[1]} (${r.note}).`] });
        this.say(`Fuzz: instance ${r.found.instance.id} gives ${r.found.counts[0]} solutions against ${r.found.counts[1]} with the reference.`, true);
        return;
      }
      this.say(`Fuzz: ${r.found.instance.id} is unsound; shrinking…`);
      // an instance that only the symbolic audit could judge is shrunk with it too
      const judge = r.found.verdict && r.found.verdict.mode === 'symbolic' ? symbolicOf : auditOf;
      const s = await shrinkInstance(r.found.project, env, { judge, onStep: (items, tests) => this.say(`Fuzz: shrinking, ${items.length} facts after ${tests} audits…`) });
      if (s.error || !s.verdict) { this.say(`Fuzz: ${r.found.instance.id} is unsound; shrinking failed (${s.error || 'no verdict'}).`, true); return; }
      const dg = await diagnose(s.project, s.verdict, env);
      this.showFuzz(r.found, s, dg);
      this.say('Fuzz: done; the card below says what it found.');
    } catch (e) {
      if (e instanceof BatchStopped || b.cancelled) this.say('Fuzz: stopped.');
      else this.say(`Fuzz stopped: ${e.message || e}`, true);
    } finally { this.fuzzing = false; app.control.endBatch(b); }
  }

  // Fuzz found nothing: say so in a card, with what it tried
  showFuzzNone(r, seen) {
    const count = (v) => seen.filter((x) => x.verdict === v).length;
    const sound = count('sound') + count('same');
    resultCard(this.fuzzCard, {
      verdict: r.tried ? 'sound' : 'limit',
      title: r.tried ? 'Fuzz: no unsound instance found' : 'Fuzz: nothing to try',
      paragraphs: [FUZZ_WHAT, `Tried: ${this.fuzzWhat}.`,
        r.tried ? `${r.tried} instance${r.tried === 1 ? '' : 's'}: ${sound} sound${r.skipped ? `, ${r.skipped} skipped (too large, out of budget, or an error)` : ''}. ` +
          'The loop loses no solution on any of them. This says nothing about other or larger instances: a space (below) covers every instance up to a bound.'
          : 'No instance to audit.',
        ...(r.note ? [`Note: ${r.note}.`] : [])],
      content: seen.length ? [el('p', { class: 'note', id: 'fuzz-tried' }, seen.map((x) => `${x.instance}: ${x.verdict}`).join(' · '))] : [],
    });
  }

  showFuzz(found, s, dg) {
    const w = s.verdict.witness || {};
    const step = dg.step ? `step ${dg.step.i} (${{ r: 'reject', a: 'add', e: 'expand' }[dg.step.k] || dg.step.k})` : dg.culprit ? `expansion ${dg.culprit}` : null;
    const consts = Object.entries(s.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
    // an instance of the constants grid is named by its values (n = 2), not by its id (n2)
    const at = found.params && Object.keys(found.params).length && !found.instance.facts
      ? Object.entries(found.params).map(([k, v]) => `${k} = ${v}`).join(', ') : found.instance.id;
    resultCard(this.fuzzCard, {
      verdict: 'unsound',
      title: 'Fuzz: an unsound instance',
      paragraphs: [FUZZ_WHAT, `Tried: ${this.fuzzWhat}.`,
        `Unsound at ${at}; ${s.from ? `shrunk from ${s.from} facts to the ${s.facts.length} below` : 'no facts to shrink'}${consts ? ` (constants ${consts})` : ''}; ${s.tests} audit${s.tests === 1 ? '' : 's'}.`],
      content: [el('pre', { id: 'fuzz-facts' }, s.facts.join('\n') || '(no facts)'),
        el('p', {}, `Lost solution {${(w.solution || []).join(' ')}}; the audit's witness: candidate {${(w.candidate || []).join(' ')}}, counterexample [${w.counterexample || ''}]` +
          (w.relevant ? `, relevant {${w.relevant.join(' ')}}` : '') + '.'),
        el('p', { id: 'fuzz-culprit' }, step ? `The loop's own run loses it at ${step}.` : 'The loop\'s own run does not lose this solution (its search order avoids the bad refinement here); the witness shows the unsound pair.')],
      actions: [
        { name: 'trace', id: 'fuzz-trace', label: 'Open in trace', title: 'Run the loop on the small instance and open the trace', onClick: () => this.fuzzAction('trace', s) },
        { name: 'audit', id: 'fuzz-witness', label: 'Show audit witness', title: 'Audit the small instance (Output tab)', onClick: () => this.fuzzAction('audit', s) },
        { name: 'save', id: 'fuzz-save', label: 'Save as regression instance', title: 'Keep the small instance, with its true count when there is one', onClick: () => this.fuzzAction('save', s) },
        ...(step ? [] : [{ name: 'sweep', id: 'fuzz-sweep', label: 'Find a run that loses it',
          title: 'Save the small instance, then run it with a randomized search for seeds 1 to 50 until a run loses a solution, and show that run in the candidate space',
          onClick: () => this.app.sweepAndShow({ instance: this.fuzzSave(s), target: Number.isInteger(s.verdict.solutions) ? s.verdict.solutions : null }) }]),
      ],
    });
  }


  fuzzSave(s) {
    if (this.fuzzSaved && this.list.some((x) => x.id === this.fuzzSaved)) return this.fuzzSaved;
    const id = freshId(this.app.project, 'regression');
    const constants = Object.fromEntries(Object.entries(s.constants || {}).filter(([k, v]) => this.app.project.settings.constants[k] !== v));
    // the symbolic audit gives no solution count: then no expected count
    const expected = Number.isInteger(s.verdict.solutions) ? { expected: { solutions: s.verdict.solutions } } : {};
    this.add({ id, facts: s.facts.join('\n') + '\n', constants, ...expected, tags: ['regression'] });
    this.fuzzSaved = id;
    return id;
  }

  async fuzzAction(what, s) {
    const id = this.fuzzSave(s);
    if (what === 'save') { this.say(Number.isInteger(s.verdict.solutions) ? `Saved instance ${id} with its true count ${s.verdict.solutions} (tag regression).` : `Saved instance ${id} (tag regression).`); return; }
    const tab = document.getElementById(what === 'trace' ? 'tab5' : 'tab1');
    await this.app.control.run(what === 'audit' ? { mode: 'audit', instance: id } : { instance: id });
    if (tab) { tab.checked = true; tab.dispatchEvent(new Event('change')); }
  }
}
