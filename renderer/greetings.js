// Friendly per-session greeting shown briefly at startup. Ported
// from the iOS app's src/utils/greetings.ts — same list, same
// time-of-day gating, same no-repeat policy. The desktop variant
// reads/writes the last-shown index from localStorage rather than
// MMKV, and renders into a self-dismissing toast at the top of
// the window so it doesn't compete with the table or the map.
//
// {CALL} is substituted with the operator's callsign uppercased.
// No callsign yet → "OM" (universal CW catch-all).

const GREETINGS = [
  { text: 'Fine business, {CALL}' },
  { text: 'Howdy, {CALL}' },
  { text: 'Welcome back, {CALL}' },
  { text: 'May the bands be in your favor, {CALL}' },
  // Morning: 5am through 11:59am.
  { text: "Mornin', {CALL}", hours: [5, 12] },
  // Evening: 5pm through 11:59pm.
  { text: "Evenin', {CALL}", hours: [17, 24] },
  { text: '73 in advance, {CALL}' },
  { text: '{CALL} de POTACAT' },
  { text: 'Bands open, hello {CALL}' },
  { text: 'Hey there, {CALL}' },
  { text: 'Ready to chase some DX, {CALL}?' },
  { text: 'Welcome to the shack, {CALL}' },
  { text: 'Good to see ya, {CALL}' },
  { text: '{CALL}, antennas up?' },
  { text: 'Hope the WX is good, {CALL}' },
  { text: 'Park hunt today, {CALL}?' },
  { text: 'FB op, {CALL}' },
  { text: 'QRV, {CALL}?' },
  { text: 'Pour a coffee, {CALL}' },
  { text: 'The bands are waiting, {CALL}' },
  { text: 'Whatcha keying today, {CALL}?' },
  { text: 'Greetings from the ether, {CALL}' },
  { text: 'Tally ho, {CALL}' },
  { text: '{CALL}, propagation looks promising' },
  { text: 'Esteemed op {CALL}, your shack awaits' },
  { text: 'HW COFFEE, {CALL}' },
  { text: 'The 🐈‍⬛ calls for thee, {CALL}' },
  { text: 'Who we chasing today, {CALL}?' },
  // Star Wars.
  { text: 'May the Bands be with you, {CALL}' },
  { text: "These are the bands you're looking for, {CALL}" },
  { text: 'Never tell me the SWR, {CALL}' },
  { text: 'Greetings, General {CALL}' },
  { text: 'Strong with the bands you are, {CALL}' },
  // Historical.
  { text: 'What hath God wrought, {CALL}?' },
  { text: 'From Cornwall to Newfoundland, {CALL}' },
  { text: 'OM {CALL}, fine sigs' },
  { text: 'Sparks flying, {CALL}?' },
  { text: 'Tubes warmed up, {CALL}?' },
];

const LS_KEY = 'lastGreetingIndex';
const SESSION_KEY = 'greetingShownThisSession';
const TOAST_DURATION_MS = 4500;

function pickGreetingIndex(previousIndex, hourOfDay) {
  const eligible = [];
  for (let i = 0; i < GREETINGS.length; i++) {
    const g = GREETINGS[i];
    if (g.hours) {
      const [lo, hi] = g.hours;
      if (hourOfDay < lo || hourOfDay >= hi) continue;
    }
    if (i === previousIndex && GREETINGS.length > 1) continue;
    eligible.push(i);
  }
  const pool = eligible.length > 0 ? eligible : GREETINGS.map((_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderGreeting(index, callsign) {
  const safeIdx = index >= 0 && index < GREETINGS.length ? index : 0;
  const call = (callsign || '').trim().toUpperCase() || 'OM';
  return GREETINGS[safeIdx].text.replace(/\{CALL\}/g, call);
}

// Show once per app session. If somebody calls this twice (e.g. callsign
// gets set, then changed, then the welcome dialog closes) we don't keep
// firing — the greeting is supposed to be a one-shot "hello, you exist
// in the system" cue, not a recurring popup.
function showStartupGreeting(callsign) {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // sessionStorage unavailable (private mode etc.) — still fire once
    // per page load by relying on the closure check below.
  }
  if (showStartupGreeting._shown) return;
  showStartupGreeting._shown = true;

  let previousIndex = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (Number.isInteger(n)) previousIndex = n;
    }
  } catch {}

  const idx = pickGreetingIndex(previousIndex, new Date().getHours());
  try { localStorage.setItem(LS_KEY, String(idx)); } catch {}

  const text = renderGreeting(idx, callsign);

  const existing = document.querySelector('.greeting-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'greeting-toast';
  toast.textContent = text;
  // Tap to dismiss early — the user already got the cue, no reason to
  // make them wait out the auto-fade if they want to clear it.
  toast.addEventListener('click', () => {
    toast.classList.add('greeting-toast-leaving');
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350);
  });
  document.body.appendChild(toast);
  // Fade in after a tick so the CSS transition runs.
  requestAnimationFrame(() => toast.classList.add('greeting-toast-in'));
  setTimeout(() => {
    toast.classList.add('greeting-toast-leaving');
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350);
  }, TOAST_DURATION_MS);
}

// Test hook — not used in production code paths.
function _resetGreetingForTests() {
  showStartupGreeting._shown = false;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

window.showStartupGreeting = showStartupGreeting;
window._resetGreetingForTests = _resetGreetingForTests;
