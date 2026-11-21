// The colour theme of the playground and the guide: auto (the system preference), light or dark.
// A classic script loaded in <head> without defer, so the theme is set before the page is drawn.
// The choice is kept in localStorage under cegarplay.theme and shown as data-theme on <html>
// (no attribute for auto); css/theme.css does the rest. Buttons marked data-theme-toggle cycle
// through the three states. window.cegarTheme: mode(), isDark(), set(mode), cycle(), onChange(fn).
(function () {
  'use strict';
  var KEY = 'cegarplay.theme';
  var MODES = ['auto', 'light', 'dark'];
  var LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var listeners = [];
  var current = 'auto';

  function stored() {
    try {
      var v = window.localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }
  function isDark() {
    return current === 'dark' || (current === 'auto' && !!(mq && mq.matches));
  }
  function render() {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = LABEL[current];
      buttons[i].title = 'Colour theme: ' + current + ' (click to change)';
      buttons[i].setAttribute('aria-label', 'Colour theme: ' + current);
    }
  }
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](isDark(), current); } catch (e) { console.error(e); }
    }
  }
  function apply(mode) {
    current = mode;
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    render();
    notify();
  }
  function set(mode) {
    if (MODES.indexOf(mode) < 0) mode = 'auto';
    try {
      if (mode === 'auto') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, mode);
    } catch (e) { /* storage unavailable: the choice lasts for this page only */ }
    apply(mode);
  }
  function cycle() {
    set(MODES[(MODES.indexOf(current) + 1) % MODES.length]);
  }

  apply(stored());
  if (mq) {
    var changed = function () { if (current === 'auto') notify(); };
    if (mq.addEventListener) mq.addEventListener('change', changed);
    else if (mq.addListener) mq.addListener(changed);
  }
  // Another tab of the same site (the app or a guide page) changed the setting.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) apply(stored());
  });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
    if (b) { e.preventDefault(); cycle(); }
  });
  document.addEventListener('DOMContentLoaded', render);

  window.cegarTheme = {
    mode: function () { return current; },
    isDark: isDark,
    set: set,
    cycle: cycle,
    onChange: function (fn) { listeners.push(fn); },
  };
})();
