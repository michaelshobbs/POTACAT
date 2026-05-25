# POTACAT v1.7.4

## Memory leak fix (main-process RSS)

K3SBP and others hitting 1.7–2.2 GB main-process RSS after 30–60 min of
SmartSDR Direct + SSTV view (eventual crash / OS kill) — root-caused and
fixed. Two layers:

- **Bounded audio IPC fan-out.** Mojo IPC pipes between main and renderers
  were unbounded, so any consumer that fell behind kept growing main's
  RSS without limit. Each consumer is now a bounded queue with explicit
  renderer-side ACKs; a stalled consumer drops frames instead of leaking.
- **SSTV worker circuit breaker.** A separate "Invalid array length"
  bug in the SSTV worker was throwing 188×/sec on the SmartSDR Direct
  path, which kept feeding doomed buffer transfers into the worker thread
  (worker memory = main RSS). After 50 errors the audio feed is paused
  with a CAT-log line explaining how to recover. The underlying SSTV bug
  will be fixed in a follow-up once the stack-trace diagnostic from this
  release narrows the line.

## CAT / radio control

- **Icom IC-7100 / IC-7200 / IC-9100 mode changes work again.** These
  rigs silently ignore the 1-byte form of CI-V command 0x06; we now
  always send the 2-byte form `[mode, filter]`, echoing back the rig's
  last-reported filter byte.
- **W8IJW VFO snap-back fixed (again).** The earlier 1.2 s suppression
  window wasn't long enough on rigs that took longer to confirm a tune.
  All tune call sites now route through a match-based suppressor that
  waits until the polled frequency is within 25 Hz of the target, with
  a 3 s hard timeout.

## WSJT-X

- Confirmation dialog before enabling **WSJT-X Mode** — the setting
  hands CAT control over completely, so a one-tap toggle was easy to hit
  by mistake. Cancel keeps POTACAT in control.
- CAT-status popover now surfaces the "WSJT-X on but not running"
  silent-CAT trap with a one-line hint.

## Remote Launcher (new)

POTACAT can now wake itself up from the iOS app after a crash.

- **Desktop:** Settings → ECHOCAT → Remote Launcher → Install spawns a
  tiny HTTPS-capable helper (port 7301) that survives POTACAT exits and
  starts at login. Cross-platform (Windows VBS, macOS LaunchAgent, Linux
  .desktop autostart). Idempotent install + uninstall + status pill.
- **Mobile:** when the WebSocket drops for >5 s the DisconnectedBanner
  appears with a Restart action. Also exposed from Settings → Paired
  Desktops as an explicit "Restart POTACAT" button. Auth via the user's
  callsign as a Bearer token; the launcher cross-checks against
  settings.json before honoring the request.
- **Error mapping:** restart failures now produce specific messages —
  callsign mismatch, rate-limit, launcher not installed — instead of an
  opaque "network request failed".

## Other fixes

- **RBN connection diagnostics:** the CAT log now records when the
  Reverse Beacon Network telnet socket actually connects and when each
  RBN skimmer hears your callsign, so empty Prop tab on iOS becomes a
  one-glance debug.
- **Hunter Mode filter:** specific-mode filters (CW-only, SSB-only, etc.)
  no longer pass through POTA spots whose mode is empty.
- **SSTV engine errors carry stack traces** in the CAT log on first
  occurrence, with the rest collapsed to a periodic heartbeat — sets up
  the root-cause fix for the "Invalid array length" worker bug.
- **Native dialog title bars** read "POTACAT" instead of "potacat".
