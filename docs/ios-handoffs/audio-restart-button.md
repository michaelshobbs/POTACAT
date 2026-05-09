# Audio restart button for ECHOCAT iOS

Status: open
Filed: 2026-05-08
Repo for changes: D:\Projects\potacat-app

## Context

When the operator is away from the shack and uses Windows Remote Desktop (iOS Windows app) to control the shack PC, Windows shuffles audio device routing as the RDP session enters/leaves. POTACAT's ECHOCAT WebRTC bridge and JTCAT's DAX capture both keep stale device handles afterward — the phone hears silence even though the rig is fine. Historical fix: walk over to the PC and restart apps. New fix: a "Restart audio" button on the desktop that tears down + rebuilds the audio paths.

K3SBP wants the same one-tap recovery from inside the iOS ECHOCAT app, since he's already there when he notices the silence.

## What the desktop already supports (shipped 2026-05-08)

The desktop accepts a new C2S WebSocket message:

```jsonc
// phone → desktop
{ "type": "restart-audio" }
```

…and replies asynchronously with:

```jsonc
// desktop → phone
{
  "type": "restart-audio-result",
  "ok": true | false,
  "error": "",          // populated when ok === false
  "note": ""            // optional, e.g. "ECHOCAT not enabled — JTCAT kicked"
}
```

Behavior on the desktop side:

1. Tear down the WebRTC audio bridge (the existing teardown nudges JTCAT to restart its DAX capture too — both audio paths refresh).
2. Wait 600 ms for Windows to release device handles.
3. Re-grab the audio devices via fresh `getUserMedia` and rebuild the WebRTC track.
4. Reply with `restart-audio-result`.

Total time: ~1–2 seconds. The phone's WebSocket connection stays live; only the audio source on the desktop side resets. Pairing, rig control, spots, logging — all unaffected through the restart.

Protocol registry entries (in `lib/echocat-protocol.js`):

```js
'restart-audio': { dir: Dir.C2S, feature: 'core' },
'restart-audio-result': { dir: Dir.S2C, feature: 'core',
                           fields: { ok: f.boolean, error: f.string, note: f.string } },
```

Desktop commits: `705eebe`, `ceb1521`.

## What needs to change in the iOS app

### 1. Send the message

Wherever `connectionManager.send()` is wired (probably `src/services/EchocatClient.ts` or similar), add a helper:

```ts
function restartAudio(): void {
  connectionManager.send({ type: 'restart-audio' });
}
```

### 2. Listen for the result

Subscribe to `restart-audio-result` and surface it. Probably useful as a Zustand store entry or a one-shot event the calling component awaits.

```ts
// pseudo-code
onMessage('restart-audio-result', (msg) => {
  // msg.ok, msg.error, msg.note
  toast(msg.ok ? 'Audio reset OK' : `Audio reset failed: ${msg.error}`);
});
```

### 3. Add a button somewhere reasonable

Two reasonable UX surfaces:

**Option A — Settings → Connection (or wherever rig settings live):** a clear "Restart audio bridge" row with a button. Discoverable when the user is troubleshooting; matches the desktop placement.

**Option B — Tools / overflow menu on the main rig screen:** less prominent but one tap fewer. A kebab menu (⋮) with "Restart audio" alongside other tools.

I'd recommend **A first** (Settings) for parity with desktop, plus a copy of the same action under **B** if there's already a tools menu. Don't surface it as a primary action on the main screen — it's a recovery action, not a frequent one.

### 4. Optional polish: detect and offer

The phone's WebRTC audio track has a peak-energy reading available (see how the existing TX meter / mic level UI gets it). If the phone's incoming audio track has been silent for >10 seconds while the desktop is connected and the user has audio expected (paired, rig in RX, no FreeDV mute), surface a non-blocking banner:

> "No audio from the rig. Tap to restart audio."

Tap fires `restart-audio`, dismisses on `restart-audio-result.ok`. This is the high-leverage version because the user doesn't have to know what's wrong — the app notices and offers the fix.

If detection is too speculative for v1, ship the manual button alone; we can layer the auto-banner on later.

### 5. Test path

1. Pair the iOS app to a desktop running master.
2. RDP into the shack PC from another device. Notice the audio glitch.
3. Switch back to ECHOCAT iOS, tap "Restart audio".
4. Verify rig audio resumes within ~2 seconds.
5. Verify the rest of the connection (rig control, spots, current frequency) is unaffected through the restart.

## Open questions for the iOS team

- Does the existing `EchocatClient` already have a generic `onMessage(type, callback)` subscriber, or is each new S2C message individually wired? Both shapes work; just a question of where the boilerplate lands.
- Where in the existing UI is the most natural home for the button? I picked Settings as a starting suggestion; you'll know better than I do if there's a more obvious spot.
- Is the "auto-detect silence and offer the button" feature worth pursuing in v1, or queue it as a follow-up after the manual path ships?
