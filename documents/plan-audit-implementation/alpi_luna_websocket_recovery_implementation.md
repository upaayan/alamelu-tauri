# Alamelu Pi Luna WebSocket Recovery — Implementation

Status: deployed and verified

## Scope

Repair the live-session failure in which Pi's OpenAI Codex WebSocket transport
fails, Pi permanently marks that child session for SSE fallback, and
`gpt-5.6-luna` subsequently receives `Model not found`.  Also surface a final
assistant error as a failure rather than reporting it as a successful short run.

This is an implementation-only debate-loop lifecycle.  It does not change
provider credentials, authentication, provider configuration, or the external
Pi installation.

## Confirmed cause

The affected Alamelu Pi transcript uses a Pi-generated UUIDv7 session ID and
the driver's ordinary continuation path does not respawn or replace that ID.
Inside the live external Pi child, the Codex provider records a WebSocket
failure in its per-process SSE-fallback set.  Its following retry and later
turns for the same session use SSE, where Luna returns `Model not found`.

Pi already exposes `resetOpenAICodexWebSocketDebugStats(sessionId)`, which
removes that fallback marker.  Because its state is in the Pi child process,
the recovery must run as an Alamelu-owned Pi extension loaded into that child.

## Implemented change

1. Added `apps/desktop/resources/alpi-luna-websocket-recovery.ts`, an explicit
   Pi extension loaded only by the Alamelu Pi desktop brand.  It resets Pi's
   existing `resetOpenAICodexWebSocketDebugStats(sessionId)` helper only for
   `openai-codex` / `gpt-5.6-luna` when either:
   - the finalized assistant error names a WebSocket failure; or
   - the finalized assistant diagnostics report Pi's SSE fallback after a
     provider transport failure, including the pre-stream case that can finish
     the current turn but poison the next one.

   The extension is `.ts` deliberately: Pi evaluates explicit TypeScript
   extensions through its own Jiti loader.  That loader resolves the active
   external Pi package; the extension derives Pi's private provider module
   from that resolved package and dynamically imports the existing reset
   helper.  It does not copy or alter Pi provider code.  A runtime existence
   and export check fails safely if Pi changes that internal layout.
2. Thread an optional extension path through the RPC spawn configuration and
   load that resource only for the Alamelu Pi brand.  User-configured Pi
   extensions remain enabled.
3. Preserve Pi retry semantics in the RPC driver: do not emit a completed run
   on `agent_end` when Pi says it will retry; clear a pending transient error on
   the retry's next `agent_start`; emit `runFailed` only for a final assistant
   error.
4. Package the extension through the documented Alamelu Pi packaging wrapper;
   do not introduce an alternate signing path or any action that requests an
   Apple password.

The packaged resource is declared in `electron-builder.alpi.yml`; Electron
resolves the development and packaged resource locations explicitly and fails
at startup if the branded resource is missing.  The documented
`package:alpi:dir` wrapper remains unchanged and is now asserted by the
packaging unit test.

## Verification performed before implementation audit

- Tests were written first and observed failing for the absent extension spawn
  argument, retry ordering, finalized `message_end` failure, resource package
  entry, and the pre-stream SSE-fallback diagnostic.
- `node --no-warnings --experimental-strip-types --test
  apps/desktop/tests/unit/alpi-luna-websocket-recovery.test.mjs
  apps/desktop/tests/unit/alpi-packaging.test.mjs` — 3 passed.
- `pnpm --filter @alamelu-pi/pi-rpc-driver test` — 44 passed.
- `pnpm --filter @alamelu-pi/desktop run typecheck` — passed.
- `pnpm --filter @alamelu-pi/desktop run build` — passed.
- `git diff --check` — passed.
- External-Pi child smoke: a fresh temporary `pi --mode rpc` child loaded the
  explicit `.ts` extension and answered `get_state` successfully.  The smoke
  used the normal external Pi agent directory without changing its files,
  authentication, providers, or settings.

## Post-audit package, install, and smoke evidence

Implementation Audit Round 1 passed before packaging.

- The only signing command used was
  `pnpm --filter @alamelu-pi/desktop run package:alpi:dir`.  It completed the
  documented AWS-backed explicit-keychain / identity-hash route without an
  interactive Apple password prompt.
- The signed candidate passed `codesign --verify --deep --strict`; its bundle
  identity is `com.alamelu.pi`, its name is `Alamelu Pi`, and its executable is
  `alpi`.
- `PI_APP_PACKAGE_FLAVOR=alpi pnpm --filter @alamelu-pi/desktop run
  verify:packaged-runtime-deps` passed, proving the candidate still uses the
  external Pi runtime and does not package Pi itself.
- The packaged `.ts` recovery resource loaded successfully inside a fresh
  external Pi RPC child and returned a successful state response.
- `pnpm --filter @alamelu-pi/desktop run smoke:alpi:candidate` passed with an
  isolated copied app state and external Pi runtime.
- The prior installed app was preserved at
  `/Applications/Alamelu Pi.app.before-luna-ws-recovery-20260711`, then the
  signed candidate replaced `/Applications/Alamelu Pi.app`.
- An installed-app Electron smoke used a fresh temporary app state, selected
  `openai-codex/gpt-5.6-luna` at `xhigh`, and completed two consecutive turns:
  `ALPI_INSTALLED_LUNA_TWO_TURN_OK`.

No provider settings, credentials, subscription state, external Pi source, or
user session history was modified during verification.

## Non-goals

- Do not bundle Pi.
- Do not alter saved providers, subscription/API login, session authentication,
  or the user's Pi settings.
- Do not change Pi's upstream source or recreate its WebSocket transport.
