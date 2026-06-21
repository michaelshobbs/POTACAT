# assets/wsprd — bundled WSPR decoder (populated at build time)

This directory is the staging area for the GPLv3 `wsprd` binary that gets
bundled into packaged builds. It mirrors `assets/hamlib/` (the `rigctld`
binary): the release workflow drops the platform binary here, and
`package.json` → `build.extraResources` copies it to `resources/bin/wsprd`
(where `lib/wspr-decoder.js#resolveWsprdPath()` looks in packaged builds).

**The binary is NOT committed** (it's per-platform and GPL) — `.gitignore`
excludes `wsprd`, `wsprd.exe`, and the shared libs. Until the CI build step
lands, packaged builds ship without it and WSPR shows "decoder not installed"
(graceful). In **dev**, `resolveWsprdPath()` instead uses
`third_party/wsprd/build/` (see `third_party/wsprd/BUILD.md`).

## Wiring it into the release workflow (mirrors the hamlib step)

Add a per-platform step in `.github/workflows/release.yml`, BEFORE
electron-builder, that puts the binary (+ its runtime libs) here:

```yaml
# macOS / Linux — install WSJT-X (ships wsprd) and copy the binary + deps
- name: Stage wsprd into assets/wsprd/
  run: |
    # macOS:  brew install --cask wsjtx   (then copy from the .app + otool deps)
    # Linux (ubuntu-22.04, glibc 2.35):  apt-get install -y wsjtx
    #         cp "$(command -v wsprd)" assets/wsprd/wsprd && chmod +x assets/wsprd/wsprd
    #         ldd deps -> copy libfftw3f etc. if not present on target
    # Windows: copy wsprd.exe + the 6 MinGW/FFTW DLLs from a WSJT-X install
    #          (libfftw3f-3, libgcc_s_seh-1, libgomp-1, libquadmath-0,
    #           libstdc++-6, libwinpthread-1) — same set used in dev.
```

GPLv3 compliance: ship the GPLv3 license + offer corresponding source. See
`third_party/wsprd/README.md` / `BUILD.md`.
