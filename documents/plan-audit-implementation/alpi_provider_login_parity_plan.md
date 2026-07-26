# Alpi Provider Login Parity Plan

Task: Make the Alamelu Pi desktop Settings -> Providers `Login` button work with the same practical capability as Pi CLI `/login` for OAuth providers such as Anthropic and ChatGPT/OpenAI Codex.

## Current Behavior

- The renderer already shows a `Login` button when `provider.oauthSupported` is true and `provider.authSource === "none"` in `apps/desktop/src/settings-utils.tsx`.
- `apps/desktop/src/App.tsx` calls `api.loginProvider(settingsWorkspace.id, providerId)`.
- `apps/desktop/electron/preload.ts` forwards that call to the `desktopIpc.loginProvider` IPC handler.
- `apps/desktop/electron/main.ts` handles the IPC and calls `store.loginProvider(workspaceId, providerId, createRuntimeLoginCallbacks())`.
- `apps/desktop/electron/app-store.ts` delegates to `runtimeSupervisor.login(...)`.
- `packages/pi-sdk-driver/src/runtime-supervisor.ts` calls `authStorage.login(providerId, toOAuthLoginCallbacks(callbacks))`, refreshes the registry/resources, and auto-enables authenticated-provider models.

The broken part is not the button wiring. The desktop callback bridge is too thin:

- `createRuntimeLoginCallbacks()` only provides `onAuth` and `onPrompt`.
- `onAuth` opens the browser and discards the instructions.
- `onPrompt` uses `window.prompt(...)`, which is not a complete login surface.
- `toOAuthLoginCallbacks()` maps `onDeviceCode` to `onAuth` and `onSelect` to `onPrompt`, so richer flows cannot reach the renderer.

The CLI `/login` path provides a full login dialog with provider selection, browser auth instructions, manual redirect paste fallback, device-code display, progress, and cancellation. Anthropic and OpenAI Codex browser OAuth providers use callback servers and rely on the manual redirect callback being available as a fallback while waiting for the browser redirect.

## Goal

Desktop provider login should be functionally equivalent to Pi CLI `/login`:

- Anthropic login from Settings works without leaving Alamelu Pi except for the browser auth page.
- ChatGPT/OpenAI Codex login supports the provider's Browser login versus Device code choice.
- Browser OAuth shows a clear in-app fallback input for pasting the redirect URL/code when local callback completion does not arrive.
- Device code login shows the verification URL and user code in-app.
- Progress, cancellation, provider errors, and successful completion are surfaced in the app.
- After success, provider status and model availability refresh the same way they do today through `RuntimeSupervisor.login()`.

## Non-Goals

- Do not change Pi auth storage format or write auth files directly from the renderer.
- Do not reimplement provider OAuth logic in Alamelu Pi.
- Do not require real provider credentials in automated tests.
- Do not modify lazydata/trading code.
- Do not replace the existing `authStorage.login()` path unless a provider API incompatibility forces it.

## Design

### 1. Add typed runtime login callbacks for the full OAuth surface

Extend the shared runtime login callback type, likely in `packages/session-driver/src/runtime-types.ts` or the existing local type owner, to represent the full callback surface used by the Pi OAuth layer:

- `onAuth({ url, instructions })`
- `onPrompt({ message, placeholder, allowEmpty })`
- `onProgress(message)`
- `onManualCodeInput(prompt)`
- `onDeviceCode({ userCode, verificationUri, intervalSeconds, expiresInSeconds })`
- `onSelect({ message, options })`
- `signal`

Keep the callbacks optional where provider code already treats them as optional.

### 2. Preserve richer callbacks in the Pi SDK driver

Update `packages/pi-sdk-driver/src/runtime-supervisor.ts` so `toOAuthLoginCallbacks(callbacks)` does not overwrite richer callbacks supplied by desktop:

- If `callbacks.onDeviceCode` exists, pass device-code information through to it.
- Otherwise preserve the current fallback of opening `verificationUri` through `onAuth` with `Enter code ...` instructions.
- If `callbacks.onSelect` exists, pass the selection prompt through to it.
- Otherwise preserve the current fallback of formatting choices into `onPrompt`.
- Continue passing `onManualCodeInput`, `onProgress`, and `signal` through unchanged.

This keeps existing callers working while allowing desktop to implement the same flow as CLI.

### 3. Replace `window.prompt` with a main-process login session controller

Add a small Electron main-process login flow controller, either in `apps/desktop/electron/main.ts` or a new focused module such as `provider-login-flow.ts`.

Responsibilities:

- Create one active login session per main window, with a generated `requestId`, `workspaceId`, `providerId`, and `AbortController`.
- Disable or reject concurrent provider login attempts with a clear message, or cancel the previous session deliberately. Prefer disabling/rejecting for a first implementation.
- Emit login state to the renderer over IPC.
- Resolve renderer responses back to pending provider callback promises.
- Abort and clean up pending callbacks when the user cancels, the window closes, login succeeds, or login fails.
- Clear all in-memory values after completion/cancellation.

The controller should build `RuntimeLoginCallbacks` with:

- `onAuth`: emit an `auth` state containing URL/instructions and attempt `shell.openExternal(url)`.
- `onManualCodeInput`: emit a manual input request and return a promise resolved by renderer submission.
- `onDeviceCode`: emit device-code state and attempt to open the verification URI.
- `onSelect`: emit selectable options and resolve the selected option id.
- `onPrompt`: emit text prompt state and resolve submitted text, honoring `allowEmpty`.
- `onProgress`: emit progress text.
- `signal`: use the session `AbortController.signal`.

Validate external URLs before opening them with `shell.openExternal`; allow only `http:` and `https:`.

### 4. Add renderer IPC API and state

Extend the desktop IPC API in the existing locations, likely:

- `apps/desktop/src/ipc.ts`
- `apps/desktop/electron/preload.ts`
- any renderer global/type declaration used by `window.desktopApi`

New capabilities:

- Subscribe to provider-login state changes.
- Submit a provider-login response by `requestId` and response kind.
- Cancel a provider-login session by `requestId`.

State shape should be explicit and stable, for example:

- `idle`
- `select`
- `auth`
- `manualInput`
- `deviceCode`
- `prompt`
- `progress`
- `error`
- `complete`

Use a discriminated union so renderer behavior is not based on stringly typed ad hoc payloads.

### 5. Build an in-app provider login dialog

Add a renderer component such as `ProviderLoginDialog` and render it from `apps/desktop/src/App.tsx` or the Settings provider view.

Required UI behavior:

- Opens when Settings/New Thread initiates a provider login.
- Shows provider name and current login phase.
- For `select`, shows a compact choice list/buttons for provider choices such as Browser login and Device code login.
- For `auth`, shows the URL/instructions and an `Open Browser` action. Browser opening may still happen automatically from main.
- For `manualInput`, shows a paste field for redirect URL/code plus submit.
- For `deviceCode`, shows verification URI and user code, with a copy action if the existing UI library has one.
- For `prompt`, shows the message and input field.
- For `progress`, shows waiting/progress text.
- Offers Cancel while the login is pending.
- Shows final error if login fails and clears on dismiss.

Do not use `window.prompt` for provider OAuth once this dialog exists.

### 6. Wire Settings and existing slash-menu login through the dialog

Keep the current `api.loginProvider(workspaceId, providerId)` shape if possible so the Settings button and existing slash-menu provider login path continue to call one entry point.

Renderer flow:

- Start the login request through the existing API.
- Let login state events open/update the dialog.
- Disable the specific provider's Login button while a login is pending.
- On success, close or transition the dialog and apply the returned `DesktopAppState`.
- On failure/cancel, surface the error and avoid leaving the app in a stale pending state.

Main flow:

- `loginProvider` IPC should return the refreshed `DesktopAppState` after `store.loginProvider(...)` succeeds, preserving today’s post-login refresh behavior.
- On failure/cancel, reject with a meaningful error and send a terminal login state.

### 7. Security and privacy

- Do not log auth URLs containing transient OAuth values, manually pasted redirect URLs, tokens, device codes beyond necessary UI display, or provider secrets.
- Keep all auth interaction values in memory only.
- Do not persist dialog state.
- Do not expose `~/.pi/agent/auth.json` contents to the renderer.
- Clear pending promise resolvers on completion/cancel.

## Build Order

1. Add/extend the shared runtime login callback types.
2. Update `toOAuthLoginCallbacks()` to preserve richer callback handlers with fallbacks.
3. Add the Electron main-process provider-login session controller and wire `createRuntimeLoginCallbacks()` through it.
4. Add IPC/preload/renderer type support for state events, responses, and cancellation.
5. Add the `ProviderLoginDialog` UI and wire it to Settings/New Thread login actions.
6. Add focused tests with mocked login callbacks.
7. Run typecheck and focused Electron/renderer tests.
8. Only after approval, package/rebuild and replace `/Applications/Alamelu Pi.app` for local smoke testing.

## Expected Source Files

Likely source edits:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/ipc.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/settings-utils.tsx` or the Settings provider section if pending state belongs there
- `apps/desktop/src/styles/main.css`
- a new renderer component, likely under `apps/desktop/src/`
- `packages/pi-sdk-driver/src/runtime-supervisor.ts`
- the runtime callback type owner under `packages/session-driver/src/` or equivalent
- focused tests under `apps/desktop/tests/core/`, `apps/desktop/tests/unit/`, and/or `packages/pi-sdk-driver/test/`

Debate-loop docs:

- `documents/plan-audit-implementation/alpi_provider_login_parity_plan.md`
- `documents/plan-audit-implementation/alpi_provider_login_parity_audit.md`

## Testing Strategy

Automated tests should not perform real OAuth.

Unit-level tests:

- Verify `toOAuthLoginCallbacks()` passes through `onDeviceCode` and `onSelect` when supplied.
- Verify it preserves the existing fallback behavior when richer callbacks are absent.

Electron/core tests:

- Mock `runtimeSupervisor.login()` or the auth-storage callback path to trigger:
  - `onSelect`
  - `onAuth`
  - `onManualCodeInput`
  - `onDeviceCode`
  - `onPrompt`
  - `onProgress`
  - cancellation
- Assert the renderer dialog shows the expected state and submitting/canceling resolves or aborts the underlying callback.
- Assert the provider Login button cannot launch overlapping sessions.
- Assert successful login applies the returned refreshed state.

Manual smoke, after implementation and build approval:

- Logout Anthropic, click Settings -> Provider -> Login, complete browser OAuth or paste redirect URL, confirm provider status changes to logged in.
- Logout ChatGPT/OpenAI Codex, click Login, choose Browser login, confirm browser/manual fallback path works.
- Repeat ChatGPT/OpenAI Codex login and choose Device code, confirm code and verification URL display correctly.

Verification commands should use the repo's package-manager entry point. If plain `pnpm` is not on the shell path, use the repo-established `npx --yes pnpm@...` or `corepack pnpm` form already used by local verification.

Candidate commands:

```bash
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop typecheck
npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/provider-settings.spec.ts
node --test packages/pi-sdk-driver/test/*.mjs
```

Adjust the exact test filenames to match the implementation, and record actual failures if an unrelated local environment issue blocks a focused test.

## Edge Cases

- Browser callback succeeds while manual redirect input is visible.
- Manual redirect input succeeds while the callback server is still waiting.
- User cancels while a provider is waiting for callback/device-code/prompt input.
- Main window closes or reloads mid-login.
- `shell.openExternal()` fails.
- Provider local callback port is unavailable.
- Provider selection is canceled.
- Device code expires.
- A user clicks Login repeatedly or switches providers mid-login.
- Provider auth succeeds but model refresh fails; show the refresh error and avoid pretending login fully completed.
- Unsupported provider or provider without OAuth still follows existing disabled/API-key behavior.
- Existing API-key provider setup is unchanged.

## Acceptance Criteria

- The Settings provider Login button completes Anthropic OAuth in-app with browser auth and manual paste fallback.
- The Settings provider Login button completes ChatGPT/OpenAI Codex auth in-app, including Browser login and Device code choices.
- The flow uses Pi SDK/provider auth rather than direct auth-file manipulation.
- Successful login refreshes provider/model state through `RuntimeSupervisor.login()`.
- Canceled or failed login leaves no stale pending UI and does not require quitting Alamelu Pi.
- Provider OAuth no longer depends on `window.prompt`.
- Focused automated tests cover the callback bridge and renderer state transitions without real credentials.
