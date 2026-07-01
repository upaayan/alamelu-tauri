# Alpi Sidebar Defaults And No Repository Implementation

Plan: `documents/plan-audit-implementation/alpi_sidebar_no_repository_plan.md`
Audit: `documents/plan-audit-implementation/alpi_sidebar_no_repository_audit.md`

## Scope Note

The lab checkout already had many Alpi/RPC-related dirty files before this implementation. This report covers the scoped changes made for the sidebar default-collapse and `No Repository` / `New Workspace...` request, plus the rebuild, signing, replacement, and verification performed afterward.

## Implemented Behavior

- Sidebar workspace groups now default to collapsed. Repo/workspace rows remain visible, and thread rows appear after expanding the workspace.
- The collapse helpers use an effective default of collapsed, so the first click expands and programmatic reveal after starting a thread stores the expanded state.
- Alpi creates a real app-owned scratch workspace at `<userDataDir>/No Repository` and marks it with `specialKind: "no-repository"`.
- Renderer logic uses the stable `specialKind` marker rather than display-name checks.
- New-thread picker now has a `Repository` label, includes `No Repository`, and exposes a final `New Workspace...` option.
- Selecting `New Workspace...` calls the existing folder picker path.
- Selecting `No Repository` forces local mode and disables worktree-only behavior for that selection.
- Alpi RPC startup no longer auto-adds the generic lab `workspace` folder as a visible default workspace; the no-repo scratch workspace is enabled only for Alpi branding.
- The sidebar hides permanent-worktree creation for the no-repo workspace.

## Source Files

- `apps/desktop/src/desktop-state.ts`
- `apps/desktop/src/workspace-roots.ts`
- `apps/desktop/electron/app-store-utils.ts`
- `apps/desktop/electron/app-store.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/src/hooks/use-workspace-menu.tsx`
- `apps/desktop/src/sidebar.tsx`
- `apps/desktop/src/new-thread-view.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/tests/core/new-thread-composer.spec.ts`
- `apps/desktop/tests/core/sidebar-ordering.spec.ts`
- `apps/desktop/tests/native/open-folder.spec.ts`
- `apps/desktop/tests/helpers/electron-app.ts`

## Verification

Passed:

```bash
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop typecheck
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop build
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/new-thread-composer.spec.ts apps/desktop/tests/core/sidebar-ordering.spec.ts
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/native/open-folder.spec.ts
PI_APP_PACKAGE_FLAVOR=alpi PI_APP_REQUIRED_PI_CODING_AGENT_VERSION=0.78.0 PI_APP_REQUIRED_ANTHROPIC_OPUS_MODEL_ID=claude-opus-4-8 node apps/desktop/scripts/assert-packaged-runtime-deps.mjs
codesign --verify --deep --strict --verbose=2 "/Applications/Alamelu Pi.app"
```

Focused Playwright results after the build:

- Core new-thread/sidebar run: 7 passed.
- Native folder-picker run: 6 passed.

Important note:

- A first focused Playwright run before rebuilding failed because `test:e2e:runner` uses the built Electron output. After running the desktop build, the same focused tests passed.

## Rebuild, Signing, And Replacement

- Rebuilt Alpi package into `apps/desktop/release-alpi/mac-arm64/alpi.app`.
- Replaced `/Applications/Alamelu Pi.app` with the rebuilt app.
- Signed the installed app using AWS Secrets Manager secret name `alamelu/pi-codesign` in region `ap-south-1`.
- Did not print or store signing credential values.
- Verified installed app signature:
  - identifier: `com.alamelu.pi`
  - authority: `Alamelu Pi Local Code Signing`
  - `codesign --verify --deep --strict` passed.
- Alpi doctor status:
  - `codesign` verification passed.
  - `spctl` rejected the app because the signer is local/non-notarized.
  - The app has no quarantine attribute.
  - The installed executable launched successfully in the smoke test.

## Installed-App Smoke

Launched `/Applications/Alamelu Pi.app/Contents/MacOS/alpi` with Alpi branding and a temporary user data directory.

Observed:

- Installed app state included `No Repository` with `specialKind: "no-repository"`.
- New-thread picker options included `No Repository`.
- New-thread picker options included `New Workspace...`.
- New-thread picker options did not include the old standalone `Workspace` option.

## Implementation Audit

Debate-loop implementation audit passed.

Residual note:

- If Alpi cannot create or sync the app-owned `No Repository` directory, startup is preserved and the error is logged, but the error is not surfaced in the UI.
