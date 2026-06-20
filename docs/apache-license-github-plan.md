# POTACAT → Apache-2.0: GitHub migration plan

Relicensing POTACAT from MIT to **Apache-2.0**, and the GitHub-side changes that
go with it. ECHOCAT stays **proprietary** (sold separately). The names
**POTACAT** / **ECHOCAT** are protected by **trademark**, not by the code
license — see `TRADEMARKS.md`.

---

## 0. What's already done in the repo (this branch)

- [x] `LICENSE` → full Apache-2.0 text, "Copyright 2024-2026 Casey Stanton".
- [x] `package.json` → `"license": "Apache-2.0"`.
- [x] `NOTICE` → attribution + third-party components (ft8_lib MIT; wsprd GPLv3 as a *separate* bundled program).
- [x] `TRADEMARKS.md` → name/brand policy (Apache §6 carve-out spelled out).

The rest below is the GitHub + housekeeping work.

---

## 1. The one legal check: contributor consent

Relicensing needs the copyright holders' agreement. Commit authors to date:

| Author | Commits | Who |
|---|---|---|
| Waffleslop / Casey Stanton | ~1552 | **You** |
| Claude <noreply@anthropic.com> | 5 | Tool output (your operation — you hold it) |
| **Charles Sparrow** | 4 | external |
| **Hitman90210** | 4 | external |
| **Ted Cowan** | 3 | external |
| **Michael Hobbs** | 1 | external |

**The good news:** MIT explicitly permits *sublicensing*. Redistributing the
combined work under Apache-2.0 is allowed by MIT — you are not required to get
each contributor's sign-off to ship the aggregate under Apache, as long as the
original MIT contributions keep their MIT notice. So the relicense is legally
clean as-is.

**Recommended (courtesy + cleanliness):**
- Post a short heads-up issue tagging @Charles Sparrow, @Hitman90210, @Ted
  Cowan, @Michael Hobbs: "POTACAT is moving MIT → Apache-2.0; your past
  contributions are included. MIT permits this; flagging for transparency. 👍 to
  acknowledge." A thumbs-up from each removes all doubt.
- Going forward, a **DCO sign-off** (below) makes every future contribution
  unambiguously Apache-2.0 and ends this question permanently.

---

## 2. GitHub repo changes

1. **License auto-detection.** GitHub reads `LICENSE` and shows "Apache-2.0" in
   the repo sidebar / About box automatically once committed. Nothing to toggle.
   After merge, confirm the About panel says **Apache-2.0** (not MIT).
2. **README license section + badge.** Add at the bottom:
   ```markdown
   ## License

   POTACAT is licensed under the [Apache License 2.0](LICENSE).

   "POTACAT" and "ECHOCAT" are trademarks of Casey Stanton — the license covers
   the code, not the names. See [TRADEMARKS.md](TRADEMARKS.md).

   POTACAT bundles the GPLv3 `wsprd` WSPR decoder as a **separate executable**
   (mere aggregation); this does not affect POTACAT's Apache license. See NOTICE.
   ```
   Badge: `![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)`
3. **Update the old MIT references.** Grep the repo + website for "MIT" and fix
   any stale mentions (README, docs, site footer, package metadata).

---

## 3. Contribution governance (DCO vs CLA)

Pick one. Both make future contributions cleanly Apache-2.0.

- **DCO (Developer Certificate of Origin) — recommended, lightweight.** Require a
  `Signed-off-by:` line on commits (`git commit -s`). Add a DCO bot
  (`https://github.com/apps/dco`) so PRs are checked automatically. Zero friction
  for contributors, and it's the kernel/standard approach.
- **CLA (Contributor License Agreement) — heavier, more power.** A CLA can grant
  *you* the right to relicense contributions later (e.g. dual-license, or move a
  module into proprietary ECHOCAT). Choose this **only if** you want to keep the
  option to pull community contributions into the closed/sold side. It adds
  friction (contributors must sign) and a bot (CLA Assistant).

**Recommendation:** DCO now. It's enough for an Apache project and respects
contributors. Reach for a CLA only if you later decide you need to relicense
outside code into proprietary ECHOCAT — your *own* code you can always relicense.

Add `CONTRIBUTING.md` stating: Apache-2.0, DCO sign-off required, no use of the
POTACAT/ECHOCAT marks per `TRADEMARKS.md`.

---

## 4. SPDX headers (optional, recommended)

Add a one-line header to first-party source files:
```js
// SPDX-License-Identifier: Apache-2.0
// Copyright 2024-2026 Casey Stanton
```
A scripted pass can add it to `lib/`, `renderer/`, `scripts/`, `main.js`,
`preload.js`. **Do NOT** add it to vendored/third-party trees
(`lib/ft8_native/ft8_lib/`, future `third_party/wsprd/`) — those keep their own
headers. SPDX makes the per-file license machine-readable and is what license
scanners expect.

---

## 5. Third-party / GPL compliance structure (lands with WSPR)

When the WSPR decoder ships:
- `third_party/wsprd/` holds the GPLv3 `wsprd` source + its `LICENSE` (GPLv3) +
  a `README.md` explaining it's an independent program invoked over a child
  process (mere aggregation) and how it's built.
- Distribution must **offer the corresponding source** for the wsprd binary
  (vendored source satisfies this) and ship the GPLv3 text alongside the binary.
- `NOTICE` already documents this (done).
- electron-builder `extraResources` ships the per-platform `wsprd` binary; it is
  never linked into POTACAT.

This is the structural payoff of the Apache decision: GPL code can ride along as
a separate program without touching POTACAT's license.

---

## 6. Website + release

- Update potacat.com footer/about and any "MIT" text to Apache-2.0 + link the
  trademark policy. (Hand to the website agent, same as the #43 arch fix.)
- Mention the relicense in the **next** release notes (factual one-liner; **no AI
  attribution** per project policy). Not a release on its own — fold it in.

---

## 7. Order of operations

1. **This branch:** LICENSE / package.json / NOTICE / TRADEMARKS.md (done) +
   README license section + CONTRIBUTING.md + (optional) SPDX pass. Commit.
2. **Post the contributor heads-up issue** (§1) — non-blocking.
3. **Enable the DCO bot** on the repo.
4. **Confirm** GitHub About shows Apache-2.0 after merge.
5. **Website** text update (separate hand-off).
6. WSPR work proceeds on top — `third_party/wsprd/` slots in under §5.

> Not a lawyer; the relicense itself is routine (MIT permits it). The only place
> a professional set of eyes pays off is the eventual USPTO **trademark
> registration** of ECHOCAT (and POTACAT), which is separate from all of the
> above.
