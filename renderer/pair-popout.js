// Pair Mobile App popout — generates a fresh pairing QR via IPC and shows it
// at a comfortable scanning size. A dedicated window so the user doesn't have
// to wrestle the Settings dialog's scrollbar to point a phone at it.
(function() {
  'use strict';

  if (window.api.platform === 'darwin') {
    var ctrls = document.querySelector('.titlebar-controls');
    if (ctrls) ctrls.style.display = 'none';
  }

  var imgEl = document.getElementById('pp-qr-img');
  var svgEl = document.getElementById('pp-qr-svg');
  var textEl = document.getElementById('pp-qr-text');
  var ttlEl = document.getElementById('pp-qr-ttl');
  var errEl = document.getElementById('pp-error');
  var cardEl = document.getElementById('pp-qr-card');
  var regenBtn = document.getElementById('pp-regen-btn');
  var closeBtnHeader = document.getElementById('tb-close');
  var closeBtnFooter = document.getElementById('pp-close-btn');

  var manualHostEl = document.getElementById('pp-manual-host');
  var manualTokenEl = document.getElementById('pp-manual-token');
  var manualFpEl = document.getElementById('pp-manual-fp');
  var manualUrlEl = document.getElementById('pp-manual-url');

  var ttlInterval = null;

  function showError(msg) {
    errEl.textContent = msg;
    errEl.style.display = '';
    cardEl.style.display = 'none';
  }

  function hideError() {
    errEl.style.display = 'none';
    cardEl.style.display = '';
  }

  // Hide the QR card and lean on the manual fields. Used when SVG fails to
  // mount (rare Linux Electron + Mint 22.3 case 2026-05-05) so the user
  // still has a clear path: copy the URL or the individual fields.
  function showManualOnly(reason) {
    cardEl.style.display = 'none';
    errEl.textContent = reason ||
      'QR rendering failed on this platform. Use the manual-pairing fields below.';
    errEl.style.display = '';
  }

  async function generate() {
    if (ttlInterval) { clearInterval(ttlInterval); ttlInterval = null; }
    regenBtn.disabled = true;
    regenBtn.textContent = 'Generating…';
    try {
      var r = await window.api.echocatCreatePairingQr({});
      if (r && r.error) { showError(r.error); return; }
      hideError();

      // Always populate the manual-pair fields, even when the QR renders.
      // Users may want to share the values via text/email rather than scan.
      manualHostEl.value = r.host || '';
      manualTokenEl.value = r.pairingToken || '';
      manualFpEl.value = r.fingerprint || '';
      manualUrlEl.value = r.qrText || '';

      // Prefer SVG: inline markup, no PNG codec, no data: URL — same
      // result on Win/macOS/Linux. KD2TJU on Linux Mint 22.3 saw a
      // broken-image icon because the dataUrl path produced an
      // unreadable PNG on Chromium's image decoder for that distro.
      // Fall back to the PNG dataUrl if for some reason SVG didn't
      // generate (e.g., older qrcode build).
      var qrShown = false;
      if (r.svg) {
        svgEl.innerHTML = r.svg;
        svgEl.style.display = '';
        imgEl.style.display = 'none';
        // Verify the SVG actually mounted — in rare cases (Linux Electron
        // Chromium quirks) inline SVG via innerHTML doesn't paint. If
        // there's no <svg> child after we set innerHTML, fall through
        // to the PNG path or surface a manual-only message.
        if (svgEl.querySelector('svg')) qrShown = true;
      }
      if (!qrShown && r.dataUrl) {
        // Wire onerror so a failing PNG decode also collapses to manual-only.
        imgEl.onerror = function() {
          imgEl.onerror = null;
          showManualOnly('QR image failed to render. Type the values below into your mobile app to pair manually.');
        };
        imgEl.src = r.dataUrl;
        imgEl.style.display = '';
        svgEl.style.display = 'none';
        qrShown = true;
      }
      if (!qrShown) {
        showManualOnly('No QR formats generated. Type the values below into your mobile app to pair manually.');
      }

      imgEl.style.opacity = '1';
      svgEl.style.opacity = '1';
      textEl.textContent = r.qrText;
      var remaining = r.ttlSeconds || 300;
      ttlEl.classList.remove('expired');
      function tick() {
        if (remaining <= 0) {
          ttlEl.textContent = 'Expired — click Regenerate.';
          ttlEl.classList.add('expired');
          imgEl.style.opacity = '0.3';
          svgEl.style.opacity = '0.3';
          // Empty out manual fields too so the user doesn't paste a stale token.
          manualTokenEl.value = '';
          manualUrlEl.value = '';
          clearInterval(ttlInterval);
          ttlInterval = null;
          return;
        }
        var m = Math.floor(remaining / 60);
        var s = String(remaining % 60).padStart(2, '0');
        ttlEl.textContent = 'Expires in ' + m + ':' + s;
        remaining--;
      }
      tick();
      ttlInterval = setInterval(tick, 1000);
    } catch (err) {
      showError('Pairing QR failed: ' + (err.message || err));
    } finally {
      regenBtn.disabled = false;
      regenBtn.textContent = 'Regenerate';
    }
  }

  // Tap-to-copy buttons next to each manual field. Standard navigator.clipboard
  // path with a hidden-textarea + execCommand fallback for older Electron
  // builds where clipboard API isn't exposed.
  function copyText(text, btn) {
    function done() {
      var prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function() { btn.textContent = prev; }, 1200);
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }
  document.querySelectorAll('button[data-copy]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = document.getElementById(btn.dataset.copy);
      if (target && target.value) copyText(target.value, btn);
    });
  });

  regenBtn.addEventListener('click', generate);
  closeBtnHeader.addEventListener('click', function() { window.api.close(); });
  closeBtnFooter.addEventListener('click', function() { window.api.close(); });

  generate();
})();
