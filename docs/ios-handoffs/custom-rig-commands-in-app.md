# Custom rig commands missing from the iOS app

Status: open
Filed: 2026-05-21
For: POTACAT iOS (ECHOCAT)
Reporter: Walt KK4DF, via Discord
Desktop side: no change needed — already on the wire

## Ask

User-defined custom rig commands (raw-CAT shortcut buttons) work in the
ECHOCAT *web* client but aren't available in the native iOS app. Walt:
"working fine via the web browser, but I don't find them available in the
app."

## What the desktop already does

Custom CAT buttons are user-defined raw-CAT shortcuts shown in the Rig
control surface. Per `docs/echocat-protocol.md`:

- `save-custom-cat-buttons` (C→S) — a client saves the user's set of
  custom raw-CAT buttons; desktop persists them to
  `settings.customCatButtons`.
- The button array reaches clients as part of the rig/radio state push —
  the web client renders them in its Rig panel. (Confirm the exact
  carrier message against `renderer/remote.js`; it arrives alongside the
  rig capabilities/state.)
- Firing a button sends its raw CAT string via the existing
  `send-custom-cat` rig-control action.

## What the iOS app needs

Add the custom CAT buttons to the iOS Rig screen, matching the web client:

- Render the `customCatButtons` array (each entry: label + command).
- Tapping one sends the raw CAT command (same `send-custom-cat` path the
  web client uses).
- Optionally allow add / edit / remove, persisted via
  `save-custom-cat-buttons`.

`renderer/remote.js` (the ECHOCAT web client) is the reference for how the
buttons are received, rendered, and fired — match it.

## How to verify

1. Define a custom CAT button on the desktop (Settings → Rig → Custom tab,
   or from the web client).
2. The iOS Rig screen shows it.
3. Tapping it executes the command — visible in the desktop verbose log.
4. If add/edit is implemented: create one on iOS, confirm it appears on
   desktop and the web client.
