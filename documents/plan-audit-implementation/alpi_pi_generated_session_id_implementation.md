# Alamelu Pi Pi-Generated Session IDs — Implementation

This is an implementation-only debate-loop artifact at the user's request; no separate planning phase was requested.

## Root Cause

Alamelu Pi's RPC driver creates every new session with Node's `randomUUID()` (UUIDv4) and passes it to external Pi as `--session-id`.

Pi's normal CLI lets Pi create the new-session identity. Pi forwards that identity to the Codex backend as both `session-id` and `x-client-request-id`, and uses it for the prompt cache key. Fresh Pi-generated identities observed in the controlled paths are UUIDv7, but the implementation does not assume that UUID version alone is the backend contract. With otherwise identical external-Pi RPC settings:

- forced UUIDv4: `openai-codex/gpt-5.6-luna` at `xhigh` ends with 404 `Model not found gpt-5.6-luna-free-1p-codexswic-ev3`;
- Pi-generated UUIDv7: the same model, provider, thinking level, environment, and RPC commands return normally.

The user's successful CLI session confirms the same `openai-codex/gpt-5.6-luna` and `xhigh` combination works with Pi's generated UUIDv7 identity. Sol and Terra also work in the current Alamelu Pi RPC path.

## Scoped Change

- New Alamelu Pi sessions must start the external Pi RPC process without a forced session ID.
- The driver must use the session ID returned by Pi's `get_state` response as its catalog/session reference.
- Reopening an existing session must retain its supplied session ID, preserving historical transcript access and current behavior.
- Do not read, write, copy, or expose Pi credentials or model configuration.
- Do not migrate existing UUIDv4 sessions in this change. They remain readable; a new thread is required to use Luna after the fix.

## Test-First Verification

1. Add a focused Pi RPC driver unit test proving new-session creation does not request a forced ID and adopts Pi's returned ID.
2. Prove existing-session open still requests its known ID.
3. Run the focused unit test red before production changes, then green after the smallest implementation change.
4. Run desktop typecheck, build, and focused external-RPC UI coverage.
5. Run an isolated external-Pi RPC Luna smoke with Pi-generated session state, then send the concrete verification evidence to the implementation critic.

## Release Boundary

No source change may be committed or installed until an Implementation Audit PASS is recorded in the paired audit document.

## Verification Record

- Test-first red: both new-session tests failed against the previous build: the driver requested a locally generated UUID and silently fell back to it when `get_state` had no Pi session ID.
- Focused green: both new-session tests pass after the change.
- Full driver regression: `pnpm --filter @pi-gui/pi-rpc-driver test` — 41 passed.
- Desktop integration: `pnpm --filter @pi-gui/desktop run typecheck` and `pnpm --filter @pi-gui/desktop run build` — passed.
- Focused external-runtime UI regression: `provider-settings.spec.ts` “thin external runtime saves an API key through installed Pi” — passed.
- Live external-Pi verification, using temporary user-data/session/workspace state and the app's normal external executable/agent settings: a fresh session selected `openai-codex/gpt-5.6-luna` at `xhigh` and returned the expected `ALPI_LUNA_RPC_OK` response. A separate non-sensitive state check confirmed Pi generated a UUIDv7 identity. No credential or model-configuration file was read or modified.
