// Popout theme boot — the single rule that makes every POTACAT pop-out
// (VFO, JTCAT, Map, Spots, Cluster, Log, QSO, SSTV, Conditions, …) open in
// the operator's chosen light/dark theme on the FIRST painted frame, with no
// flash-then-switch.
//
// How it stays flicker-free: main.js passes the current theme on the window's
// loadFile URL — `?theme=light|dark&variant=<darkVariant>` — for every popout.
// This script is loaded as the first <script> in <head> (a classic, render-
// blocking script), so it runs and sets the data-theme / data-dark-variant
// attributes on <html> BEFORE the stylesheet paints. It mirrors the main
// window's applyTheme() exactly: data-theme is always set; data-dark-variant
// is set only for a non-default dark variant. Live theme toggles while a
// popout is open still arrive via each popout's onTheme IPC.
(function () {
  try {
    var q = new URLSearchParams(window.location.search || '');
    var theme = q.get('theme') === 'light' ? 'light' : 'dark';
    var variant = q.get('variant') || 'navy';
    var el = document.documentElement;
    el.setAttribute('data-theme', theme);
    if (theme === 'dark' && variant && variant !== 'navy') {
      el.setAttribute('data-dark-variant', variant);
    } else {
      el.removeAttribute('data-dark-variant');
    }
  } catch (e) {
    // No query / parse failure → leave the stylesheet's default (dark).
  }
})();
