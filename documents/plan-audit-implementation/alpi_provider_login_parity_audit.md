<!-- critic_id: 019eed5a-f5b1-7020-9dd6-cafdaee53a0e -->
<!-- critic_id_replaced: 2026-06-22T04:08:33Z 019eed5a-f5b1-7020-9dd6-cafdaee53a0e -->
<!-- critic_id: 019eed83-ef41-76f3-bfb0-74f65679b4fc -->

# Alpi Provider Login Parity Audit

## Plan Audit Round 1

Verdict: PASS

Findings: None.

Notes:
- The plan matches the current gap: `RuntimeLoginCallbacks` only exposes `onAuth`, `onPrompt`, `onProgress`, `onManualCodeInput`, and `signal` in `packages/session-driver/src/runtime-types.ts:125`, while `toOAuthLoginCallbacks()` currently collapses device-code and select flows into `onAuth`/`onPrompt` in `packages/pi-sdk-driver/src/runtime-supervisor.ts:851`.
- The existing Electron path does use `window.prompt` and only opens the browser from main, at `apps/desktop/electron/main.ts:1068`, so the proposed main-process session controller plus renderer dialog is the right shape.
- During implementation, keep the callback contract aligned with upstream `OAuthLoginCallbacks` (`onSelect` returns `Promise<string | undefined>`, `onManualCodeInput` is no-arg, and `onAuth`/`onDeviceCode` are effectively fire-and-forget), and update any generated or vendored session-driver typings if the build depends on them.

## Implementation Audit Round 1

Verdict: PASS

Findings: None.

Notes:
- The implementation preserves rich OAuth callbacks while retaining legacy fallbacks in `packages/pi-sdk-driver/src/runtime-supervisor.ts:853`; focused adapter coverage confirms both paths in `packages/pi-sdk-driver/test/runtime-supervisor.test.mjs:95` and `packages/pi-sdk-driver/test/runtime-supervisor.test.mjs:133`.
- The Electron login controller provides one active session, request ids, abort handling, renderer state publishing, URL protocol validation, pending-promise cleanup, and window-close cancellation in `apps/desktop/electron/main.ts:130`, `apps/desktop/electron/main.ts:235`, `apps/desktop/electron/main.ts:320`, `apps/desktop/electron/main.ts:333`, and `apps/desktop/electron/main.ts:500`.
- The renderer dialog covers provider selection, browser/manual fallback, device-code display, prompt/progress/error/cancel states in `apps/desktop/src/provider-login-dialog.tsx:108`; Settings and current slash-menu entry points route through `startProviderLogin()` in `apps/desktop/src/App.tsx:394`, `apps/desktop/src/App.tsx:924`, `apps/desktop/src/App.tsx:965`, and `apps/desktop/src/App.tsx:1788`.
- Mocked OAuth verification does not require live provider auth: `PI_APP_TEST_PROVIDER_LOGIN_FLOW=1` drives deterministic browser/manual and device-code paths in `apps/desktop/electron/main.ts:1330`, with focused Playwright coverage in `apps/desktop/tests/core/provider-settings.spec.ts:225` and `apps/desktop/tests/core/provider-settings.spec.ts:278`.
- Fresh verification run during audit: `node --test packages/pi-sdk-driver/test/runtime-supervisor.test.mjs` passed 5 tests; `npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run typecheck` passed; `npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/provider-settings.spec.ts` passed 6 tests.
