# third_party/wsprd — GPLv3 WSPR decoder (separate program)

This directory holds **`wsprd`**, the WSPR decoder by Joe Taylor (K1JT), Steven
Franke (K9AN), and the WSJT Development Group. It is licensed under the **GNU
General Public License v3.0 (GPLv3)** — a different license from POTACAT, which
is Apache-2.0.

## Why this is here and why it doesn't relicense POTACAT

POTACAT does **not** link this code. `wsprd` is built as a **standalone
executable** and invoked by POTACAT over a child process (`lib/wspr-decoder.js`):
POTACAT writes a 2-minute `.wav`, runs `wsprd`, and parses its stdout. The two
programs communicate only through that arm's-length interface.

Under the GPL, that makes them **separate works distributed together** ("mere
aggregation", GPLv3 §5) — POTACAT stays Apache-2.0; `wsprd` stays GPLv3. The one
rule that must never be broken: **do not link `wsprd` into the POTACAT/Electron
binary** (no native addon, no shared library, no `require()` of its code). Keep
it a separate process.

## GPLv3 compliance obligations (for POTACAT distributing the binary)

Because POTACAT redistributes the compiled `wsprd`, it must, for that binary:

1. **Ship the GPLv3 license text** alongside it — `third_party/wsprd/LICENSE`.
2. **Offer the corresponding source.** Vendoring the source here satisfies this;
   keep the upstream source (and any local patches) in this directory.
3. **Preserve upstream copyright notices.**

None of this affects POTACAT's own Apache-2.0 license. See the repo-root `NOTICE`.

## Provenance

- Upstream: WSJT-X (`wsprd.c`, `wsprsim.c`, supporting DSP) —
  https://sourceforge.net/p/wsjt/wsjtx/
- Vendor the `wsprd` sources used for the build under `src/` here, with the
  exact upstream version/commit recorded in `VERSION.txt`.

## Build (per platform, for release CI)

`wsprd` upstream depends on FFTW. To avoid the FFTW cross-build/GLIBC pain that
bit POTACAT's native addons before, prefer **static-linking the FFT** (FFTW
static, or a kiss_fft shim) so the produced binary has no runtime lib
dependency.

- **Linux:** build on **ubuntu-22.04** (glibc 2.35) — never 24.04 — so the binary
  runs on Raspberry Pi OS Bookworm and older distros. Build both `x86_64` and
  `arm64`.
- **Windows:** static build → `wsprd.exe`.
- **macOS:** universal (`x86_64` + `arm64`) if feasible, else per-arch.

Output goes to `third_party/wsprd/build/wsprd[.exe]` for dev runs.
`lib/wspr-decoder.js#resolveWsprdPath()` looks there in dev and at
`resources/bin/wsprd[.exe]` in packaged builds.

## Packaging

electron-builder ships the platform binary via `extraResources` →
`resources/bin/wsprd[.exe]`. It is **bundled but never linked**. The user
installs nothing extra; from their side it's one app.

---

*Placeholder: the GPLv3 `LICENSE`, `VERSION.txt`, vendored `src/`, and built
binaries are added when the WSPR decoder build is wired into CI. This README
documents the firewall and obligations so that step is mechanical.*
