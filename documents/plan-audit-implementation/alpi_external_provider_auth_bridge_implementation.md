# Alamelu Pi External Provider Authentication Bridge Implementation

Plan: `documents/plan-audit-implementation/alpi_external_provider_auth_bridge_plan.md`

## Scope

The thin external-Pi migration deliberately left provider login, logout, and API-key persistence unsupported. This change restores those flows without adding a bundled Pi runtime or modifying Pi credential files directly.

## Implementation

- Added `apps/desktop/electron/external-pi-auth-bridge.ts`.
  - Resolves the real installed `pi` CLI to its package root.
  - Dynamically imports Pi's public `AuthStorage` and `ModelRegistry` entrypoints at runtime.
  - Uses Pi's own API-key eligibility helper when available.
  - Delegates OAuth login, API-key save, and logout to Pi `AuthStorage`.
  - Uses the model registry to discover API-key providers before they have configured a credential.
  - Exposes only provider IDs, non-secret status, stored credential type, and capability metadata to the rest of Alpi.
- Updated `ExternalPiRuntimeSupervisor` to use the bridge instead of rejecting provider actions. It refreshes its CLI-backed model/provider snapshot after each auth operation, and combines CLI model rows with Pi's registry so initial API-key setup is available.
- Removed the external supervisor's direct `auth.json` read. Auth state now comes through Pi's non-secret status API.
- Updated provider rows so a provider capable of both methods shows `Use subscription` and `Set API key` separately. OAuth-only and API-only rows keep their existing simple actions.
- Added focused tests:
  - `apps/desktop/tests/unit/external-pi-auth-bridge.test.mjs` uses a fake installed Pi module and verifies delegation without credentials.
  - `apps/desktop/tests/core/provider-settings.spec.ts` adds Alpi/RPC coverage with a temporary agent directory for external API-key setup and dual auth-method actions.

## Verification Before Audit

Passed:

- `node --test apps/desktop/tests/unit/external-pi-auth-bridge.test.mjs` — 3 tests passed.
- `npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run typecheck` — passed.
- `npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run build` — passed.
- `npx --yes pnpm@10.25.0 --filter @alamelu-pi/desktop run verify:external-runtime` — passed against installed Pi 0.79.1.
- Focused packaged-desktop Playwright coverage passed for external API-key setup, dual subscription/API-key actions, environment-managed auth, and `models.json` provider overrides. The full provider-settings spec completed without failure artifacts.

The focused Electron provider settings run uses a temporary Pi agent directory and does not access or alter real provider credentials. A broad unit-test glob has one pre-existing unrelated failure: the packaging test imports `js-yaml`, which is not declared as a direct test dependency.

## Release Verification

- `pnpm --filter @alamelu-pi/desktop run package:alpi:dir` — passed through the documented AWS-backed, explicit-keychain signing wrapper. It produced and verified a hardened `alpi.app` without an interactive Apple password prompt.
- `PI_APP_PACKAGE_FLAVOR=alpi pnpm --filter @alamelu-pi/desktop run verify:packaged-runtime-deps` — passed. The ASAR has required runtime dependencies and no bundled Pi runtime.
- `pnpm --filter @alamelu-pi/desktop run smoke:alpi:candidate` — passed with isolated copied application state and `zai/glm-5.2` available.
- The candidate replaced `/Applications/Alamelu Pi.app` only after the checks above. The former app is preserved at `/Applications/Alamelu Pi.app.before-provider-auth-20260711-102028`.
- `codesign --verify --deep --strict --verbose=1 /Applications/Alamelu\\ Pi.app` — passed.
- An isolated smoke run against the installed app passed and found `zai/glm-5.2`.
