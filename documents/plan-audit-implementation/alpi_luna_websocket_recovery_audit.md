# Alamelu Pi Luna WebSocket Recovery — Audit

<!-- critic_id: /root/luna_websocket_recovery_critic -->

This is an implementation-only debate-loop audit.  Review sections and
responses are append-only.

## Implementation Audit Round 1

Verdict: PASS

I independently inspected the implementation, the installed external Pi
provider/extension contract, and the changed tests.  No HIGH or MEDIUM issue
was found.

- Child-process state is repaired in the correct process.  The branded desktop
  process passes the explicit extension path into the spawned Pi RPC child,
  and the extension calls Pi's existing reset helper with that child's
  `sessionManager` ID.  The helper clears the provider's same-process
  SSE-fallback set.  The installed Pi provider is loaded relative to the same
  provider file, so the dynamic file-URL import shares its Node module cache;
  this does not attempt to recreate or patch Pi's transport.
- The `.ts` resource is deliberate and valid for Pi's Jiti extension loader.
  The extension resolves the Pi package through Jiti, derives the private
  provider file, and verifies both its existence and reset export before
  registering (resource lines 41-64).  Pi's loader contains factory failures
  rather than crashing the child, and the recorded external-Pi RPC smoke
  succeeded.
- The recovery gate is appropriately narrow: assistant-only,
  `openai-codex` / `gpt-5.6-luna`, then either a WebSocket error or Pi's
  `provider_transport_failure` diagnostic whose fallback is SSE (resource
  lines 20-38).  It excludes `Model not found` and other models/providers.
  That covers both the observed after-stream failure and the pre-stream
  fallback case that otherwise poisons the next turn.
- Retry handling preserves Pi's event order.  A finalized assistant error is
  held pending, `agent_end.willRetry` does not complete the run, and the next
  `agent_start` clears the transient error; only a final end produces
  `runFailed` (driver lines 347-400).  The two focused regression tests cover
  both retry-success and terminal-error sequences.
- Packaging propagates the exact external resource through
  `electron-builder.alpi.yml`, with separate development and packaged paths
  checked at desktop startup.  The existing documented package/signing wrapper
  is left intact; no new signing path, Apple credential prompt, provider
  configuration, authentication data, or external Pi files are introduced.

Independent verification in this audit:

- `node --no-warnings --experimental-strip-types --test
  apps/desktop/tests/unit/alpi-luna-websocket-recovery.test.mjs
  apps/desktop/tests/unit/alpi-packaging.test.mjs` — 3 passed.
- `pnpm --filter @alamelu-pi/pi-rpc-driver test` — 44 passed.
- `git diff --check` — passed.

The implementation satisfies the requested repair and is cleared for the
post-audit commit/package/deploy sequence.
