# Slow CAT / Link connect on cellular data

Status: open (investigation)
Filed: 2026-05-21
For: POTACAT iOS (ECHOCAT)
Reporter: Scott WG9I, via Discord

## Symptom

On cellular data the CAT and Link status indicators take a very long time
to turn green — once observed at roughly 10 minutes (came back later and
it had connected on its own). On WiFi both connect promptly. Tailscale is
running on the phone and the host, configured identically for both
networks.

## Context

- Casey added connection-side logging on the desktop around this report
  (2026-05-18) — use it to see how far the handshake gets on a cellular
  session.
- Both networks use Tailscale, so this isn't a plain reachability gap.
  More likely a slow path negotiation (Tailscale direct vs. DERP relay on
  a CGNAT'd carrier) or the app's connect/retry/backoff being too patient
  on a high-latency path — a 10-minute "eventually connected" looks like a
  single stuck attempt with no aggressive retry.

## What to investigate (iOS side)

- The WebSocket connect + retry/backoff timing. If the first attempt
  stalls, how long until a retry, and does backoff cap somewhere sane?
- Whether the app blocks on a Tailscale *direct* path establishing rather
  than proceeding over the DERP relay.
- Connection timeouts — a too-long socket timeout on the first attempt
  would explain the multi-minute wait.
- Surface the desktop's new connection logs (and any phone-side logs) for
  one cellular session so the stall point is visible.

## How to verify

1. Phone on cellular only (WiFi off), Tailscale up on both ends.
2. Open ECHOCAT — time how long CAT + Link take to go green.
3. Repeat on WiFi for the baseline.
4. With desktop verbose logging on, capture where the cellular handshake
   stalls.
