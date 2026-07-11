# Alamelu Pi Luna Internal Recovery — Audit

<!-- critic_id: /root/driver_restart_design -->

This is an implementation-only debate-loop audit. Review sections and
responses are append-only.

## Implementation Audit Round 1

Verdict: PASS

The implementation was independently reviewed after the final concurrency
repair. No HIGH or MEDIUM issue remains.

- The extension operates at the correct Pi boundary: `before_provider_request`
  runs before Codex chooses WebSocket or SSE, and only a Luna assistant error
  with Pi's diagnosed SSE fallback is reclassified as retryable. It does not
  replay a user prompt.
- Pi's native retry continues the original turn. The desktop waits for
  `willRetry` rather than reporting a short successful run, and only handles a
  final failure as failed.
- The next idle Luna operation uses a new Pi child with the same Pi session
  ID. The driver validates that ID plus model and thinking-level restoration,
  and suppresses launch-level model defaults for exact-session reopens.
- Child identity plus generation fencing blocks stale transport, delta, tool,
  and end events from the retired process. The swap does not emit
  `sessionClosed`.
- Idle configuration mutations and prompts are serialized. Model-first applies
  to the replacement child before prompting; send-first rejects the later
  mutation once the prompt owns the child, avoiding a mid-stream model change.
- The failure path retains the old child and sends no prompt if a replacement
  cannot be established.

Verification reviewed:

- `pnpm --filter @pi-gui/pi-rpc-driver test` — 52/52 passed.
- Focused recovery/packaging/config unit tests passed.
- Desktop typecheck, production build, and `git diff --check` passed after the
  final concurrency repair.
- An isolated live external-Pi Luna two-turn smoke observed new child → same
  session ID replacement and completed both turns.
- No signing, authentication, provider, external-Pi source, or credential
  files were changed by the implementation.
