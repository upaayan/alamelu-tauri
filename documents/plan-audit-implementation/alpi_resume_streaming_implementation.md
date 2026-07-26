# Resume fidelity + streaming indicator — Implementation

**Builder:** Claude (Opus 5) · **Critic:** Codex (implementation audit only, per owner) · **Date:** 2026-07-26
Commits: `d090496` (resume fidelity) · `40f673b` (test contract update) · `6b4598e` (streaming indicator)
Owner rulings still binding: icon untouchable; no Anthropic/codex auth work; no scope beyond these two items.

## Answered first: is queueing working?

**Yes — verified live against real pi**, not inferred. A `follow_up` sent 1.5s into a running prompt was accepted, held until the first turn finished ("1 2 3 4 5"), then processed as its own turn ("FOLLOWUP LANDED"). Both steering and queueing work. Since Phase 3 a queued message is also echoed in the transcript instead of vanishing, which is likely why it previously felt broken. Note for design: pi ran **both turns under a single `agent_start`/`agent_end` pair**, so run-scoped UI must not assume one turn per run.

## 1. Resume fidelity (`d090496`)

**Defect:** a thread resumed from stored history showed bare user/assistant text where the live view had tool cards and diffs. Two causes, one of them a lie in the type system:
- `PiRpcDriver.getTranscript` emitted only `{role, text}` — no tool calls, no ids, no timestamps.
- `RpcDesktopDriver.getTranscript` then **cast** that to `SessionTranscriptMessage[]`, a type requiring `kind`, `id` and `createdAt` that those rows did not have.

**Change:**
- `packages/session-driver/src/transcript.ts` gains `SessionTranscriptToolCall` and the `SessionTranscriptItem` union, structurally matching the desktop timeline's tool row.
- The JSONL reader reconstructs tool calls from assistant `toolCall` content parts and pairs them with the separate `toolResult` messages by `toolCallId`, carrying `input`, `output` and success/error status. Messages now carry pi's real entry `id` and `timestamp`.
- A stored call with no result is recorded `success`, not `running` — on a resumed thread nothing is in flight, and `running` would render a spinner that never resolves.
- The unsafe cast is gone; `getTranscript` returns `readonly SessionTranscriptItem[]` through the driver contract.
- `shouldReplaceLegacyTranscript` now compares **message rows only**, so newly-added tool rows cannot make a driver transcript look longer than the cached one and trigger a spurious replacement.

**Verification — against a real stored session, not a fixture:**
```
session 019e2b54-f802-7338-80d7-ecc3e8b9ebcd (2026-05-15)
items by kind: {"message":8,"tool":11}
tool rows: 11 — read | success | input? true | output 3787 / 50675 / 45753 chars
messages have id+createdAt: true
```
Before this change the same session produced 8 bare text lines and no tool rows.

## 2. Streaming indicator (`6b4598e`)

**Defect:** the transcript pushed a static "Working…" row at run start; nothing animated, and the app had **zero** `aria-live` regions, so a screen-reader user got silence while the agent worked.

**Change:** `TimelineActivity` gains an optional `pending` flag, set on the working row; it renders with `role="status"`, `aria-live="polite"` and a pulsing dot. The `prefers-reduced-motion` block added in Phase 2 disables the animation automatically.

**Verification — captured mid-run on the real Electron surface:**
```
pending row: {"text":"Working…","role":"status","live":"polite","pulseAnim":"timeline-pulse"}
```

## Gates

```
tsc --noEmit (renderer + electron)            EXIT 0 / EXIT 0
pnpm --filter @alamelu-pi/desktop build       ✓ built
node --test apps/desktop/tests/unit/*         71 pass / 0 fail
pnpm --filter @alamelu-pi/pi-rpc-driver test  58 pass / 0 fail
branded e2e (ux-repair.spec.ts)               4 passed
```

**Process note, recorded rather than hidden:** the resume-fidelity commit (`d090496`) was made in the same shell command as its test run, and the driver suite was failing 3/58 at that moment — three tests still asserting the old flat `{role,text}` shape. They were fixed in `40f673b`, which is green. Chaining a commit behind an unverified test run is the mistake; it is noted here so the audit sees it from the record rather than discovering it.

## Not done (deliberate)

Queued-message **editing** (`replaceQueuedMessages`) is still unimplemented — sending queued messages works, editing/deleting them does not. Whether pi's RPC exposes any queue-mutation command has **not** been checked; that check should precede any plan, given `/compact` and `/tree` turned out to be available when previously assumed absent.
