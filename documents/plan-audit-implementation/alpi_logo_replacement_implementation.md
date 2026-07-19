# Alamelu Pi logo replacement — implementation

Source plan/reference: the approved Alamelu Pi logo integration and packaging
plan at `/Users/sudhirjha/playground/alamelu/documents/plan-audit-implementation/alpi_logo_system_workspace_plan.md`, extended by Sudhir's explicit approval of
`/Users/sudhirjha/playground/alamelu/documents/alamelu-logo-new.png`.

## Scope

- Laptop-only Alamelu Pi application.
- Replace the current in-app, packaged-runtime, Finder, and Dock logo assets.
- Preserve all application behavior and user data.
- Use the existing AWS-backed non-interactive signing wrapper.

## Acceptance criteria

- The approved logo is the single visual source for the renderer and macOS icon
  derivatives.
- `@pi-gui/desktop` typecheck/build checks pass.
- The Alamelu Pi package is built unsigned, then signed with the AWS-managed
  identity hash and explicit keychain.
- `codesign --verify --deep --strict` passes on the candidate and installed app.
- The installed app launches and the new-thread logo renders from the new asset.
- No signing secret values appear in logs, documents, or responses.

## Implementation record

Status: implementation complete; audit PASS; deployment in progress.

## Source changes

- `apps/desktop/src/icons.tsx` now loads `resources/alpi-icon.png` for the
  in-app Alamelu Pi mark.
- The obsolete `apps/desktop/resources/alpi-icon.svg` was removed so the old
  logo cannot remain as an alternate source.
- `apps/desktop/resources/alpi-icon.png` and `alpi-icon-1024.png` were derived
  from the approved `documents/alamelu-logo-new.png` asset.
- Every `apps/desktop/resources/alpi.iconset/*` size and
  `apps/desktop/resources/alpi-icon.icns` were regenerated from that same
  approved asset.

## Verification plan

Before deployment:

1. Run the desktop typecheck and production build.
2. Run the focused unit tests covering Alamelu Pi packaging and workspace/logo
   behavior.
3. Run the AWS-backed `package:alpi:dir` wrapper. It builds unsigned, reads
   the signing material internally from AWS Secrets Manager, unlocks the
   explicit keychain, signs by identity hash, and verifies the candidate.
4. Inspect the candidate bundle metadata and run the packaged-candidate smoke
   test.
5. Back up the installed `/Applications/Alamelu Pi.app`, install the candidate,
   verify its signature, and run the installed-app smoke test.

No signing secret values are recorded here or emitted in the user-facing
result.

## Pre-deployment verification results

- `pnpm --filter @pi-gui/desktop typecheck` passed.
- `node --test apps/desktop/tests/unit/*.test.mjs` passed: 33 tests, 0
  failures. Node emitted one existing module-type performance warning for the
  Luna recovery resource; it did not affect the result.
- `pnpm --filter @pi-gui/desktop build` passed. The renderer emitted
  `out/renderer/assets/alpi-icon-i7MqoRpn.png`, confirming the new PNG is in the
  production bundle.
- `pnpm --dir apps/desktop exec playwright test -c playwright.config.ts
  tests/core/new-thread-composer.spec.ts --grep "new thread reuses"` passed:
  1 test. The real Electron assertion confirmed the logo image was visible,
  fully loaded at 512×512, and used the hashed `alpi-icon-*.png` bundle asset.
  The test was also corrected to declare the Alamelu Pi brand explicitly in its
  dev-Electron environment; without that pre-existing fixture setting, the app
  correctly refuses to construct a store without a configured driver.

## Candidate packaging results

- `pnpm --filter @pi-gui/desktop run package:alpi:dir` passed. The fresh
  candidate was built at
  `apps/desktop/release-alpi/mac-arm64/alpi.app` using the AWS-backed wrapper.
- `codesign --verify --deep --strict --verbose=2` passed on the candidate.
- Candidate metadata matched `com.alamelu.pi`, `Alamelu Pi`, executable `alpi`,
  version `0.1.0`.
- `pnpm --filter @pi-gui/desktop run smoke:alpi:candidate` passed against an
  isolated copy of the laptop Alamelu Pi state. It launched the signed
  candidate, preserved the isolated user-data boundary, loaded 585 models,
  found `zai/glm-5.2`, and saw 190 sessions copied from the laptop state.

## Installed-app results

- The previous `/Applications/Alamelu Pi.app` was moved to
  `/Applications/Alamelu Pi.app.before-logo-replacement-20260719-230216`.
- The verified candidate was installed at `/Applications/Alamelu Pi.app`.
- Installed-app `codesign --verify --deep --strict --verbose=2` passed, and
  its app metadata remained `com.alamelu.pi`, `Alamelu Pi`, executable `alpi`,
  version `0.1.0`.
- Candidate and installed `app.asar` and packaged `Resources/icon.png` SHA-256
  values matched exactly.
- The packaged smoke test passed against the installed executable using an
  isolated copy of the laptop state; it loaded 585 models, found
  `zai/glm-5.2`, and saw 190 sessions.

Status: complete.
