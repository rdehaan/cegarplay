// The Manual tab (manual.md rendered, with its contents) and the Tutorial tab (tutorial.html),
// their read-only code blocks, and the links into them (#manual-<slug>, #tut-<lesson>) from
// anywhere on the page.
import { h as make, $ } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { makeEditor } from './editors.js';

// page: { resizeVisibleEditors } from js/init.js
let page = null;
let manualLoading = null;       // the promise of the rendered manual
let tutorialLoading = null;     // the promise of the loaded tutorial

// Read-only ACE editors for the .example-code blocks of the Tutorial, the Manual and a readme.
export function codeBlocks(box) {
  for (const el of box.querySelectorAll('.example-code')) {
    const mode = el.dataset.mode === 'loop' ? 'ace/mode/loop' : el.dataset.mode === 'lua' ? 'ace/mode/lua' : 'ace/mode/gringo';
    el.textContent = el.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    const ed = makeEditor(el, mode, { readOnly: true });
    ed.setOptions({ minLines: 1, highlightActiveLine: false, highlightGutterLine: false });
    ed.renderer.$cursorLayer.element.style.display = 'none';
  }
  requestAnimationFrame(() => page && page.resizeVisibleEditors());
}

// The manual, rendered once (on its first show).
export function loadManual() {
  if (!manualLoading) manualLoading = buildManual();
  return manualLoading;
}
async function buildManual() {
  const box = $('manual');
  let text;
  try {
    const r = await fetch('manual.md');
    if (!r.ok) throw new Error(r.statusText);
    text = await r.text();
  } catch {
    box.innerHTML = '<p class="error-text">The manual could not be loaded.</p>';
    return;
  }
  const headings = [];
  box.innerHTML = renderMarkdown(text, { headings });
  // contents: the second-level headings, with their third-level headings
  const toc = make('ol');
  let last = null;
  for (const h of headings) {
    if (h.level === 2) {
      last = make('li');
      last.innerHTML = `<a href="#${h.id}">${h.html}</a>`;
      toc.append(last);
    } else if (h.level === 3 && last) {
      let sub = last.querySelector('ol');
      if (!sub) { sub = make('ol'); last.append(sub); }
      const li = make('li');
      li.innerHTML = `<a href="#${h.id}">${h.html}</a>`;
      sub.append(li);
    }
  }
  $('manual-toc').textContent = '';
  $('manual-toc').append(make('b', {}, 'Contents'), toc);
  codeBlocks(box);
}

// The tutorial, loaded once (at start-up).
export function loadTutorial() {
  if (!tutorialLoading) tutorialLoading = buildTutorial();
  return tutorialLoading;
}
async function buildTutorial() {
  const box = $('tutorial');
  try {
    const r = await fetch('tutorial.html');
    if (!r.ok) throw new Error(r.statusText);
    box.innerHTML = await r.text();
  } catch {
    box.innerHTML = '<p>The tutorial could not be loaded.</p>';
    return;
  }
  codeBlocks(box);
}

// Links to #manual-<slug> (from the Tutorial, the modals or the Manual itself) open the Manual
// tab, turning it on if needed, and scroll to that section; links to #tut-<lesson> open the
// Tutorial tab at that lesson.
export function wireDocLinks(pageHooks) {
  page = pageHooks;
  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href^="#manual-"]');
    if (!a) return;
    ev.preventDefault();
    const modal = a.closest('.modal');
    if (modal) modal.classList.remove('is-visible');
    await loadManual();
    $('tab8').checked = true;
    requestAnimationFrame(() => {
      page.resizeVisibleEditors();
      const target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) target.scrollIntoView({ block: 'start' });
    });
  });
  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href^="#tut-"]');
    if (!a) return;
    ev.preventDefault();
    const modal = a.closest('.modal');
    if (modal) modal.classList.remove('is-visible');
    $('tab2').checked = true;
    $('tab2').dispatchEvent(new Event('change', { bubbles: true }));
    await loadTutorial();
    requestAnimationFrame(() => {
      const target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) target.scrollIntoView({ block: 'start' });
    });
  });
}
