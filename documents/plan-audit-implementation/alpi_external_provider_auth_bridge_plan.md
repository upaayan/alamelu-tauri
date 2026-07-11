# Alamelu Pi External Provider Authentication Bridge Plan

## Goal

Restore useful provider setup in Alamelu Pi while keeping the installed `pi` CLI as the only Pi runtime. Users must be able to connect subscriptions through Pi OAuth and save/remove Pi API keys from the desktop UI.

## Design

- Keep the existing provider-login controller, IPC boundary, and renderer dialog. They already implement Pi's browser, device-code, redirect-paste, selection, progress, and cancel callbacks.
- Add a small main-process bridge that resolves the installed `pi` executable, derives its package root, and dynamically imports Pi's public `AuthStorage` and `ModelRegistry` APIs. The bridge must not bundle Pi, write `auth.json` itself, or expose credentials to the renderer.
- Reuse Pi's own interactive-mode capability rule for API-key providers. This keeps Alpi aligned with Pi CLI `/login` instead of maintaining a copied provider list.
- Have `ExternalPiRuntimeSupervisor` use the bridge for login, logout, API-key persistence, provider capabilities, and non-secret authentication status. Keep `pi --list-models` as the model-details authority, while using Pi's model registry to discover unauthenticated API-key providers that the CLI omits.
- When Pi supports both methods for the same provider, display separate `Use subscription` and `Set API key` actions. Preserve existing one-action behavior for OAuth-only, API-only, environment-managed, and externally configured providers.

## Safety Constraints

- Never read or write provider credentials directly; use only Pi's public `AuthStorage` methods.
- Dynamically load the runtime from the resolved external `pi` CLI path so no second Pi runtime enters the ASAR.
- Tests use fake or temporary agent state only; no live provider login is part of automated verification.
- Packaging follows `/Users/sudhirjha/playground/alamelu/documents/alpi-signing-eli5.md`: only `package:alpi:dir`, AWS-backed explicit keychain unlock, identity hash, no timestamp, and no keychain inspection.

## Verification

- Unit test the bridge with a fake installed Pi module and assert that login/API-key/logout delegate to `AuthStorage`.
- Run desktop typecheck and build.
- Run provider Settings coverage in Alpi/RPC mode with a temporary agent directory; prove API-key setup uses the external runtime and dual-capability providers present both connection methods.
- Before installation, package through the documented signer, verify the candidate, and smoke-test it with isolated app and Pi state.
