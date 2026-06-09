// Pre-paint theme apply for popout windows. Read theme + dark-variant
// from the loadFile query string and stamp them onto <html> BEFORE the
// stylesheet evaluates, so a popout opened with charcoal active doesn't
// flash navy first. Must be the FIRST <script> in every popout HTML
// and must sit BEFORE the <link rel="stylesheet"> so the parser sets
// the attrs before the render tree builds.
//
// Receives:  ?theme=light|dark&variant=navy|charcoal
//   from main.js: loadFile(path, { query: { theme, variant } })
//
// The runtime IPC handler (_applyPopoutTheme in each popout JS) still
// runs later for live theme changes; this bootstrap only solves the
// first-paint flash. Both paths converge on the same attribute model.
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var theme = p.get('theme') === 'light' ? 'light' : 'dark';
    var variant = p.get('variant') || 'navy';
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark' && variant !== 'navy') {
      document.documentElement.setAttribute('data-dark-variant', variant);
    }
  } catch (e) {
    // Falls through to :root defaults — better than crashing the popout.
  }
})();
