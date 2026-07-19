# Alamelu Pi logo replacement — audit

<!-- critic_id: 019f7b61-2337-76b3-a9ae-eb73b3abbae7 -->

Implementation under review:
`documents/plan-audit-implementation/alpi_logo_replacement_implementation.md`

Scope: laptop-only Alamelu Pi logo replacement. The approved source asset is
`/Users/sudhirjha/playground/alamelu/documents/alamelu-logo-new.png`.

The critic will append implementation audit rounds below. Existing source and
user changes must be preserved.

## Implementation Audit Round 1

- [INFO] The approved PNG is wired consistently through the implementation.
  `apps/desktop/src/icons.tsx` imports `resources/alpi-icon.png`; the production
  renderer bundle contains that PNG byte-for-byte; `electron-builder.alpi.yml`
  copies the same PNG to packaged `Resources/icon.png` for the runtime/Dock path
  and selects `resources/alpi-icon.icns` for the macOS application/Finder icon.
  The 16-1024 px iconset files have the expected dimensions, the repeated 1x/2x
  representations agree, and the PNG derivatives reproduce direct resizes of
  the approved 1254 px source. The ICNS is structurally readable and contains
  the supplied iconset representations.
- [INFO] Deleting `apps/desktop/resources/alpi-icon.svg` is safe for this change.
  Repository-wide live-reference inspection found no remaining source, build,
  packaging, or test reference to that SVG; the only remaining mention is the
  implementation record documenting its deletion. The successful production
  build also emitted the replacement hashed PNG rather than the deleted SVG.
- [MEDIUM] The recorded verification does not yet prove the visual change on the
  real Electron surface. Typecheck passed, all 33 recorded unit tests passed,
  and the production build emitted the replacement PNG, but no recorded
  Electron/Playwright result asserts that the new-thread `<img>` completed
  loading with nonzero natural dimensions and the built PNG URL. This leaves the
  acceptance criterion that the new-thread logo actually renders unverified and
  conflicts with the repository requirement that desktop work be verified on
  the real Electron surface. Resolve this without signing by running and
  recording a focused real-Electron check against the current build that proves
  the image is visible and loaded (not merely that its container is visible).
- [LOW] The existing `release-alpi/mac-arm64/alpi.app` predates the replacement
  assets and must not be treated as the candidate for this change. The documented
  AWS-backed wrapper mitigates this by deleting `release-alpi`, rebuilding
  unsigned, unlocking the explicit keychain using the AWS-managed secret,
  signing by identity hash with no timestamp, and verifying the rebuilt bundle.
  After this audit reaches PASS, the safe deployment order is: run only that
  wrapper, inspect bundle identity, verify the candidate, run the candidate
  smoke test, preserve the installed app as a backup, replace it only with the
  verified candidate, then verify and smoke-test the installed app. No signing
  credential value needs to be printed or passed through user-facing output.

Verdict: REVISE

## Response to Implementation Audit Round 1

Accepted: the MEDIUM finding was valid. I added a real Electron regression
assertion in `apps/desktop/tests/core/new-thread-composer.spec.ts` that checks
the new-thread logo is visible, complete, 512×512, and loaded from the hashed
`alpi-icon-*.png` production asset. I also made the existing Alamelu Pi test
fixture declare `PI_GUI_BRAND=alpi`; without that fixture setting, the
development app has no explicit driver and fails before creating a window.

The focused Electron test passed with 1 test and 0 failures. The LOW finding
remains addressed by using only the AWS-backed packaging wrapper after audit
PASS; no signing or installation has occurred yet.

## Implementation Audit Round 2

- [RESOLVED MEDIUM] The response fully closes Round 1's real-Electron evidence
  gap. The updated core Playwright test launches the built desktop application
  through the repository's Electron harness, targets the actual `<img>` inside
  `new-thread-logo`, requires it to be visible, waits for `complete: true`, and
  asserts intrinsic dimensions of 512×512. It also requires the `src` to end in
  the hashed `alpi-icon-*.png` production asset rather than merely accepting a
  visible wrapper or an arbitrary image. The implementation records the focused
  run as 1 test passed, and the Playwright result record reports `status:
  passed` with no failed tests.
- [INFO] Setting `PI_GUI_BRAND=alpi` in this Alamelu Pi test fixture is scoped to
  the test launch and is appropriate: it supplies the explicit brand/driver
  context needed to construct the real Electron window without changing
  application behavior or weakening the logo assertions.
- [INFO] No HIGH or MEDIUM implementation issues remain. Round 1's PNG/ICNS
  consistency and safe SVG deletion conclusions remain valid. Its stale
  pre-change `release-alpi` observation is an operational post-PASS gate, not a
  blocker: the existing bundle must not be installed, and the documented
  AWS-backed wrapper must rebuild and verify a fresh candidate before the
  backup/install/installed-app verification sequence.

Verdict: PASS
