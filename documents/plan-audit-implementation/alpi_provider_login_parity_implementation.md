# Alpi Provider Login Parity Implementation

Plan: `documents/plan-audit-implementation/alpi_provider_login_parity_plan.md`

## Scope

Implemented the approved desktop provider-login parity plan with mocked OAuth verification only. Live Anthropic/ChatGPT reauth, copying Pi auth to servers, and server-side auth smoke tests were explicitly not part of this implementation run.

## Source Changes

- Extended the runtime login callback contract in `packages/session-driver/src/runtime-types.ts` with:
  - `onDeviceCode`
  - `onSelect`
  - device-code and select prompt payload types
- Updated `packages/pi-sdk-driver/src/runtime-supervisor.ts` so `toOAuthLoginCallbacks()` preserves rich callbacks supplied by desktop and only falls back to the legacy `onAuth`/`onPrompt` behavior when those callbacks are absent.
- Updated `packages/pi-sdk-driver/src/vendor/session-driver.d.ts` to keep the vendored runtime callback declaration aligned.
- Added a main-process provider login controller in `apps/desktop/electron/main.ts`:
  - one active provider-login session at a time
  - generated request id
  - `AbortController` signal support
  - state publishing to renderer
  - response routing back to pending provider callbacks
  - cleanup on success, error, cancel, and window close
  - URL protocol validation before browser open
- Replaced the old desktop `window.prompt` login callback path with controller-backed callbacks.
- Added narrow IPC channels/types in `apps/desktop/src/ipc.ts` and `apps/desktop/electron/preload.ts`:
  - provider login state subscription
  - provider login response
  - provider login cancel
- Added `apps/desktop/src/provider-login-dialog.tsx` for:
  - provider method selection
  - browser auth URL/instructions
  - manual redirect/code paste
  - device code display
  - text prompt
  - progress/error/cancel states
- Wired Settings and slash-menu `/login` paths through the same login helper in `apps/desktop/src/App.tsx`.
- Added pending-button state for provider rows in `settings-view`, `settings-providers-section`, and `settings-utils`.
- Added focused styles in `apps/desktop/src/styles/main.css`.
- Added mocked provider-login coverage:
  - adapter unit tests in `packages/pi-sdk-driver/test/runtime-supervisor.test.mjs`
  - Settings provider-login Playwright smoke tests in `apps/desktop/tests/core/provider-settings.spec.ts`
- Updated Alamelu progress in `/Users/sudhirjha/playground/alamelu/documents/progress.md`.

## Test Hook

Added `PI_APP_TEST_PROVIDER_LOGIN_FLOW=1` in Electron main for deterministic Playwright coverage. It is only active when explicitly set and does not call real provider auth or mutate real provider credentials.

The mocked flow exercises:

- select Browser login vs Device code login
- browser auth URL state
- manual redirect/code paste
- prompt response
- progress state
- successful completion
- device-code display
- cancellation/abort

When the test hook is active, browser auto-open is suppressed so tests do not launch an external browser.

## Verification

Final post-audit verification:

```bash
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run build
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run typecheck
node --test packages/pi-sdk-driver/test/runtime-supervisor.test.mjs
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/provider-settings.spec.ts
```

Result: all passed. Build completed, desktop typecheck passed, adapter unit tests passed 5/5, and the focused provider-settings Electron spec passed 6/6.

Package build:

```bash
npx --yes pnpm@10.25.0 --filter @alamelu-pi/session-driver --filter @alamelu-pi/pi-sdk-driver run build
```

Result: passed.

Desktop typecheck:

```bash
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run typecheck
```

Result: passed after two implementation fixes:

- renderer provider-login-state narrowing
- manual-code callback return type

Adapter unit test:

```bash
node --test packages/pi-sdk-driver/test/runtime-supervisor.test.mjs
```

Result: 5 tests passed.

Desktop build:

```bash
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run build
```

Result: passed.

Focused Electron provider-settings smoke:

```bash
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/provider-settings.spec.ts
```

Result: passed after rebuilding the Electron app. Six tests passed, including:

- mocked browser/manual OAuth provider login from Settings
- mocked device-code display and cancel from Settings

Note: an earlier run of the same Playwright command failed because `test:e2e:runner` does not build before launching Electron, so it ran the previously compiled app. After `pnpm run build`, the focused spec passed.

Repo hook note:

```bash
command -v simplify || true
rg "simplify" /Users/sudhirjha/playground/pi-gui-rpc-lab -g'package.json' -g'*.md' -g'*.json'
```

Result: no `simplify` command or package script was available; only the instruction in `AGENTS.md` mentions it.

## Security Notes

- No live Anthropic or ChatGPT auth was performed.
- No auth files were read, printed, edited, or copied.
- No server auth sync was performed or needed.
- Auth URLs/manual redirect values are transient in the main/renderer login session and are not persisted by the new code.
- The renderer receives only narrow provider-login IPC methods, not filesystem or process access.

## Packaged Alamelu Pi Build/Install Smoke

Performed on 2026-06-22 after implementation audit, without live provider reauth.

Packaging command shape:

```bash
pnpm --filter @alamelu-pi/desktop run build
electron-builder --mac --dir --publish never -c electron-builder.alpi.yml -c.mac.sign=./scripts/sign-with-identity-hash.cjs
```

Signing notes:

- Signing credentials were read from AWS Secrets Manager secret `alamelu/pi-codesign` in `ap-south-1`.
- Secret values were not printed.
- The keychain was unlocked non-interactively using the secret-managed keychain password.
- The custom signer was required because macOS had duplicate `Alamelu Pi Local Code Signing` identities in the Alamelu and login keychains; passing the identity hash avoided name ambiguity.

Results:

- Packaged app built successfully at `apps/desktop/release-alpi/mac-arm64/alpi.app`.
- `codesign --verify --deep --strict --verbose=2 apps/desktop/release-alpi/mac-arm64/alpi.app` passed.
- Installed to `/Applications/Alamelu Pi.app`.
- Previous installed app backed up to `/Applications/Alamelu Pi.app.before-provider-login-20260622-105650`.
- `codesign --verify --deep --strict --verbose=2 /Applications/Alamelu Pi.app` passed.

Installed-app mocked smoke:

- Launched `/Applications/Alamelu Pi.app/Contents/MacOS/alpi` with isolated temp `PI_GUI_USER_DATA_DIR`, `PI_APP_USER_DATA_DIR`, `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, and `PI_GUI_LAB_WORKSPACE`.
- Set `PI_APP_TEST_PROVIDER_LOGIN_FLOW=1` to avoid live reauth.
- Created a temp workspace/session through IPC to ensure the RPC session was open.
- Settings -> Providers -> Anthropic Login -> mocked browser/manual redirect flow completed and returned the row to `Login`.
- Settings -> Providers -> ChatGPT/OpenAI Login -> mocked device-code flow displayed `TEST-CODE`, cancel closed the dialog, and returned the row to `Login`.

No live Anthropic/OpenAI auth was performed, no real auth files were modified or copied, and no server auth sync was needed.

## Remaining Work

- Implementation audit via debate-loop critic passed on Round 1 with no findings.
- Optional future live provider smoke remains available only if Sudhir explicitly asks for live reauth and server auth copy/sync.
