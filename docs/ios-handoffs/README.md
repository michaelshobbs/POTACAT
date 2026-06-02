# iOS App Handoffs

This directory holds open requests for the iOS POTACAT app (React Native, repo `potacat-app`). Each file is a self-contained briefing the iOS Claude can act on without session history.

## Convention

- One markdown file per request, named after the feature (`psk31-rtty-modes.md`, `cert-pinning-module.md`, etc.)
- Top of each file: status (open / in-progress / shipped), filed date, and the iOS repo path.
- Body explains: context, what the desktop side already does/sends, what needs to change in the iOS app, test path, and links to relevant desktop commits.
- When a handoff is shipped on the iOS side, mark status `shipped` (don't delete — useful as a record of cross-app coordination).

## Open

- [audio-restart-button.md](audio-restart-button.md) — Add a "Restart audio" button (and optional auto-banner) that fires the `restart-audio` WS message; recovers the iOS audio bridge from RDP-induced silence without leaving the phone.
- [jtcat-qso-waiting-phase.md](jtcat-qso-waiting-phase.md) — *(in-progress)* Render the new JTCAT `waiting` QSO phase. iOS side implemented in `Ft8Screen.tsx` (type-check clean); pending TestFlight + end-to-end test against a v1.5.22+ desktop.
- [tx-audio-eq.md](tx-audio-eq.md) — TX EQ + compressor UI. Desktop ships the DSP + 3 presets + WS protocol; iOS just needs to add the toggle + preset picker and listen for `tx-eq-state` pushes.
- [spot-filters-not-applied.md](spot-filters-not-applied.md) — "Hide Worked" / "New Parks Only" spot filters do nothing in the native app (work in the web client). Filter at render time against the `worked-qsos` / `worked-parks` pushes. *(Discord triage 2026-05-21.)*
- [custom-rig-commands-in-app.md](custom-rig-commands-in-app.md) — User-defined custom rig CAT commands work in the web client but aren't surfaced in the native iOS Rig screen. *(Discord triage 2026-05-21.)*
- [cellular-connect-latency.md](cellular-connect-latency.md) — CAT/Link take minutes to connect on cellular data (prompt on WiFi); investigate WS retry/backoff + Tailscale path negotiation. *(Discord triage 2026-05-21.)*
- [wwbota-spot-source.md](wwbota-spot-source.md) — Add WWBOTA (Worldwide Bunkers on the Air) as a first-class spot source: filter chip, slate-gray badge, n-fer ref display, log + re-spot. Desktop side shipped 2026-06-01; mobile just needs to consume the new `source: 'wwbota'` shape. ([Issue #34](https://github.com/Waffleslop/POTACAT/issues/34).)

## Shipped

- [psk31-rtty-modes.md](psk31-rtty-modes.md) — Add PSK31 (new) and RTTY (partial) to spot filters, log sheet, mode picker. Shipped 2026-05-06.
