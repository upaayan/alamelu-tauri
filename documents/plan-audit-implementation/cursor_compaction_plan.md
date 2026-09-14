# Cursor compaction — recovery and adapter fix plan

## Owner brief and boundaries

The owner’s existing Alamelu Pi Tauri Grok thread cannot compact: repeated `Summarization attempted to call a tool`; the app reportedly shows over 1M context and prevents switching to a smaller model. He asks for backend recovery, then a debate-loop plan with Claude Fable critic. He suggests ignoring tool blocks in the summary result but explicitly rules out building Pi. Owner approved the reviewed implementation plan on 2026-09-14: “Otherwise, go ahead and fix.”

Outcome: recover the SAME conversation without deleting its history, and fix Cursor-backed manual/automatic compaction without rebuilding Pi or Tauri. Do not repair unrelated Cursor incomplete-shell cards, UI issues, WSL cwd, Pi launchers, update packages wholesale, or change provider defaults. Preserve the concurrent Grok task’s edits. No new architecture or general hardening.

## Evidence

- Session: `01a09979-096a-7f5d-9521-2e6cbe6f13a8`, title `I use Alamelu Pi (Electron ) and...`, model `cursor/grok-4.6:fast`, xhigh.
- Source JSONL: `/Users/sudhirjha/Library/Application Support/Alamelu Pi/sessions/2026-09-13T06-34-01-450Z_01a09979-096a-7f5d-9521-2e6cbe6f13a8.jsonl`.
- At least four app failures on 2026-09-14, 14:46–14:55 UTC, taking 2–3 minutes each. Original history still exists; previous successful compaction is from September 13.
- Installed Pi 0.85.1 `dist/core/compaction/compaction.js`: `buildSummarizationContext` omits tools; `generateSummaryWithUsage` rejects any toolCall in the completed response.
- Installed `pi-cursor-sdk` 0.1.60: `src/cursor-context-tools.ts` maps omitted tools to undefined; `src/cursor-native-replay-routing.ts` treats undefined as all native tools active. `cursor-provider-turn-prepare.ts` still builds the ordinary SDK/bridge/tool-guidance route for summary requests. `cursor-provider-live-run-drain.ts` can end the Pi response with toolUse while Cursor work remains pending.
- Existing `session_before_compact` hook releases live runs and resets the pooled agent, but does not give summary responses a text-only contract. Successful compaction invalidates the pooled agent; failed compaction has no corresponding lifecycle hook here.
- Ordinary two-prompt Cursor tests passed. They did not establish compaction compatibility.
- Read-only Pi preparation on the saved branch: about 242,636 tokens, summary history 770,620 characters plus 28,580 prefix characters and an 8,627-character previous summary. This is below the app’s reported lifetime/display value; do not assume the UI figure is the actual outbound summary size.

Installed package root: `/Users/sudhirjha/.pi/agent/npm/node_modules/pi-cursor-sdk`.
Editable source: `/Users/sudhirjha/playground/pi-cursor-sdk` (currently a source directory WITHOUT `.git`, AGENTS.md or CLAUDE.md; do not initialize git).
Pi installed root: `/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent`.

## A. Immediate backend recovery (authorized; independent of permanent code approval)

1. Preserve an exact private original and a candidate copy under `~/.pi/agent/backups/compaction-recovery-20260914-*`, recording original SHA256, session ID and leaf.
2. Run installed Pi RPC against ONLY the candidate, through its working unbundled launcher, with `openai-codex/gpt-6-astra`, no extensions/tools/skills/context files. Request `compact` directly; do not switch the live app’s model or send an ordinary work prompt. This reuses Pi’s own serializer, cut point, summary generator and checkpoint format. Its per-request declared window is 272,000. The copy test has now PASSED: 242,636 tokens before, estimated 27,682 after; complete 32,229-character summary. Recovery evidence: `~/.pi/agent/backups/compaction-recovery-20260914-i6n_6_go/compact-response.json` and `validation.json`. No Pi source edits.
3. Inspect success before considering activation: complete nonempty summary; source task/owner rulings/current blocker retained; firstKeptEntryId valid; recent tail retained; same session ID; old entries byte-identical prefix; current-context estimate materially reduced. Restore the candidate’s selected model to the original Cursor Grok via the session manager without starting a model turn. Preserve the pre-recovery source.
4. Activate ONLY after the target Pi child is quiescent/unloaded and the live file still matches the saved source hash/leaf. If the original advanced, rebase only a proven compatible checkpoint or redo against the new snapshot; never overwrite newer messages. Do not write behind a running session manager. Identify the exact child if possible; otherwise ask owner to close the target thread/app. Do not stop unrelated apps/tasks.
5. Replace the file with the validated candidate and reopen the same conversation. Verify summary/tail/model/thread identity. Keep the full original as rollback; if original remains open or changed, leave the reviewed candidate staged and explain the precise activation prerequisite.

## B. Permanent fix: Cursor adapter only

Implement the smallest correction in existing adapter modules after approval. Preserve Pi’s rejection of malformed summaries; deliver a valid text-only summary from the adapter rather than modifying/rebuilding Pi.

1. Reproduce the precise contract in deterministic tests: a Pi summary context has no tools, while Cursor emits a native tool followed by final summary text. Today undefined means all tools active and the response terminates at toolUse. Include both main-history and split-turn summary calls.
2. Normalize an omitted `context.tools` to the same empty permitted Pi tool set as explicit `[]`. Use that same snapshot in native replay routing and the live-run drain. No toolCall/toolUse response may escape a summary request; consume internal display events and continue to the actual final text. Do not blindly strip tool blocks and mark an intermediate/empty response successful.
3. Definitively suppress the Pi MCP bridge for a call whose normalized per-call tool snapshot is empty. Pass an empty-snapshot/bridge-disabled override through `acquireSessionCursorAgent` → `createSessionAgentEntry` → the existing registered bridge `createRun`. Reuse its existing empty snapshot → `enabled=false` → no bridgeRun path. Do not merely reject bridge events after advertising their tools. This also drops bridge-specific prompt guidance automatically. No global config or tool disabling setting; normal nonempty-tool calls remain unchanged.
4. Keep the generic Cursor prompt unchanged by default. Only the live copied-session compaction can justify removing conflicting normal-work guidance; a deterministic fake model cannot establish that model behavior. This change stays in the same summary route if live evidence requires it. The pinned Cursor SDK has no native-tool disable control, so do not promise native tools never run internally. The contract is a completed text response with no Pi toolCall/toolUse or Pi bridge execution escaping the summary call.
5. VERIFY existing lifecycle behavior on success, failure and cancel, including split-turn summaries and the next ordinary prompt. Do not add a new lifecycle handler by default: existing success invalidation, error/cancel release and context-divergence reset may suffice once pending toolUse no longer leaks. A reset hook change is allowed only if the targeted regression proves that existing behavior fails. No pooling rewrite.
6. No new runtime empty-summary guard is planned. This review found Pi already accepts empty text; changing that policy would exceed the diagnosed toolUse fix. Instead, acceptance tests must observe actual nonempty completed summary text and must never treat an intermediate tool-only response as completed text. Keep existing final error/length/cancel handling intact.

Expected files (only those proved necessary): `src/cursor-context-tools.ts`, existing routing/drain consumers, `src/cursor-provider-turn-prepare.ts`, `src/cursor-session-agent.ts`, and the registered bridge's existing createRun/snapshot seam. Existing lifecycle/prompt files change ONLY if the live/targeted regression requires them. Prefer small existing methods; no speculative modules.

## Verification and rollout after approval

- Targeted tests: omitted tools and explicit empty tools produce text-only completed responses; native replay batches and bridge events cannot return summary toolUse; explicit-tool normal turns retain current behavior.
- Success, failure and cancellation leave the next normal request free of summarizer state. Test relevant existing lifecycle mechanisms, not invented general races.
- Actual editable source baseline contains four auth-recreate test files (29 tests), not the broader tests named in its historical docs. Add minimal vitest regression files under `test/` covering the above concrete compaction contracts, and run `npx vitest run` (including those four existing test files) plus `npx tsc --noEmit`. Do not use broken `npm run typecheck` (its referenced test tsconfigs are absent). Do not upgrade dev dependencies: local Pi declarations are 0.80.9 while runtime is 0.85.1. If a proven-needed compaction-failure event is added, describe it in the adapter-owned extension API overload, without a Pi dependency upgrade. No unrelated incomplete-shell-card tests or repairs.
- Live manual compaction on a copied Grok session, followed by one ordinary prompt on the copy. The installed provider was queried read-only on 2026-09-14: `cursor/grok-4.6:fast` reports contextWindow 256,000 and maxTokens 16,384 (`grok-window.json` in the recovery evidence directory). Check the actual prepared prompt before sending. The recovery requests used 220,109 input tokens total; do not confuse that total across summary calls with one request size. If a future fixture exceeds the provider window, use a bounded copied fixture that still exercises this bug; do not change the owner thread/model or treat overflow as this adapter regression. Exercise automatic compaction through a deliberately small isolated fixture threshold. Check the emitted checkpoint and that no read/write/bash Pi execution occurs during summarization; preserve diagnostic artifacts privately.
- Update the local source package and install that reviewed build on Mac with one rollback and hashes; keep settings/auth/model selections unchanged. Windows uses a different pi-cursor-sdk version (0.3.6): verify whether affected before considering deployment there; do not silently replace it with Mac 0.1.60 or include WSL changes without owner approval.
- No Pi build, Rust build, Tauri rebuild or app repackaging. Record actual evidence and Fable implementation review in a later approved implementation phase.

## Plan status

Plan Audit Round 2: PASS, Claude Fable 5.1/high, zero high/medium findings. The one low documentation finding is corrected. Baseline verification: `npx tsc --noEmit` passed; `npx vitest run` passed 29 tests in four files. Implementation approved and completed on Mac on 2026-09-14. Fable Implementation Audit Round1 PASS; adapter and JavaScript backend installed, packaged smoke and original-task reopen verified. See cursor_compaction_implementation.md for evidence and rollback.

Backend recovery is installed. Tauri reopened on the same task with original Grok/xhigh selection and transcript tail. The complete recovered file is an unchanged prefix after reopening; the app appended only its normal RepoMem context entry. A fresh Grok reply and trusted provider usage remain unverified. See the recovery implementation document for exact evidence and backup.

## Owner-approved addition — model-switch context estimate (2026-09-14)

Owner: “You will have to fix that as well. Otherwise, we will always have a problem with multiple compactions.” The model-switch guard estimates the full JSONL length / 4, producing 1,132,403 for the original saved history. This is separate from active context.

Smallest remedy: ask the already-open Pi RPC session for `get_messages` at model-switch preflight. Pi returns its current branch and latest compaction summary plus retained tail. Add one optional read-only driver method for those messages, make the existing preflight async, and use content-only chars/4 estimation for that active message array (text, thinking, tool arguments/results, summary/custom messages; images use a fixed estimate rather than base64 size). Do not reconstruct Pi branches or compaction boundaries in the app. Preserve the existing auth and tool-ID compatibility checks. If active context is unavailable, treat size as unknown and defer size enforcement to Pi/provider; never fall back to the whole archive size. No UI redesign or new diagnostics feature.

Tests: same accumulated archive across two compactions with each fresh RPC active context; repeated reads must use current messages. Old archived tool output and JSON metadata must not inflate active size. A truly oversized active context must still block. Include driver get_messages transport and model-switch integration proof.

Deployment: adapter on Mac as above, plus rebuild only Tauri's JavaScript backend, copy into a candidate based on the currently installed app, preserve the Rust program code (re-signing may change embedded signature bytes), re-sign and verify, retain a rollback, then replace/reopen the Mac app. No Rust compilation, Pi build, renderer change, or WSL deployment. Owner may be using the real Grok task; do not interrupt an active run to activate.

### Plan Round3 clarifications

Windows rollout subsequently approved: see the owner ruling appended below.

Unknown active size is an absent optional `ThreadStats.estTokens`; update comments and existing missing-context assertions accordingly. The optional driver method returns undefined for failed/malformed responses or thrown transport errors; errors here do not replace the normal model-switch result. Forward the method through RpcDesktopDriver to PiRpcDriver, preserving other driver contracts.

Integration proof is the targeted existing Playwright core lane with `compacted-model-switch.spec.ts`: seed a private Pi fixture containing two checkpoints and4.4MB archived metadata via the existing fixture helper pattern, then use the real Electron UI model picker to select GPT-4o with no provider call. This verifies the composer→desktop driver→Pi RPC→preflight path without changing the owner's real thread. Also run the packaged Tauri smoke on a candidate/current app with isolated state. No new lane or app API.

Deployment copies the installed app into an owned candidate, replacing only backend/main.cjs; dependencies are unchanged. Preserve its existing ad-hoc signing mode (`codesign --force --deep --sign -`) and verify deep/strict. The current installed app is ad-hoc signed; the AWS developer-identity sign:tauri script would change that mode unnecessarily. Compare signature-stripped copies of old/new Rust executables, allowing only the __LINKEDIT signature allocation-size field that codesign leaves changed; verify all Mach-O code/data sections and all remaining normalized bytes equal. No Rust compilation. Retain a dated rollback.

## Owner-approved Windows rollout — 2026-09-14

Owner: “So do it please. And clean up once it is done.” This supersedes the earlier Mac-only boundary for these same two fixes. No broader package upgrades or unrelated fixes.

Windows main.cjs is byte-identical to the Mac pre-fix backend. Ship the reviewed fixed bundle, preserving Windows node-pty/dependencies and executable. WSL Pi remains0.85.1 with its unbundled launcher. WSL pi-cursor-sdk0.3.6 has the same bugs but additional SDK/store behavior: apply only equivalent edits to its own three source files, never replace it with Mac0.1.60.

Verify14 targeted adapter tests against exported WSL source, manual/automatic Grok compaction and normal tool behavior on isolated WSL fixtures, baseline/fixed repeated-compaction model switching through native Windows Node→wsl.exe→Pi, and a post-install native tool reply. No owner-session prompts. Preserve settings/auth/models and Windows paths. Stage and review before activation; do not interrupt an active owner run. Keep rollback/evidence; clean only this task's relay keys, candidate and test state after children exit. Record both platforms together in PI-UPGRADE-WINDOWS.md, with hashes and tested versions. Windows remains pending until installed checks pass.

Windows packaging clarification (Implementation Round2):0.3.6 manifest loads dist/index.js. Ship the three corresponding compiled JS modules alongside source, using TypeScript emit whose baseline output exactly matches installed dist hashes. Back up/hash-check all six files, preserve every other dist module and package manifest, and test the candidate through settings.packages with no source-entry override.

Current rollout status: COMPLETE on Mac and Windows/WSL. Implementation Round3 PASS; manifest-loaded manual/automatic compaction, native installed model switch/tool turn, preservation, reopened Windows app and cleanup verified. Shared status and evidence are linked from PI-UPGRADE-WINDOWS.md.
