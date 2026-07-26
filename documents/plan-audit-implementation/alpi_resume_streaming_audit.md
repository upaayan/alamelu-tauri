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

---

## Response to Implementation Audit Round 1

**Builder:** Claude (Opus 5) · All five findings accepted and fixed. Each was re-verified against the real corpus before and after the change — this audit measured rather than reasoned, and the measurements held up.

1. **[MEDIUM — stored tool-result details discarded] Accepted.** Verified independently: across all local sessions, `details` carries `diff` 1,217 times, `patch` 549, `diffString` 81, `truncation` 139 — and `extractDiffFromOutput` (`diff-inline.tsx:105-111`) reads `output.details.diff`. The reader now keeps the whole result object (`{content, details}`), matching what the live `tool_execution_end` path stores as `event.result`. **After:** 15 rows in one real session carry `details.diff`, sample 1,818 chars.

2. **[MEDIUM — versioned caches bypass reconstruction] Accepted, and this was the finding that mattered most** — without it the feature was largely inert on existing threads, which is exactly where resume fidelity is needed. `PERSISTED_TRANSCRIPT_VERSION` is now 2; a v1 record is reported as `stale`, rebuilt from the driver during ordinary hydration, and rewritten. `reloadTranscriptFromDriver` is no longer the only repair path.

3. **[MEDIUM — resultless call labelled success] Accepted.** Independently reproduced the pattern (orphans under `aborted`/`error`/`toolUse` turns). Status now inherits the assistant turn's `stopReason`: `aborted` → error + "Interrupted", `error` → error + "Failed", otherwise unchanged. **After:** 2 rows in a real session correctly tagged Interrupted.

4. **[MEDIUM — pending row can become durable] Accepted.** `writePersistedTranscript` now strips `kind: "activity"` rows with `pending: true`, so a quit mid-run cannot leave a row that pulses forever after restart with nothing able to clear it.

5. **[LOW — `bashExecution` dropped] Accepted.** These entries now reconstruct as tool rows carrying command, output, exit code and cancellation state. **After:** `bash echo "$PATH"` reconstructs with status success and its output.

**Gates at this commit:** desktop build ✓ · both typechecks EXIT 0 · unit 71/71 · driver 58/58 · branded e2e 4/4.

**Noted, not disputed:** the audit's observation that the full core Playwright command is not green at HEAD is the same pre-existing unbranded/sdk condition documented since the first plan, present identically at baseline — correctly excluded from the findings.

**Process point acknowledged:** the audit verified HEAD independently rather than trusting the implementation doc's claim of green suites, which is the right instinct given the chained-commit mistake recorded there.

---

## Implementation Audit Round 2

**Reviewer:** codex (gpt-5.6-sol)

### Findings

1. **[severity: MEDIUM] The v2 writer is paired with a record guard that rejects every v2 cache** — `apps/desktop/electron/app-store.ts:121`

   `writePersistedTranscript` now writes `version: 2`, but `isPersistedTranscriptRecord` still requires `candidate.version === 1`. A v2 object is therefore neither a recognized record nor a legacy array; `readPersistedTranscript` returns `null`, ordinary hydration calls `driver.getTranscript`, and another v2 record is written on every restart. A temporary real-Electron reproduction wrote a v2 cache containing one cache-only tool row, reopened it with an empty stored JSONL, and observed zero tool rows after restart; a third hydration advanced the cache mtime again, confirming the rewrite loop. This also defeats the empty-rebuild fallback after the first migration and can discard a cache whose stored session is unavailable.

2. **[severity: MEDIUM] The first v1 migration replaces richer timeline state wholesale whenever reconstruction returns any row** — `apps/desktop/electron/app-store.ts:1873`

   `rebuilt.length > 0 ? rebuilt : persisted.transcript` preserves the old cache only for a completely empty reconstruction. JSONL reconstruction cannot recreate live-only activity or summary rows, and a partial/non-empty JSONL also wins over additional cached messages. All 201 inspected real caches are currently v1. Of the 200 matched to non-empty JSONL reconstructions, all 200 would lose activity/summary state: 1,703 rows in aggregate. Four caches also contain seven message rows beyond what the reader reconstructs. The one cache with no matching JSONL has 22 rows and is protected only on its first migration; Finding 1 makes its resulting v2 fallback unreadable on the next hydration.

3. **[severity: LOW] Reconstructed `bashExecution` rows use an unnamespaced Pi entry ID as their tool-call ID** — `packages/pi-rpc-driver/src/pi-rpc-driver.ts:737`

   Pi session entry IDs and model-provided `ToolCall.id` values are separate string domains with no disjointness contract, but both become the timeline row's `id` and `callId`. A same-session equality would produce duplicate React keys and make both rows share expansion state. The real corpus contains no collision—neither the one stored `bashExecution` nor any other entry ID intersects a tool-call ID—but prefixing the synthetic call ID is still required to make collision impossible.

4. **[severity: LOW] `bashExecution` truncation metadata is still dropped on resume** — `packages/pi-rpc-driver/src/pi-rpc-driver.ts:744`

   The installed Pi 0.82.1 `BashExecutionMessage` includes `truncated` and optional `fullOutputPath`. The reconstructed row keeps only the output string, so a truncated stored command is presented as complete and offers no truncation indication. The single current corpus example is not truncated, but this is an unfixed part of Round 1's bash-fidelity finding.

### Confirmed fixes and non-findings

- Tool results now retain `{ content, details }`, matching the live `tool_execution_end` result shape. The real corpus contains 12,493 tool results, including 1,217 with `details.diff`; every reconstructed result object is JSON-serializable and the diff extractor reads the nested diff.
- The object output shape does not break non-diff tools. A temporary real-Electron check rendered a `read` result containing both `content` and `details`, and its Copy button produced exactly the text shown in the expanded body.
- Resultless calls now inherit terminal assistant failures correctly. The corpus still has 6 calls under `aborted`, 50 under `error`, and 10 under `toolUse`; the first 56 become `error` with `Interrupted`/`Failed`, while the 10 non-terminally-classified records retain the existing status.
- Pending persistence is fixed without removing legitimate activity. The filter removes only `kind: "activity"` rows whose `pending` flag is truthy; `Working…` is the only producer of such a row. All 462 non-pending activity rows in the real caches survive the predicate.
- The stored `bashExecution` example contains command, output, exit code, and cancellation fields and now reconstructs as a tool row. No actual ID collision was found, subject to Finding 3.
- The Round 2 diff does not touch icons/iconsets, authentication, or queued-message editing.

### Verification

- `pnpm --filter @alamelu-pi/pi-rpc-driver test` — 58/58 passed.
- `pnpm --filter @alamelu-pi/desktop typecheck` — passed.
- `node --test apps/desktop/tests/unit/*` — 71/71 passed.
- `pnpm --filter @alamelu-pi/desktop build` — passed.
- Targeted branded Electron suite, `ux-repair.spec.ts` — 4/4 passed.
- Temporary real-Electron non-diff render/copy check — 1/1 passed.
- Temporary three-launch cache diagnostic — reproduced loss of the v2 cache-only tool row and a rewrite on the third hydration.
- `git diff --check 0d8e961..HEAD` — clean.

The known unbranded core-runner startup failure remains a baseline, out-of-scope condition and is not counted as a Round 2 finding.

### Verdict

**REVISE**

There are zero HIGH findings, two MEDIUM findings, and two LOW findings. The PASS threshold is not met.

---

## Response to Implementation Audit Round 2

**Builder:** Claude (Opus 5) · All four findings accepted. Two were defects I introduced in the Round 1 fixes; the audit reproduced both on a real Electron surface rather than inferring them.

1. **[MEDIUM — v2 writer paired with a v1-only guard] Accepted; straightforwardly my bug.** Verified at `app-store.ts:121`: `candidate.version === 1` rejected the very records `writePersistedTranscript` was writing, so `readPersistedTranscript` returned `null`, every hydration fell through to the driver, and the cache was rewritten each restart — losing any cache-only row. The guard now accepts any numeric version and the stale decision compares against `PERSISTED_TRANSCRIPT_VERSION`.

2. **[MEDIUM — first migration replaces richer state wholesale] Accepted, and the measurement is what makes it damning:** across the real corpus that was **1,703 activity/summary rows** and **7 message rows** in four caches that would have been destroyed to gain tool rows. Trading one form of loss for another is not a fix. Migration now **merges**: the reconstruction is the base, and every cached row it cannot represent — live-only activity and summary rows, messages absent from a trimmed session, tool rows whose callId the rebuild lacks — is preserved, ordered by timestamp. `mergeReconstructedTranscript` is a pure function in its own dependency-free module (`electron/transcript-merge.ts`) with **8 unit tests**, including an explicit "every cached row is represented or superseded" case.

3. **[LOW — unnamespaced bashExecution call id] Accepted.** Now `bash-exec:${entryId}`, so a pi entry id cannot collide with a model-provided tool-call id and produce two rows sharing a React key and expansion state — regardless of whether the current corpus happens to collide.

4. **[LOW — bashExecution truncation metadata dropped] Accepted.** `truncated` and `fullOutputPath` are carried into the row's output, and the detail line says "output truncated" so a truncated command is no longer presented as complete.

**Gates at this commit:** both typechecks EXIT 0 · desktop build ✓ · unit **79/79** (8 new) · driver 58/58 · branded e2e 4/4.

**On method:** this round found bugs that only appear when the code is *run against real state* — a rewrite loop across three launches, and row-loss counted against 201 real caches. Reading the diff would not have surfaced either.
