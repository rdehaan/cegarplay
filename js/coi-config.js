// Cross-origin isolation through a service worker (pause, step, stop, threads).
// ?nocoi=1 skips it and removes an earlier registration. Loaded before coi-serviceworker.js.
window.coi = {
  shouldRegister: () => !/[?&]nocoi=1\b/.test(location.search),
  shouldDeregister: () => /[?&]nocoi=1\b/.test(location.search),
  quiet: true,
};
