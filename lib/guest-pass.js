// Guest Pass intake parsing — shared by main.js (protocol handler + IPC) and
// the test suite. A pass code reaches the desktop in one of three forms:
//   potacat://pass/<code>                                  (landing-page CTA)
//   https://api.potacat.com/guest-pass.html?code=<code>    (the share URL)
//   <code>                                                 (bare 4-word code)
// K3SBP 2026-06-11.
'use strict';

// 4-word canonical post-2026-06-02; 3-word still accepted for in-flight links.
const CODE_RE = /^[a-z]+(-[a-z]+){2,3}$/;

/** Pull a guest-pass code out of any accepted intake form. Returns '' when
 *  the input isn't pass-shaped (callers fall through to other handlers). */
function extractGuestPassCode(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let code = '';
  if (/^potacat:\/?\/?pass\//i.test(s)) {
    code = s.replace(/^potacat:\/?\/?pass\//i, '').split(/[?#]/)[0];
    try { code = decodeURIComponent(code); } catch {}
  } else if (/guest-pass\.html/i.test(s)) {
    try { code = new URL(s).searchParams.get('code') || ''; } catch {}
  } else {
    code = s;
  }
  code = code.toLowerCase().trim();
  return CODE_RE.test(code) ? code : '';
}

module.exports = { extractGuestPassCode, CODE_RE };
