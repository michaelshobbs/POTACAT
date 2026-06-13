// Installer launcher-kill verification (K6RBJ "POTACAT cannot be closed").
// Windows-only. Proves the PowerShell command embedded in
// build/installer.nsh (_KillLauncher) is SURGICAL: it stops a POTACAT.exe
// running the Remote Launcher (…launcher.js) while leaving a POTACAT.exe
// GUI (no launcher.js in its command line) untouched.
//
// This is the part of the fix most likely to harbor a subtle bug — does
// Get-CimInstance match the renamed exe's Name, does the command-line
// filter discriminate launcher vs GUI. The NSIS macro wiring itself is
// validated by the Windows release build (makensis) + a real upgrade.
//
// Run on Windows: node test/launcher-kill-test.js
// (no-op PASS on non-Windows — nothing to exercise there)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('=== launcher-kill === skipped (Windows-only)');
  process.exit(0);
}

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ FAIL: ' + label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The exact filter from build/installer.nsh _KillLauncher (kept in sync).
const KILL_CMD =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'POTACAT.exe' -and " +
  "$_.CommandLine -like '*launcher.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";

function aliveByCmd(substr) {
  // Count POTACAT.exe processes whose command line contains substr.
  const ps =
    "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'POTACAT.exe' -and " +
    `$_.CommandLine -like '*${substr}*' } | Measure-Object).Count`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return parseInt(out.trim(), 10) || 0;
}

(async () => {
  console.log('=== launcher-kill (surgical stop of the launcher POTACAT.exe) ===');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potacat-killtest-'));
  const fakeExe = path.join(dir, 'POTACAT.exe');         // node.exe renamed
  fs.copyFileSync(process.execPath, fakeExe);
  // Two long-running scripts; distinguished only by filename in argv.
  const launcherScript = path.join(dir, 'launcher.js');
  const guiScript = path.join(dir, 'gui-sim.js');
  const spin = 'setInterval(()=>{}, 1e9);';
  fs.writeFileSync(launcherScript, spin);
  fs.writeFileSync(guiScript, spin);

  // "Launcher": POTACAT.exe <…>\launcher.js  (the lock culprit)
  const launcher = spawn(fakeExe, [launcherScript], { detached: true, stdio: 'ignore' });
  launcher.unref();
  // "GUI": POTACAT.exe <…>\gui-sim.js  (must survive — electron-builder
  // handles it gracefully)
  const gui = spawn(fakeExe, [guiScript], { detached: true, stdio: 'ignore' });
  gui.unref();
  await sleep(1500); // let both register in the process table

  check(aliveByCmd('launcher.js') === 1, 'launcher POTACAT.exe is running before the kill');
  check(aliveByCmd('gui-sim.js') === 1, 'GUI POTACAT.exe is running before the kill');

  // Run the installer's exact kill command.
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', KILL_CMD], { encoding: 'utf8' });
  await sleep(1200);

  check(aliveByCmd('launcher.js') === 0, 'launcher POTACAT.exe was stopped');
  check(aliveByCmd('gui-sim.js') === 1, 'GUI POTACAT.exe was NOT touched (graceful path preserved)');

  // Cleanup
  try { execSync(`taskkill /PID ${gui.pid} /F`, { stdio: 'ignore' }); } catch {}
  try { execSync(`taskkill /PID ${launcher.pid} /F`, { stdio: 'ignore' }); } catch {}
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
