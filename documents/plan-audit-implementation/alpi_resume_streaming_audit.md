# Alamelu Pi Resume Fidelity and Streaming Indicator — Audit

Implementation-only debate-loop audit. Rounds and implementation responses are append-only.

## Implementation Audit Round 1

**Reviewer:** codex (gpt-5.6-sol)

### Findings

1. **[severity: MEDIUM] Stored tool-result details are discarded on resume** — `packages/pi-rpc-driver/src/pi-rpc-driver.ts:710`

   The reader derives `output` only from `message.content`, while Pi stores structured result data separately in `message.details`. In the installed Pi 0.82.1 implementation, edit results put the unified diff in `details.diff`; the live `tool_execution_end` path retains the whole result object, and the renderer knows how to read `details.diff`. A scan of the real local Pi corpus found 1,136 edit-like results with `details.diff` and none with that diff duplicated into text content. Those resumed cards therefore lose the diff body and stats that were present live.

2. **[severity: MEDIUM] Versioned transcript caches bypass the new JSONL reconstruction during ordinary hydration** — `apps/desktop/electron/app-store.ts:1865`

   Any versioned cache is returned without consulting `driver.getTranscript`, so an existing incomplete cache never receives reconstructed tool cards. This is present in real state, not only hypothetical: of 200 cache files matched to their Pi session, 11 contained fewer tool rows than the JSONL contained tool calls; one version-1 cache contained only a terminal activity row while its JSONL contained tool calls. `reloadTranscriptFromDriver` can repair a cache when explicitly invoked, but ordinary resumed-thread hydration does not call it.

3. **[severity: MEDIUM] A stored call with no result is labeled successful even when Pi recorded an aborted or failed assistant turn** — `packages/pi-rpc-driver/src/pi-rpc-driver.ts:743`

   Treating an inactive resumed call as not `running` is correct, but `success` is not supported by the stored data. The real corpus contained 66 tool calls without a matching `toolResult`: 6 belonged to assistant turns with `stopReason: "aborted"`, 50 to `"error"`, and only 10 to `"toolUse"`. The current default therefore displays at least 56 known interrupted/failed calls as successes.

4. **[severity: MEDIUM] The pending “Working…” activity can become durable and pulse forever after restart** — `apps/desktop/electron/app-store.ts:1883`

   Session events schedule transcript persistence, and `writePersistedTranscript` clones the pending activity unchanged. Shutdown flushes those writes before shutting down the driver (`app-store.ts:209-211`), so a normal quit during a run can persist the row. On restart the versioned cache is trusted, but the in-memory `activeWorkingActivityBySession` map is empty; `clearRunState` consequently has no activity ID to remove. No currently inspected cache contained a pending row, but the write/load path permits the leak deterministically.

5. **[severity: LOW] Pi `bashExecution` messages disappear from a resumed transcript** — `packages/pi-rpc-driver/src/pi-rpc-driver.ts:720`

   `normalizeTranscriptRole` rejects this real Pi role, so the command, output, exit code, cancellation state, and truncation state are all dropped. The implementation document's sampled session itself contains one successful `bashExecution` entry. This does not affect ordinary assistant `toolCall`/`toolResult` pairing, but it is a remaining resume-fidelity gap.

### Confirmed behavior and non-findings

- Pairing by `toolCallId` is sound for the examined current format and corpus. Across 372 real JSONL files there were 12,559 assistant tool calls and 12,493 tool results, with no duplicate call IDs, orphan results, result-before-call ordering, or result mapped to a non-ancestor call. Current Pi's persisted fork path also creates a branched session file rather than mixing sibling branches into the active file.
- Dropping `thinking`/`reasoning` parts matches the current live desktop behavior: the RPC event mapper renders `text_delta` but does not create transcript rows for thinking deltas.
- The readonly-to-mutable copies in `app-store`, the widened desktop-driver return type, and the cast removal in `RpcDesktopDriver` are type-safe. The desktop typecheck passes, and no second desktop-driver implementation or incompatible `getTranscript` consumer was found.
- `cloneTranscriptMessage` preserves every current union member, and comparing message rows only in `shouldReplaceLegacyTranscript` avoids treating newly reconstructed tool rows as extra legacy messages. Apart from the versioned-cache bypass and pending-row persistence above, no cache-schema regression was found.
- The streaming row correctly uses `role="status"`, `aria-live="polite"`, a pulsing dot, and the existing reduced-motion override.
- The scoped commits do not touch icons/iconsets, authentication, or queued-message editing.

### Verification

- `pnpm --filter @alamelu-pi/pi-rpc-driver test` — 58/58 passed.
- `pnpm --filter @alamelu-pi/desktop typecheck` — passed.
- `node --test apps/desktop/tests/unit/*` — 71/71 passed.
- Desktop build — passed.
- Targeted real Electron surface: `ux-repair.spec.ts` — 4/4 passed.
- `git diff --check` for `03421c9..6b4598e` — clean.

The standard full core command is not green at current HEAD: unbranded core specs select the legacy `sdk` configuration, and `DesktopAppStore` rejects startup because no driver is supplied, so Playwright times out waiting for the first window. The same constructor/default-driver condition exists at baseline `03421c9`; this is an out-of-scope verification note and is not counted as a finding against these commits.

### Verdict

**REVISE**

There are four MEDIUM findings and one LOW finding. The PASS threshold is not met.
