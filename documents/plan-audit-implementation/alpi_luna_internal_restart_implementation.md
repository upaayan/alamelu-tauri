# Alamelu Pi Luna Internal Recovery — Implementation

Status: deployed and verified in the installed app

## Scope

Repair Luna's WebSocket-to-SSE poison without making the user quit Alamelu Pi.
The external Pi runtime, subscription authentication, provider configuration,
and documented signing path remain unchanged.

This is an implementation-only debate-loop lifecycle following the earlier
WebSocket-recovery repair. It specifically closes the gap where clearing a
fallback marker after a failure did not recover an already-SSE-routed request
or guarantee the next GUI turn used a clean Pi process.

## Recovery behavior

1. The Alamelu-owned Pi extension now clears Luna's fallback state in
   `before_provider_request`. Pi runs this hook before its Codex provider
   decides between WebSocket and SSE, so a stale live-child marker cannot send
   a later Luna request straight to SSE.
2. If a WebSocket failure falls through to the Luna SSE endpoint in the same
   provider call, Pi records the `provider_transport_failure` diagnostic with
   `fallbackTransport: "sse"`. The extension narrowly replaces that finalized
   Luna assistant error with a retryable WebSocket error. Pi's own auto-retry
   then calls its internal continuation for the original turn; Alamelu does
   not resend a user message, duplicate a transcript entry, or replay tools.
3. After every idle Luna run, the RPC driver replaces only that session's
   external Pi child immediately before its next idle operation. The new child
   receives the same Pi session ID, loads the same JSONL thread/context, and
   starts with a clean process-local transport cache—the same effective reset
   as quitting and reopening the app, without closing the desktop thread.
4. Sol and Terra retain their existing long-lived child behavior.

## Safety and state guarantees

- A child replacement validates that Pi returned the same session ID and the
  saved provider, model, and thinking level before it is installed.
- Exact-session reopen omits launch-level provider/model flags, preventing a
  desktop default from silently overriding the saved Luna/xhigh selection.
- The driver binds events to both the concrete child and a generation counter;
  late events from a retired child cannot update the replacement run.
- Replacement never emits `sessionClosed`, so the desktop store retains its
  thread subscription, catalog state, and command state.
- Idle prompt/configuration operations are serialized. A configuration change
  initiated first applies to the fresh child before the next prompt; one
  initiated after the prompt owns the child is rejected rather than changing a
  model mid-stream.
- A failed replacement leaves the old child intact and sends no new prompt.
- No automatic replay is attempted after a terminal task failure. Pi RPC has
  no safe public resume-current-turn command, and replay could repeat tools.

## Verification before audit

- Test-first regression coverage for pre-request reset, retry conversion,
  same-ID child replacement, native retry, successful two-turn Luna use,
  terminal failure recovery for the following turn, non-Luna non-rotation,
  stale events, replacement failure, reopened model/thinking restoration, and
  both mutation/prompt orderings.
- `node --no-warnings --experimental-strip-types --test
  apps/desktop/tests/unit/alpi-luna-websocket-recovery.test.mjs
  apps/desktop/tests/unit/alpi-packaging.test.mjs
  apps/desktop/tests/unit/rpc-driver-config.test.mjs` — 12 passed.
- `pnpm --filter @pi-gui/pi-rpc-driver test` — 52 passed.
- `pnpm --filter @pi-gui/desktop run typecheck` and build — passed after the
  final concurrency additions.
- Isolated live external-Pi smoke: a temporary session used Luna at `xhigh`
  for two turns and observed a child lifecycle of new session → same session
  ID replacement. The temporary session directory was removed afterward.

## Signing constraint

The only permitted package command is:

```bash
pnpm --filter @pi-gui/desktop run package:alpi:dir
```

It is the documented AWS-backed explicit-keychain/identity-hash wrapper. No
manual signing, keychain inspection, friendly-name signing, or action that
asks the user for an Apple password is introduced.

## Deployment verification

- Packaged only through the documented `package:alpi:dir` wrapper, then
  verified the candidate and installed `/Applications/Alamelu Pi.app` with
  strict deep signature verification. The installed bundle identifies as
  `com.alamelu.pi` / `Alamelu Pi` / `alpi` and continues to use the external
  Pi runtime.
- A real Electron run of the installed app used isolated app data and the
  existing Pi subscription credentials. It created one Luna/xhigh thread and
  completed two consecutive turns: `ALPI_INSTALLED_LUNA_ONE` followed by
  `ALPI_INSTALLED_LUNA_TWO`.
- The second turn therefore ran after the first idle transition, exercising
  the internal same-thread Pi-child replacement rather than relying on an app
  quit/reopen. No Apple password prompt was used or required.
