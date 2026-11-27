// Phase 4: browser smoke tests (spec-app.md section 8) on the plain server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

test('1. the page loads with no console error and no request to another origin', async () => {
  const { page, context, errors, foreign } = await B.openPage(browser, server);
  assert.equal(await B.runState(page), 'idle');
  assert.equal(await page.isHidden('#pause-button'), true, 'pause is hidden on a page that is not isolated');
  for (const t of [2, 3, 4, 5, 6]) await page.click(`label[for="tab${t}"]`);
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  await context.close();
});

test('2. the default example runs to the reference numbers', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring');
  assert.equal(await page.$eval('#solutions-select', (e) => e.value), '0');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  const live = await page.textContent('#live-line');
  assert.match(live, /10,698 solutions/);
  assert.match(live, /31,776 candidates · 21,078 counterexamples · 21,078 refinements/);
  assert.equal(await page.$$eval('#solutions li', (l) => l.length), 1000);
  // the download holds all solutions, not only the 1,000 shown
  await page.click('label[for="tab5"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download-solutions-button')]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cegarplay-')), dl.suggestedFilename());
  await dl.saveAs(file);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 10698);
  assert.match(lines[10697], /^10698: .*edge\(/);
  assert.equal(new Set(lines.map((l) => l.replace(/^\d+: /, ''))).size, 10698, 'all different');
  assert.deepEqual(errors, []);
  await context.close();
});

test('3. abort a long run, then run the default example again', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring');
  await page.click('label[for="tab4"]');
  await page.fill('#constants-table tbody tr input.const-value', '7');
  await page.click('#run-button');
  await B.waitState(page, ['running']);
  await page.waitForTimeout(1000);
  await page.click('#abort-button');
  assert.equal(await B.waitState(page, ['aborted', 'finished', 'error']), 'aborted');
  const live = await page.textContent('#live-line');
  const cand = Number((/([\d,]+) candidates/.exec(live) || [0, '0'])[1].replace(/,/g, ''));
  assert.ok(cand > 0, live);
  await page.click('label[for="tab1"]');
  page.once('dialog', (d) => d.accept());     // the constant was edited: confirm replacing the project
  await B.openLibrary(page);
  await page.click('#library [data-load-example="graph-coloring"]');
  await page.waitForFunction(() => /Loaded/.test(document.getElementById('load-status').textContent));
  // the results of the aborted run are gone
  assert.equal(await B.waitState(page, ['idle'], 5000), 'idle');
  assert.equal((await page.textContent('#live-line')).trim(), '');
  assert.equal(await page.textContent('#result-line'), 'No run yet.');
  const t0 = Date.now();
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  assert.match(await page.textContent('#live-line'), /10,698 solutions/);
  assert.ok(Date.now() - t0 < 30000);
  assert.deepEqual(errors, []);
  await context.close();
});

test('4b. a run that does not start leaves the earlier results marked as still shown', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-first-run');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['error', 'finished']), 'finished');
  assert.match(await page.textContent('#shown-line'), /^Shown: the run/);
  const text = await B.getEditor(page, 'editor-check');
  await B.setEditor(page, 'editor-check', 'a :- b\nc.\n' + text);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['error', 'finished', 'running']), 'error');
  assert.match(await page.textContent('#shown-line'), /^Still shown \(the new run did not start\): the run/);
  assert.equal(await page.$eval('#shown-line', (e) => e.dataset.state), 'stale');
  await B.setEditor(page, 'editor-check', text);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['error', 'finished']), 'finished');
  assert.match(await page.textContent('#shown-line'), /^Shown: the run/);
  await context.close();
});

test('4. a syntax error in a fragment: annotation, status error, no run', async () => {
  const { page, context } = await B.openPage(browser, server);
  const text = await B.getEditor(page, 'editor-check');
  await B.setEditor(page, 'editor-check', 'a :- b\nc.\n' + text);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['error', 'finished', 'running']), 'error');
  const anns = await page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations());
  assert.equal(anns.length, 1);
  assert.equal(anns[0].row, 1);
  assert.match(anns[0].text, /syntax error/);
  assert.equal(await page.$eval('label[for="tab3"]', (e) => e.classList.contains('has-problem')), true);
  assert.equal((await page.textContent('#live-line')).trim(), '');
  assert.match(await page.textContent('#result-line'), /Not started/);
  assert.equal(await page.isVisible('#run-message'), true);
  assert.match(await page.textContent('#run-message-text'), /fragment check, line 2: syntax error/);
  // editing clears the annotation
  await B.setEditor(page, 'editor-check', text);
  assert.equal(await page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations().length), 0);
  await context.close();
});

test('5. download JSON, reload (autosave restores), upload: all editors equal', async () => {
  const { page, context } = await B.openPage(browser, server);
  await B.setEditor(page, 'editor-shared', '% changed\n' + await B.getEditor(page, 'editor-shared'));
  await B.setEditor(page, 'loop-editor', (await B.getEditor(page, 'loop-editor')).replace('search A:', '# a comment\nsearch A:'));
  const ids = await page.$$eval('#fragments .editor, #loop-editor', (l) => l.map((e) => e.id));
  const before = {};
  for (const id of ids) before[id] = await B.getEditor(page, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), B.projectMenu(page, 'download-button', { history: false })]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cegarplay-')), dl.suggestedFilename());
  await dl.saveAs(file);
  assert.equal(path.basename(file), 'sum-free-sets.json');
  // a reload restores the project being edited (autosave in localStorage) ...
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  for (const id of ids) assert.equal(await B.getEditor(page, id), before[id], 'restored ' + id);
  assert.match(await page.$eval('#load-status', (e) => e.textContent), /Restored/);
  // ... ?fresh=1 starts from the default example
  await page.goto(page.url() + '&fresh=1');
  await page.waitForSelector('body[data-ready="true"]');
  assert.notEqual(await B.getEditor(page, 'editor-shared'), before['editor-shared']);
  await page.setInputFiles('#file-input', file);
  await page.waitForFunction(() => /Loaded/.test(document.getElementById('upload-status').textContent));
  for (const id of ids) assert.equal(await B.getEditor(page, id), before[id], id);
  await context.close();
});

test('URL parameters: ?example=nash and ?tab=4', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=nash&tab=4');
  assert.equal(await page.isVisible('#section-loop'), true);
  assert.equal(await page.isVisible('#section-control'), false);
  assert.match(await B.getEditor(page, 'editor-abstraction'), /Nash equilibrium/);
  assert.equal(await page.isVisible('label[for="tab7"]'), false);
  assert.deepEqual(errors, []);
  await context.close();
  const o = await B.openPage(browser, server, '?internals=true&tab=7');
  assert.equal(await o.page.isVisible('#section-internals'), true);
  await o.context.close();
});

test('the library: groups from library.json, filter, ?example=, copy link, unknown id', async () => {
  const lib = JSON.parse(fs.readFileSync(new URL('../../examples/library.json', import.meta.url), 'utf8'));
  const { page, context, errors } = await B.openPage(browser, server, '?example=lang-basics&tab=4');
  assert.match(await B.getEditor(page, 'loop-editor'), /count refinements/);
  await page.click('label[for="tab1"]');
  // Home shows the library open, its groups folded, and its intro behind the "?"
  assert.deepEqual(await page.$$eval('#library-section, .library-group', (l) => l.filter((d) => d.open).map((d) => d.id)), ['library-section']);
  assert.equal(await page.isVisible('#library-help'), false);
  await page.click('#library-help-button');
  assert.equal(await page.isVisible('#library-help'), true);
  assert.equal(await page.$eval('#library-section', (d) => d.open), true, 'the "?" does not fold the library');
  await B.openLibrary(page);
  assert.equal(await page.$$eval('#library .library-group:not([data-group="projects"]) .library-entry', (l) => l.length), lib.examples.length);
  // the Projects group lists the examples with a readme again (FUTURE-DIRECTIONS E3)
  assert.equal(await page.$$eval('#library .library-group[data-group="projects"] .library-entry', (l) => l.length), lib.examples.filter((e) => e.tags.includes('project')).length);
  assert.equal(await page.$eval('#library .library-entry.loaded', (e) => e.dataset.example), 'lang-basics');
  assert.equal(await page.isVisible('#project-readme'), false, 'no readme');
  await page.fill('#library-filter', 'shape4');
  const shown = await page.$$eval('#library .library-entry', (l) => l.filter((e) => !e.hidden).map((e) => e.dataset.example));
  assert.ok(shown.includes('gc-shape4') && !shown.includes('nash'), shown.join());
  await page.fill('#library-filter', '');
  // levels and the learning path (F2): level 4 only; then what a reader of chapters 1-3 can read
  await page.selectOption('#library-level', '4');
  const lvl = await page.$$eval('#library .library-entry', (l) => l.filter((e) => !e.hidden).map((e) => e.dataset.example));
  assert.ok(lvl.includes('marco') && !lvl.includes('qbf'), lvl.join());
  await page.selectOption('#library-level', '');
  await page.selectOption('#library-read', '3');
  const readable = await page.$$eval('#library .library-entry', (l) => l.filter((e) => !e.hidden).map((e) => e.dataset.example));
  assert.ok(readable.includes('qbf') && readable.includes('guide-03-hit-clique') && !readable.includes('guide-04-one-node') && !readable.includes('marco'), readable.join());
  await page.selectOption('#library-read', '');
  await page.click('#library [data-copy-example="nash"]');
  await page.waitForFunction(() => /\?example=nash/.test(document.getElementById('load-status').textContent));
  await page.click('#library [data-load-example="tutorial-first-run"]');
  await page.waitForFunction(() => /Sum-free/.test(document.getElementById('load-status').textContent));
  // a project kit's readme is shown under its title, and edited with the description (E1)
  await page.click('#library [data-load-example="voting-justification"]');
  await page.waitForFunction(() => !document.getElementById('project-readme').hidden);
  await page.click('#project-readme summary');
  assert.match(await page.textContent('#project-readme-body h2'), /Background/);
  await page.click('#edit-project-button');
  await page.fill('#project-readme-input', '# Notes\n\nMy **own** question.');
  await page.click('#save-project-info');
  assert.match(await page.innerHTML('#project-readme-body'), /<b>own<\/b>/);
  assert.equal(await page.evaluate(() => window.cegarplay.project.readme), '# Notes\n\nMy **own** question.');
  assert.deepEqual(errors, []);
  await context.close();
  const o = await B.openPage(browser, server, '?example=no-such-thing');
  await o.page.waitForFunction(() => /no example "no-such-thing".*known: /.test(document.getElementById('load-status').textContent));
  await o.context.close();
});

test('a Load button in the tutorial loads its example and stays in the tab', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=2');
  await page.waitForSelector('#tutorial [data-load-example="gc-shape3"]');
  await page.click('#tutorial [data-load-example="gc-shape3"]');
  await page.waitForFunction(() => /Shape 3/.test(document.getElementById('load-status').textContent));
  assert.match(await page.$eval('#tutorial [data-load-example="gc-shape3"] + .load-note', (e) => e.textContent), /Loaded/);
  assert.equal(await page.$eval('#tab2', (e) => e.checked), true);
  assert.match(await B.getEditor(page, 'loop-editor'), /A\.expand\(refine/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('editors are sized when their tab is shown; Ctrl+Enter runs; clingo infos mark the line', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring');
  await page.click('label[for="tab2"]');
  await page.waitForTimeout(200);
  const cropped = await page.$$eval('#tutorial .ace_editor', (l) => l.filter((e) => {
    const ed = e.env.editor;
    return e.offsetHeight + 2 < ed.session.getScreenLength() * ed.renderer.lineHeight;
  }).length);
  assert.equal(cropped, 0, 'no example editor in the Tutorial is cropped');
  await page.click('label[for="tab3"]');
  await page.waitForTimeout(200);
  assert.ok(await page.$eval('#editor-abstraction', (e) => e.offsetHeight) > 100);
  // a check that uses an atom no rule defines: an info marker on that line, no red tab marker
  await B.setEditor(page, 'editor-check', (await B.getEditor(page, 'editor-check')) + '\n:- undefined_atom(X), node(X).\n');
  await page.click('#editor-check');
  await page.keyboard.press('Control+Enter');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  const ann = await page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations());
  assert.ok(ann.some((a) => a.type === 'info' && /undefined_atom/.test(a.text)), JSON.stringify(ann));
  assert.equal(await page.$eval('#label-programs', (e) => e.classList.contains('has-problem')), false);
  assert.match(await page.$eval('#messages', (e) => e.textContent), /fragment check, line \d+/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('loading an example over an edited project asks first', async () => {
  const { page, context } = await B.openPage(browser, server);
  // no edit yet: no question
  let asked = 0;
  page.on('dialog', (d) => { asked++; d.dismiss(); });
  await B.openLibrary(page);
  await page.click('#library [data-load-example="nash"]');
  await page.waitForFunction(() => /Nash/i.test(document.getElementById('load-status').textContent));
  assert.equal(asked, 0);
  await B.setEditor(page, 'editor-shared', '% edited\n');
  await page.click('#library [data-load-example="graph-coloring"]');
  await page.waitForTimeout(200);
  assert.equal(asked, 1);
  assert.equal(await B.getEditor(page, 'editor-shared'), '% edited\n', 'dismissed: the project is kept');
  await context.close();
});

test('the loop script is checked while it is edited; New project runs', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=4');
  const loop = await B.getEditor(page, 'loop-editor');
  await B.setEditor(page, 'loop-editor', loop.replace('C.solve', 'D.solve'));
  await page.waitForFunction(() => ace.edit(document.getElementById('loop-editor')).session.getAnnotations().length > 0, null, { timeout: 3000 });
  const ann = await page.evaluate(() => ace.edit(document.getElementById('loop-editor')).session.getAnnotations());
  assert.match(ann[0].text, /D/);
  assert.equal(await page.$eval('#label-loop', (e) => e.classList.contains('has-problem')), true);
  await B.setEditor(page, 'loop-editor', loop);
  await page.waitForFunction(() => ace.edit(document.getElementById('loop-editor')).session.getAnnotations().length === 0, null, { timeout: 3000 });
  assert.equal(await page.$eval('#label-loop', (e) => e.classList.contains('has-problem')), false);
  // New project (the project was edited: accept the question)
  page.once('dialog', (d) => d.accept());
  await page.click('label[for="tab1"]');
  await B.projectMenu(page, 'new-button');
  assert.match(await B.getEditor(page, 'editor-check'), /relevant\(pick/);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  assert.match(await page.textContent('#live-line'), /4 solutions/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('?example= does not overwrite the kept project until it is edited; rename clears marks', async () => {
  const { page, context } = await B.openPage(browser, server);
  await B.setEditor(page, 'editor-shared', '% kept\n');
  await page.waitForTimeout(1200);
  await page.goto(page.url() + '&example=nash');
  await page.waitForSelector('body[data-ready="true"]');
  await page.click('#run-button');
  await B.waitState(page, ['finished', 'error']);
  await page.waitForTimeout(1200);
  await page.goto(page.url().replace(/&example=nash/, ''));
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await B.getEditor(page, 'editor-shared'), '% kept\n');
  // marks of a run go away when the fragment is renamed
  await page.goto(page.url() + '&fresh=1');
  await page.waitForSelector('body[data-ready="true"]');
  await B.setEditor(page, 'editor-check', (await B.getEditor(page, 'editor-check')) + '\nx :- y.\n');
  await page.click('#run-button');
  await B.waitState(page, ['finished', 'error']);
  await B.setEditor(page, 'editor-abstraction', (await B.getEditor(page, 'editor-abstraction')) + '\n:- q.\n');
  await page.click('#run-button');
  await B.waitState(page, ['finished', 'error']);
  page.once('dialog', (d) => d.accept('check2'));
  await page.click('label[for="tab3"]');
  assert.ok(await page.evaluate(() => window.cegarplay.editors.marked.size) > 0, 'the run left marks');
  await page.click('[data-fragment="check"] button[title="Rename this fragment"]');
  assert.equal(await page.evaluate(() => window.cegarplay.editors.marked.size), 0);
  assert.equal(await page.$eval('#label-programs', (e) => e.classList.contains('has-problem')), false);
  await context.close();
});

test('the Manual tab: hidden by default, shown by the toggle (remembered) and by ?manual=true', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=8');
  assert.equal(await page.isHidden('label[for="tab8"]'), true);
  assert.equal(await page.$eval('#tab2', (e) => e.checked) || await page.$eval('#tab1', (e) => e.checked), true, '?tab=8 is ignored while hidden');
  await page.click('label[for="tab2"]');
  await page.check('#section-tutorial .manual-checkbox');
  assert.equal(await page.isVisible('label[for="tab8"]'), true);
  await page.click('label[for="tab8"]');
  await page.waitForFunction(() => document.querySelectorAll('#manual h2').length >= 12);
  await page.waitForFunction(() => document.querySelectorAll('#manual .ace_editor').length > 5);
  assert.ok(await page.$$eval('#manual-toc a', (l) => l.length) > 20);
  // a ?example= link in the manual loads that example
  await page.click('#manual a[data-load-example="gc-shape4"]');
  await page.waitForFunction(() => /Shape 4/.test(document.getElementById('load-status').textContent));
  assert.equal(await page.$eval('#tab8', (e) => e.checked), true);
  // the toggle is remembered after a reload; turning it off hides the tab
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.isVisible('label[for="tab8"]'), true);
  await page.click('label[for="tab1"]');
  await B.inDialog(page, 'settings', () => page.uncheck('#dialog-settings .manual-checkbox'));
  assert.equal(await page.isHidden('label[for="tab8"]'), true);
  // a link from the tutorial into the manual opens it at that section
  await page.click('label[for="tab2"]');
  await page.click('#tutorial a[href="#manual-troubleshooting"]');
  await page.waitForFunction(() => document.getElementById('tab8').checked && document.getElementById('manual-troubleshooting'));
  assert.equal(await page.isVisible('#manual-troubleshooting'), true);
  assert.deepEqual(errors, []);
  await context.close();
  const o = await B.openPage(browser, server, '?manual=true&tab=8');
  await o.page.waitForFunction(() => document.querySelectorAll('#manual h2').length >= 12);
  assert.equal(await o.page.$eval('#tab8', (e) => e.checked), true);
  assert.deepEqual(o.errors, []);
  await o.context.close();
});

test('manual.md and llms.txt are served as they are', async () => {
  for (const f of ['manual.md', 'llms.txt']) {
    const r = await fetch(`${server.url}${f}`);
    assert.equal(r.status, 200, f);
    assert.match(await r.text(), /^# /);
  }
});

test('the project title and description can be edited', async () => {
  const { page, context, errors } = await B.openPage(browser, server);
  await page.click('#edit-project-button');
  await page.fill('#project-title-input', 'My title');
  await page.fill('#project-description-input', 'My description.');
  await page.click('#save-project-info');
  assert.equal(await page.textContent('#project-heading'), 'My title');
  assert.equal(await page.textContent('#project-description'), 'My description.');
  assert.equal(await page.title(), 'CegarPlay · My title');
  assert.equal(await page.isHidden('#project-form'), true);
  await page.click('#edit-project-button');
  await page.fill('#project-title-input', 'Other');
  await page.press('#project-title-input', 'Escape');
  assert.equal(await page.textContent('#project-heading'), 'My title', 'Escape cancels');
  await page.waitForTimeout(1200);          // autosave
  await page.reload();
  await page.waitForFunction(() => /My title/.test(document.getElementById('project-heading').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});
