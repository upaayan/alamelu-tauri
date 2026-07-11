# Alamelu Pi External Provider Authentication Bridge Audit

<!-- critic_id: /root/provider_auth_critic -->

## Implementation Audit Round 1

Verdict: PASS

No HIGH or MEDIUM findings. One LOW compatibility note is recorded below.

Confirmed implementation behavior:

- The desktop remains a thin wrapper around the resolved external `pi`. The bridge dynamically imports the installed package from that CLI's `dist` directory; it does not add a bundled Pi dependency. The built desktop output contains no `@earendil-works/pi-coding-agent`, `pi-ai`, or `pi-agent-core` runtime import.
- Provider credentials remain inside Pi. The supervisor no longer reads `auth.json`; the bridge uses Pi's public `AuthStorage` and `ModelRegistry` APIs. It reduces stored credentials to the non-secret `oauth`/`api_key` type before creating a runtime record, and no credential value is returned through the renderer/preload boundary.
- Provider inventory now comes from the installed Pi `ModelRegistry.getAll()` rather than only `pi --list-models`, so unauthenticated API-key providers such as OpenAI are available for initial setup. Pi's own `getProviderAuthStatus()` and `hasAuth()` cover environment and `models.json` configurations without exposing keys.
- Stored OAuth and API-key credentials are classified separately, including dual-capability providers such as Anthropic. The UI correctly presents separate subscription/API-key actions before setup and API-key management afterward.
- The signing path was reviewed and not changed or invoked during this audit. Any later package/install must use only `pnpm --filter @pi-gui/desktop run package:alpi:dir`, which performs the documented AWS-backed explicit-keychain unlock, identity-hash signing, no timestamp, and verification. No keychain inspection, default Electron signing, or Apple password prompt path was used.

Verification reviewed or run:

- `node --test apps/desktop/tests/unit/external-pi-auth-bridge.test.mjs` — 3 passed.
- `pnpm --filter @pi-gui/desktop run typecheck` — passed.
- `pnpm --filter @pi-gui/desktop run build` — passed.
- Focused external-RPC UI coverage passed for OpenAI API-key setup, dual Anthropic subscription/API-key behavior, environment-managed auth, and `models.json` external auth. The full 8-test provider-settings spec also completed without failure artifacts.
- `git diff --check` — passed.

LOW — Pi 0.x compatibility is intentionally fail-fast for the private interactive-mode `isApiKeyLoginProvider` helper. If Pi moves or removes that helper, the bridge reports a clear compatibility error instead of silently guessing API-key eligibility or touching credential files. Updating the bridge or Pi is then required; current Pi 0.79.1 exposes the helper and is covered.

## Post-Audit Release Verification

The approved change was packaged only through `pnpm --filter @pi-gui/desktop run package:alpi:dir`. The script completed its explicit-keychain, identity-hash signing and verification route without an interactive Apple password prompt. The candidate passed packaged runtime dependency verification and an isolated real-Electron smoke test.

The prior installed application was moved intact to `/Applications/Alamelu Pi.app.before-provider-auth-20260711-102028`, then the verified candidate was copied to `/Applications/Alamelu Pi.app`. The installed app passed hardened-signature verification and the same isolated smoke test.
