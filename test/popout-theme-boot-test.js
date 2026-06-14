// Tests for renderer/popout-theme-boot.js — the rule that makes every popout
// open in the operator's theme on the first frame (no flash). The script is
// browser code (window.location / document), so we run it with mocked globals
// and assert the attribute logic exactly matches the main window's
// applyTheme(): data-theme always; data-dark-variant only for non-default dark.
// Run: node test/popout-theme-boot-test.js
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'popout-theme-boot.js'), 'utf8');

// Execute the boot IIFE with injected window/document/URLSearchParams and
// return the attributes it set on <html>.
function run(search) {
  const attrs = {};
  const el = {
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
  };
  const win = { location: { search } };
  const doc = { documentElement: el };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'URLSearchParams', src)(win, doc, URLSearchParams);
  return attrs;
}

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ FAIL: ' + label); }
}

console.log('=== popout-theme-boot ===');

let a = run('?theme=light&variant=navy');
check(a['data-theme'] === 'light', 'light → data-theme=light');
check(!('data-dark-variant' in a), 'light → no data-dark-variant');

a = run('?theme=dark&variant=navy');
check(a['data-theme'] === 'dark', 'dark+navy → data-theme=dark');
check(!('data-dark-variant' in a), 'dark+navy (default) → no data-dark-variant');

a = run('?theme=dark&variant=charcoal');
check(a['data-theme'] === 'dark', 'dark+charcoal → data-theme=dark');
check(a['data-dark-variant'] === 'charcoal', 'dark + non-default variant → data-dark-variant=charcoal');

a = run('?theme=light&variant=charcoal');
check(a['data-theme'] === 'light', 'light wins over variant → data-theme=light');
check(!('data-dark-variant' in a), 'light never carries a dark-variant');

a = run('');
check(a['data-theme'] === 'dark', 'no query → defaults to dark');

a = run('?theme=bogus');
check(a['data-theme'] === 'dark', 'unrecognized theme → dark (only "light" is light)');

a = run('?theme=light');
check(a['data-theme'] === 'light', 'light with no variant param → light');

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
