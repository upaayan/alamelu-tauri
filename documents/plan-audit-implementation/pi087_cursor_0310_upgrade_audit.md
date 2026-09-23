# Pi 0.87.1 + pi-cursor-sdk 0.3.10 upgrade — audit (append-only)

Plan: `pi087_cursor_0310_upgrade_plan.md`. Implementation record: `pi087_cursor_0310_upgrade_implementation.md` (after owner approval).
Builder: Claude Opus 5.5. Critic (owner-selected): Codex `gpt-6-astra`, reasoning effort `max`.
Sections are appended only; earlier sections are never edited.

## Owner Ruling — 2026-09-23

1. Upgrade Pi 0.85.1 → 0.87.1 on the Mac laptop, test on the laptop, then sync pi to mock and backup.
2. Option C: Mac adapter moves to `pi-cursor-sdk` 0.3.10 with all three Mac local fix sets ported (compaction fix, stale-auth recovery, model variants / effort mapping).
3. Servers get stock `pi-cursor-sdk` 0.3.10.
4. WSL deferred — note it so it can be tackled later.
5. Use debate-loop with Codex (Astra, max) as critic. Builder and critic strictly stick to the scope. Show the owner the plan once the plan loop is done; implement only after the owner approves.

## Plan Audit Round 1 — Codex gpt-6-astra (max)

Date: 2026-09-23. Phase: Plan Audit. Role: critic. Numeric round: 1. Caller-selected model/effort: `gpt-6-astra` / `max`; Codex session `01a0cec3-e64f-7083-ada7-04c3fd0cf118`. Reviewed the entire plan, SHA-256 `85968cf17a914c496d3008d1b91243227a3bd2d97c42f901534cd24f6db6ca4c`, and the full preceding audit history (the Owner Ruling; no earlier findings or responses).

Outcome, scope and done criteria: upgrade the Mac to Pi 0.87.1 and adapter 0.3.10 while retaining compaction isolation, one-time stale-auth recovery, and model variants/effort mapping; verify the laptop before using the existing sync script to put mock and backup on Pi 0.87.1 with stock adapter 0.3.10. Completion requires the real launcher/Luna check, manifest-loaded adapter recovery checks, successful Pi read/system-prompt probe, the ported regressions, manual and automatic compaction followed by a normal tool turn, Electron model-switch and installed packaged-app checks, both server probes, and retained recovery assets/evidence/rollback. WSL is deferred, the app guard stays unchanged, and this task does not authorize a Rust rebuild, sync-script changes, unrelated upstream fixes or edits to the old adapter checkout. Implementation still requires owner approval after the plan loop.

Evidence reviewed: both global rule files and both project AGENTS.md files; the complete plan and audit; REBUILD-PROTECTION.md, PI-UPGRADE-WINDOWS.md, the September compaction implementation and adapter-freeze ruling; both existing maintenance patches and their test fixtures, manifest and both runtime checkers; the full server sync script; installed/stock 0.1.60 and stock 0.3.10 adapter code and manifests, installed settings package selection, all four stale-auth test files and helper; staged Pi 0.87.1 changelog and relevant provider/package documentation; the saved A/B results and parser; September live-check/observer and manifest-loader harness. The desktop smoke script and model-switch test were also checked against the plan's commands.

Read-only verification:

- `python3 scripts/check-cursor-compaction.py` passed for the existing recovery assets. This does not verify a future 0.3.10 port or any installed runtime.
- Independently parsed the saved A/B JSONL: base has Pi `read` start/end events and `CODE=ZEBRA-4471`; staged has no Pi tool-execution events and reports `CODE=NONE`. The fixture marker appears in both, so the explicit Pi-tool assertion in the plan is necessary and appropriate.
- Compared installed Mac source with stock npm 0.1.60: the eleven differing source files match the plan's three fix sets. Confirmed stock 0.3.10 has neither the new auth helper source nor its compiled module, and uses `dist/index.js`.
- `git ls-remote` confirmed upstream tag `v0.3.10` at `8a5c0aa5b3408c20eb0c8666939b51fc17b41b09`. Local metadata confirms installed Pi 0.85.1, staged Pi 0.87.1, and the installed nvm launcher targeting unbundled `dist/cli.js`.
- Reproduced P1-01 using the actual checker function and a manifest constructed only in memory against the stock package; it raises `FileNotFoundError` before comparing a baseline hash. No package, manifest or runtime was changed.

### P1-01 — medium — The new auth module cannot pass the unchanged baseline checker

Owner requirement: preserve all Mac fixes with a verified, reproducible recovery patch (Done 2 and 8).

Evidence/consequence: plan Phase 1.4(b), line 145, adds `src/cursor-provider-auth-recreate.ts`; Phase 1.6, lines 152–156, requires before/after hashes of every changed source/compiled file and a successful stock `--baseline` check while leaving the checker unchanged. `scripts/check-cursor-compaction.py:15` reads each file unconditionally; lines 39–40 do the same for every manifest file in either state. Both the new `.ts` and `.js` files are absent from stock 0.3.10. The required baseline therefore cannot pass, so neither the recovery rehearsal nor Phase 3.4 activation can follow the written sequence. A null before-hash does not help because the read fails first.

Smallest remedy: reconcile the port layout with the existing checker before approval. A scope-preserving option is to place the equivalent auth-helper functions in an already patched module, such as the turn runner, and adapt the existing auth-test imports; then every patched runtime file has a real stock before-image and the unchanged checker remains usable. Keep all changed runtime files covered. Extending checker semantics instead would change the plan's declared file boundary and should be raised with the owner before accepting that alternative.

### P1-02 — medium — The packaged smoke command targets a missing app in the clean export

Owner requirement: verify the real installed desktop after upgrading Pi without a Rust/Tauri rebuild (Done 6; Scope).

Evidence/consequence: Phase 3.6, lines 187–191, runs from a clean `git archive HEAD` export and invokes `smoke:tauri:packaged` without an app path. `apps/desktop/scripts/smoke-tauri-packaged.mjs:9` defaults to that export's `src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app`; line 30 asserts the executable exists before testing it. The preceding Electron build does not produce this Tauri bundle. The written gate fails before exercising installed Pi, and Phase 3.8 then calls for an unnecessary rollback of the completed upgrade.

Smallest remedy: use the existing override in the planned command:

```bash
ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app' pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged
```

The installed executable at that path exists. The smoke script already creates isolated state; using this override completes the intended installed-app verification without adding a build.

### P1-03 — medium — Model-ID parity does not prove preservation of effort mapping

Owner requirement: port all of fix set (c), including `reasoning_effort` mapping, not only visible model IDs (Owner Ruling 2; plan lines 18–20).

Evidence/consequence: Phase 0.2 records IDs only; Done 4 and Phase 3.5 use ID parity as the only specific verification of fix (c). The other explicitly ported tests cover compaction and stale-auth. The installed `model-discovery.ts` has independent changes at lines 114/242 for reasoning capability and at lines 397–403 for the outbound effort parameter. Stock 0.3.10 still recognizes only `effort` at line 115 and writes `effort` at line 328. The model-registration/ID path is separate. A port can restore every ID yet omit those mapping hunks and satisfy the stated parity gate while losing an explicitly required Mac behavior.

Smallest remedy: extend the already planned before/after parity verification with a small deterministic check of representative fix-(c) model metadata and `buildCursorModelSelection` output: the existing unqualified/context-qualified variants retain their selection/context parameters, and a `reasoning_effort` model retains its supported thinking levels and sends the chosen effort under the same parameter key. Reuse the existing model-discovery test seam (`__testUtils.registerModelItems`, metadata getters and `buildCursorModelSelection`) and record baseline/candidate results in the planned evidence. This verifies the approved port; it does not call for a broader model audit or another live provider suite.

No finding is raised against the owner's WSL deferral, the limited lifting of the adapter freeze, the stock-server decision, or the stated limitation on forcing a live stale-auth event. The existing server script was reviewed, not changed; its `@latest` upgrade is already covered by the plan's version stop condition. Runtime installs, builds and live probes remain implementation work and were not executed during this read-only audit.

Open findings: 0 high, 3 medium, 0 low. All findings are round-one plan defects within the requested outcome; no earlier resolution was reopened. REVISE is required under the zero-HIGH/MEDIUM PASS criterion.

Verdict: REVISE

## Plan Response Round 1 — Builder (Claude Opus 5.5)

All three findings accepted; the plan was updated in place. No scope change: each remedy stays inside the owner-approved outcome.

- P1-01 — Accepted. Verified before accepting: on the Mac, `cursor-provider-auth-recreate.ts` is imported only by `cursor-provider-turn-runner.ts`; none of its dependencies (`cursor-provider-errors`, `cursor-provider-live-run-drain`, `cursor-session-agent`, `cursor-live-run-coordinator`, `cursor-provider-turn-types`) imports the turn runner in 0.1.60 or 0.3.10, so folding its three exported helpers (`hasEmittedProgress`, `shouldAttemptAuthRecreate`, `teardownFailedAuthAttempt`) into the already-patched turn runner creates no import cycle. Plan Phase 1.4(b) now adds no new file; Phase 1.6 states every patched `src`/`dist` file exists in stock 0.3.10. The two stale-auth test files that import the helper module (`cursor-provider-auth-recreate.test.ts`, `cursor-provider-turn-runner-auth-recreate.test.ts`) import the turn runner instead. `check-cursor-compaction.py` stays unchanged.
- P1-02 — Accepted. Phase 3.6 now runs `ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app' pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged`, exercising the installed app with the script's own isolated state; no build added.
- P1-03 — Accepted. Verified the seam exists in both versions (`__testUtils`, `registerModelItems`, `buildCursorModelSelection` in installed 0.1.60 and stock 0.3.10 `model-discovery.ts`). Phase 1.3 adds one small `cursor-model-variants.test.ts`: context-variant model keeps unqualified and context-qualified IDs with their selection/context parameters; a `reasoning_effort` model keeps its thinking levels and sends the chosen effort under `reasoning_effort`. Expected values are confirmed against the installed Mac `model-discovery.ts` in a temporary copy of the 0.1.60 checkout; red on stock 0.3.10, green on the port. Done 4, Phase 1.6 assets and the verification map updated. No broader model audit or extra live suite.

## Plan Audit Round 2 — Codex gpt-6-astra (max)

Date: 2026-09-23. Phase: Plan Audit. Role: critic. Numeric round: 2. Caller-selected model/effort: `gpt-6-astra` / `max`; continuing Codex session `01a0cec3-e64f-7083-ada7-04c3fd0cf118`. Reviewed the entire revised plan, SHA-256 `e6136a35907bae75a655b627ce00c282334c1737079d4d54a3f944608388c116`, and the full audit history including the Owner Ruling, Round 1 and Plan Response Round 1. Re-read the four rule files and checked the supplied evidence against the complete scope, not only the edited paragraphs.

Outcome and boundaries: the Mac reaches Pi 0.87.1 with adapter 0.3.10 preserving all three local fix sets; the tested laptop then supplies the existing sync operation to mock and backup, which receive stock adapter 0.3.10. WSL remains deferred. The app model-switch guard, old editable adapter checkout and sync script remain outside the product-edit scope; no Rust/Tauri rebuild or unrelated upstream work is introduced.

Done criteria remain the real Mac launcher/Luna check; complete source and manifest-loaded runtime recovery verification; successful Pi read/system-prompt probe; compaction, stale-auth and model-variant/effort regressions; manual and automatic compaction with nonempty text-only summaries and a following ordinary tool turn; Electron model selection and installed packaged-app smoke; both server version/Cursor checks; and durable patches, manifest, tests, release evidence, maintenance-kit updates and rollbacks. These are implementation acceptance gates, not claims that the upgrade has already occurred.

Round-one dispositions:

- P1-01 — Resolved in the plan. Phase 1.4(b) now folds the three helpers into the existing turn-runner module and adapts the two importing test files; Phase 1.6 requires every patched source/compiled file to exist in stock. I checked the helper and runner source and confirmed that all ten proposed production modules have both stock `.ts` and `.js` files. Using the actual unchanged `check_package` function with a manifest constructed entirely in memory, the stock baseline check passed for those 20 paths and the `dist/index.js` loader. This resolves the missing-before-image contradiction without changing checker semantics or omitting the auth code from recovery coverage. The planned ported-test and build gates remain responsible for proving the implementation.
- P1-02 — Resolved in the plan. Phase 3.6 explicitly sets `ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app'`. Rechecked the smoke script's override and isolated-state behavior, and confirmed the installed executable exists. The command now targets the intended installed app while the Electron model-switch check continues from the clean export.
- P1-03 — Resolved in the plan. Done 4, Phase 1.3, the retained test assets and verification map now include the small model-variant test. It covers unqualified/context-qualified selection parameters, supported thinking levels and the outbound `reasoning_effort` key. The baseline is the installed Mac source in a temporary copy, with stock-red/ported-green verification. Rechecked that `__testUtils.registerModelItems`, metadata getters and `buildCursorModelSelection` exist in both versions and expose the relevant behavior. This covers the previously unverified portion of the required third fix set.

Complete-scope check: the plan retains locked upstream baselines and a stop on non-reproducible dist; private manifest-loaded candidate verification before activation; the unbundled launcher repair and real Luna check; preserved settings/session snapshots and bounded rollback; laptop verification before the existing server sync; explicit final server versions and Cursor probes; owner-approved WSL deferral; and the required records/cleanup limits. The September runbooks, retained patch/test contracts, staged Pi context documentation, A/B evidence, compaction harness and existing server script support this sequence. No additional scope or owner design decision is needed to close this plan review.

Read-only verification this round: recovery asset hashes passed through the checker's `check_assets()`; the 20-file stock baseline compatibility check described above passed; saved A/B results again showed Pi read start/end plus `CODE=ZEBRA-4471` on 0.85.1 and no Pi tool execution plus `CODE=NONE` on staged 0.87.1; the installed settings still select the documented Mac adapter and the nvm launcher still targets `dist/cli.js`. No installation, build, live model request, server operation or runtime/config edit was performed. Actual upgrade tests remain for the explicitly approved implementation phase.

New findings: none. Open findings: 0 high, 0 medium, 0 low. The three prior findings are closed at the plan level; no resolved finding is re-raised. Relevant read-only plan checks passed and there is no unresolved scope/design ruling. Show the owner the revised plan and obtain the implementation approval required by the Owner Ruling before executing it.

Verdict: PASS

## Owner Ruling — 2026-09-23 (implementation approval)

After Plan Audit Round 2 PASS the owner reviewed the plan: "Looks good. Approved. Go ahead and implement." The owner also quit Alamelu Pi at that time. Implementation starts a new recorded critic lifecycle for the Implementation Audit.


## Implementation Audit Round 1 — Codex gpt-6-astra (max)

Date: 2026-09-23. Phase: Implementation Audit. Role: critic. Numeric round: 1. Caller-selected model/effort: `gpt-6-astra` / `max`; Codex session `01a0cf06-bdf3-7bc0-9794-9fc5738dd742`. Reviewed the entire approved plan (SHA-256 `e6136a35907bae75a655b627ce00c282334c1737079d4d54a3f944608388c116`), entire implementation record (`dd635354d6d630f1abfd811729498a8b3ba58acb7a5f81cc2c6c94db89c97273`), full audit history including implementation approval, both global rule files and both project rule files.

Outcome, scope and done criteria: the approved outcome is Mac Pi 0.87.1 with adapter 0.3.10 preserving compaction isolation, one-time stale-auth recovery and model variants/effort mapping, followed by the existing sync operation to mock and backup with stock adapter 0.3.10. Final completion still requires installed launcher/Luna and adapter checks, the read/system-prompt probe, model-ID parity, the regression tests, manual and automatic compaction with text-only summaries and a following tool turn, desktop model-switch/packaged smoke checks, both server checks and retained recovery/evidence/rollback records. WSL remains deferred; the app guard, old editable checkout and sync script remain unchanged. This round judges only Verification Round 1, Phases 0–2, and readiness for Phase 3. Missing results from the unperformed Phases 3–5 are not findings.

Evidence reviewed includes the rebuild and Pi upgrade runbooks, September compaction implementation and freeze ruling; manifest, patch, all eight retained test files and both checker scripts; original installed/stock 0.1.60 fixes, stock/tag 0.3.10, the development clone, retained layouts/ported source, merge and variant evidence; baseline/red/ported/typecheck/adapted logs; probe/parser/observer scripts, saved A/B output, private compaction RPC/results/observer logs and private package selections; staged Pi changelog and relevant provider/compaction documentation and code. No auth file or credential value was opened.

Read-only verification:

- The clone is at `8a5c0aa5b3408c20eb0c8666939b51fc17b41b09`; tag `src` and `shared` match npm. Its tracked changes are the nine reported source files; the eight added test files are untracked files. Retained layouts and `ported-src` match the reviewed files. The original stale-auth helper bodies are unchanged after relocation; finalizer changes preserve upstream's local-runtime error formatting.
- The unchanged checker passes for stock 0.3.10 with `--baseline`, the patched private runtime and installed Mac 0.1.60. All nine changed source and nine compiled files are covered; no other `src`, `dist` or `shared` file differs in the private runtime. Independently reconstructed all 18 patch outputs in memory using exact stock hunk contexts, matching the runtime bytes. TypeScript emission into memory reproduces all 114 stock modules and all 114 ported modules, with no mismatches or emission diagnostics. No package was patched or built on disk by this audit.
- Re-ran the seven focused Vitest files in the development clone: **47/47 PASS** (14 compaction, 29 stale-auth, 4 model-variant). Source `tsc --noEmit` and replay-compile `tsc --noEmit -p test/tsconfig.json` pass. Test typecheck `tsc -p tsconfig.test.json --noEmit` fails with **five diagnostics across four files**, detailed below. The retained test assets equal the clone's tests byte-for-byte.
- Saved full-suite evidence reports stock 1495 passing/5 skipped and ported 1518 passing/24 failing/5 skipped. Independently compared the failure sets: the fix-off variants attribute 17/1/6 failures to (a)/(b)/(c), disjoint and complete, with no extra failures in those variants. This establishes causation, not that the agreed full verification gate passed.
- Saved candidate A/B output contains actual Pi read execution, `CODE=ZEBRA-4471` and the expected file marker, with exit 0. Both private live agents select the patched package through its manifest. The successful manual and automatic runs have 1651- and 596-character summaries, respectively; observer logs contain no tool/probe activity between compaction boundaries and both subsequent read executions succeed with `COMPACTION_FIXTURE_OK`. Automatic also returns `AUTO_COMPACTION_OK`. The append-only manual RPC log retains the earlier reported “Nothing to compact” attempt; the later successful attempt supports the final result. Pi 0.87.1's main and prefix summarizers explicitly reject provider `toolCall` blocks, so successful compaction also supports the text-only result claim.
- Phase 0 hashes still match all 109 recorded adapter files, seven settings/models/extension files and the installed Luna extension. Installed Pi is still 0.85.1 with the unbundled launcher; the 288-ID baseline is retained. No Pi process, live provider call, installation, server operation or production edit was performed by this audit.

### I1-01 — medium — D2 drops the omitted-tools routing protection for legacy contexts

Owner requirement: preserve the September omitted/empty-tools compaction protection and all Mac fix sets (Owner brief 3 and 6). Phase 1.4(a) explicitly requires an empty resolved tool set and coverage of both legacy and transcript contexts.

Evidence/consequence: the candidate leaves `src/cursor-context-tools.ts:5–7` unchanged. `src/cursor-pi-context.ts:36–42` deliberately returns `tools: undefined` for a legacy context containing `systemPrompt` but omitting tools. `src/cursor-native-replay-routing.ts:14–27` interprets that undefined set as active and selects `queue_replay`; lines 39–40 likewise treat all queued native tools as active. Disabling the MCP bridge in turn preparation does not disable this separate native replay path.

A read-only call to the built candidate functions, with registered native `read`, produced:

- `{ messages: [] }`: empty tool set, bridge disabled, `inactive_trace`.
- `{ systemPrompt: "Summarize only.", messages: [] }`: **undefined tool set, bridge disabled, `queue_replay`**.
- The same legacy context with `tools: []`: empty tool set, bridge disabled, `inactive_trace`.

The existing routing/drain tests use the first and third forms without a `systemPrompt`, so their eight stock passes do not prove the original routing fix is wholly upstream. This is a missing part of the approved legacy-context contract, not a claim that the successful normalized Pi 0.87.1 live runs failed.

Smallest remedy: retain the original empty-set normalization in the existing `cursor-context-tools.ts`, sourcing tools through `resolveCursorPiContext`; cover the legacy `systemPrompt` form in the existing parameterized compaction test, and regenerate the corresponding source/dist recovery entries and hashes. No new routing architecture or unrelated compatibility work is needed. D2 is not accepted as behaviorally equivalent.

### I1-02 — medium — Ported test fixtures still fail typecheck, contrary to the recorded one-error attribution

Owner requirement: adapt copied tests/stubs for 0.3.10 and complete the planned typecheck/test verification (Phase 1.3 and 1.5); retain usable recovery tests and an accurate implementation record.

Evidence/consequence: both `evidence/phase1/typecheck-ported.log` and the independent rerun show:

- `test/auth-recreate-fixtures.ts:115`: the prepared-turn test double is not compatible with 0.3.10's coordinator type.
- `test/cursor-compaction.test.ts:21,33`: the native-tool fixture lacks required `isError` (two diagnostics).
- `test/cursor-provider-run-finalizer-auth-recreate.test.ts:26`: the finalizer fixture lacks required `runtimeTarget`.
- `test/cursor-provider-run-finalizer.test.ts:114`: the existing upstream fixture lacks the newly required `hasEmittedProgress` callback.

Thus three copied local test files also fail; implementation lines 45–47 and D4's “one upstream test” description are incorrect. Vitest's green runtime execution does not check these types. The same incompatible fixtures are in the retained maintenance assets.

Smallest remedy: adapt those existing test doubles to the current contracts (`isError`, `runtimeTarget`, appropriate explicit fixture typing, and the progress callback), sync the corrected ported files and asset hashes, rerun the existing typecheck/focused tests, and correct the verification record. Do not weaken production types or redesign stale-auth recovery to accommodate a test fixture.

### I1-03 — medium — D4 leaves the agreed broader verification gate unresolved before activation

Owner requirement: Phase 1.5 requires no new failures versus the untouched baseline. The review's PASS criteria require relevant verification passing and no unresolved owner decision. Only the owner can waive an approved acceptance gate.

Evidence/consequence: the unmodified baseline is green, while the reviewed port still has 24 upstream test failures. The fix-off evidence supports the reported 17/1/6 attribution, but removing a fix to make its affected tests pass does not verify those behaviors with the fix enabled. The saved `fix-a-adapted.log` is also not a clean substitute: it has **20 failures/104 passes**, retains four original fix-(a) failures, and introduces 15 failures absent from the original full-suite failure list. Thirteen original fix-(a) failures disappear in that saved run, consistent with that part of the record; however, the record's separate successful isolated/adapted checks are not retained as reproducible passing evidence alongside it. The scratch test edits were reverted. I am not treating those scratch-only failures as production regressions, or requiring removal of the owner's fixes to satisfy conflicting upstream expectations.

The audit history contains implementation approval but no owner ruling waiving this gate. D4 therefore cannot be accepted merely by changing the wording from “no new failures” to “all failures attributed.”

Smallest remedy: after the concrete corrections above, reconcile this gate before Phase 3. If retaining the approved green-check criterion, adapt only the directly affected existing fixtures/expectations to the owner's behavior and retain a passing run with all three fixes enabled. If the builder proposes accepting named residual failures instead, obtain an explicit owner ruling accepting that exact deviation and document the evidence/limits accurately. This finding does not authorize unrelated upstream repairs, additional features or a broader test program.

Deviation dispositions:

- D1: accepted as an equivalent placement in an already patched module. The helper bodies and focused stale-auth behavior are preserved; no new module or checker semantics are needed. P1-01 remains resolved.
- D2: not accepted; I1-01 identifies the missing legacy routing behavior.
- D3: partial stock passing is reasonable when upstream already supplies a behavior; requiring every preservation test to fail would be artificial. Correct the arithmetic when updating the record: the saved red run has **5/14 compaction failures and 9 passes**, not 6 failures. Its eight routing passes also have the coverage limit in I1-01.
- D4: unresolved under I1-02/I1-03. Attribution is useful evidence, not an owner waiver or a passing typecheck/suite.
- D5: accepted as a private fixture adjustment. It exercises the real manual compaction path without changing production settings; the successful event and following ordinary tool turn are retained.

No finding reopens the three resolved plan findings, WSL deferral, stock-server decision, or acknowledged lack of a forced live stale-auth event. Phases 3–5 remain unperformed; do not activate on this review. Only this append-only audit and the assigned heartbeat were intentionally written; existing evidence and other agents' work were retained.

Open findings: **0 high, 3 medium, 0 low**. All are round-one implementation findings within the approved port and verification requirements. The required zero-HIGH/MEDIUM and passing-verification/no-unresolved-decision conditions are not met.

Verdict: REVISE

## Implementation Response Round 1 — Builder (Claude Opus 5.5)

All three findings accepted; changes are recorded in the implementation record's "Verification Round 2". No production change; no owner waiver requested.

- I1-01 — Accepted. D2 withdrawn. `src/cursor-context-tools.ts` restores the September empty-set normalization, sourcing tools through `resolveCursorPiContext`; turn preparation uses `disablePiToolBridge: activeToolNames.size === 0`. The existing parameterized `cursor-compaction.test.ts` now covers the legacy `{ systemPrompt, messages: [] }` form (routing and drain): both new cases fail on stock routing (`evidence/phase1-r2/legacy-cases-red-on-stock-routing.log`) and pass on the port. Source and dist recovery entries regenerated (patch now 20 files: 10 `src` + 10 `dist`).
- I1-02 — Accepted. Fixture types only: `as unknown as CursorProviderTurnPrepareResult` for the partial prepared-turn test double, `isError: false` on the compaction tool fixture, `runtimeTarget: () => "local"` in the finalizer auth test, `hasEmittedProgress: () => false` in the upstream finalizer test. Full `npm run typecheck` 0 errors. Record corrected (five diagnostics in four files; D3 arithmetic 5 of 14 fail on stock).
- I1-03 — Accepted; the approved green-check criterion is kept. Only directly affected fixtures/expectations were adapted to the owner's behavior: the shared `test/helpers/context-fixtures.ts` `makeContext()` declares the adapter's `NATIVE_CURSOR_TOOL_NAMES` (a real Pi request declares its tools; the legacy no-tools shape now means "no tools" under the owner's rule) — 87 failures down to 10, none new; then ten expectation edits (five model-discovery ID lists plus one follow-on index, the snapshot identity invariant plus unqualified IDs, pi-context and stream-config empty-snapshot → no bridge/guidance, stream-auth both attempts failing, mcp-timeout-override valid context). With all three fixes enabled: typecheck 0 errors; suite 139 files passed + 1 skipped, 1544 tests passed + 5 skipped (baseline 1495 + 49 ported). Adaptation diff retained: `evidence/phase1-r2/upstream-test-adaptations.diff` (8 files, 184 lines). No production code changed for I1-03.
- Regenerated recovery assets verified by the runbook rehearsal on a fresh stock copy (baseline PASS, 20 files patched without fuzz, after PASS, identical to the ported layout). Private runtime re-patched from stock; live evidence re-run on this exact candidate (`evidence/phase2-r2/`): A/B probe PASS, manual compaction PASS (1984-char summary), automatic threshold compaction PASS (609-char summary), no tool/probe activity during either summary, following Pi `read` turns PASS.

## Implementation Audit Round 2 — Codex gpt-6-astra (max)

Date: 2026-09-23. Phase: Implementation Audit. Role: critic. Numeric round: 2. Caller-selected model/effort: `gpt-6-astra` / `max`; continuing Codex session `01a0cf06-bdf3-7bc0-9794-9fc5738dd742`. Re-read both global rule files, both project rule files, the entire approved plan, the entire updated implementation record and the full audit history, including every Owner Ruling and Implementation Response Round 1. Reviewed the complete Phases 0–2 scope, not only the three remedies.

Reviewed artifact identities: plan SHA-256 `e6136a35907bae75a655b627ce00c282334c1737079d4d54a3f944608388c116`; implementation `4fc376c90f96c511a03e57ae63f6b88d077879e3107f0dc64d411feff0c79d01`; maintenance manifest `fbc44da9bf85a58bcb6e964046e4e3a2310adba07f601c7e1911b7dce133f7fd`; 0.3.10 patch `333ee079107591a45b97e6fdc249014b8d1b5a7452d36afab5f061b4ae72c509`. The development clone remains at upstream `8a5c0aa5b3408c20eb0c8666939b51fc17b41b09`.

Outcome, scope and done criteria: the approved outcome remains Mac Pi 0.87.1 with adapter 0.3.10 preserving compaction isolation, one-time stale-auth recovery and model variants/effort mapping, followed by the existing sync to mock and backup using stock adapter 0.3.10. This audit decides whether the port, tests, recovery assets and private candidate evidence are ready for Phase 3. Final completion still requires the installed launcher/Luna check, installed adapter and read/system-prompt checks, model-ID parity, desktop model-switch and packaged-app checks, server checks, records and rollback preservation. WSL remains deferred; the app guard, old editable adapter checkout and sync script remain outside the edit scope. Unperformed Phases 3–5 are not represented as passed.

### Round-one findings — all resolved

- **I1-01 — resolved.** `cursor-context-tools.ts` now obtains tools through `resolveCursorPiContext` and always returns a set, including an empty set when tools are omitted. Turn preparation disables the bridge when that set is empty. The existing compaction test loop covers messages-only omitted tools, explicit empty tools and legacy `systemPrompt` with omitted tools. The two added legacy routing/drain cases fail on stock routing in the retained red log and pass in the current suite. This restores both native routing and bridge isolation; the additional source and compiled module are included in the recovery assets. D2 is withdrawn.
- **I1-02 — resolved.** The partial prepared-turn test double has an explicit test-only cast; native tool fixtures include `isError: false`; the finalizer auth fixture supplies the local runtime target; the upstream finalizer fixture supplies the progress callback. These repairs match the current contracts without weakening production types. The three changed retained test assets exactly match their clone copies. Independently ran `npm run typecheck`: source, tests and replay-compile stages all passed with zero diagnostics. The implementation now correctly records the earlier five diagnostics across four files.
- **I1-03 — resolved.** Reviewed the complete eight-file upstream test adaptation diff and verified it exactly matches `evidence/phase1-r2/upstream-test-adaptations.diff`. The shared normal-request fixture declares the native tools it exercises; the affected expectations reflect the approved empty-tools, one-retry and unqualified-model-ID behaviors. The timeout test now supplies a valid context. These are directly affected fixture/expectation repairs, with no production changes for this remedy or additional skips. Retained failure lists confirm 87 failures reduced to 10 without new failures after the shared fixture repair. Independently ran the entire current suite with all three fixes enabled: **139 files passed, 1 skipped; 1,544 tests passed, 5 skipped**. This is the 1,495-test green baseline plus 49 ported tests (16 compaction, 29 stale-auth, 4 model-variant). D4 is resolved by passing verification; no owner waiver is needed.

### Complete-scope verification

- Rechecked the source port against the original Mac fixes and upstream 0.3.10, the September compaction/freeze records, current maintenance tests, runbooks and both checker scripts. The stale-auth helper bodies and bounded retry behavior are preserved; upstream runtime-target handling remains intact. Model tests cover both ID/context selection and the outbound `reasoning_effort` mapping. D1 remains an accepted equivalent helper placement in the already-patched drain module. No resolved plan finding is reopened.
- The unchanged checker passed independently for stock 0.3.10 with `--baseline` and for the patched private runtime. The manifest covers all **10 changed source and 10 changed compiled files**. Compared all 114 source files, 114 compiled files and 12 shared files: no uncovered changes, shared-file changes or clone/runtime mismatches. All eight retained test files match the clone. Independently applied every patch hunk in memory against exact stock contexts; all 20 outputs match the private runtime bytes and the manifest paths. TypeScript emission into memory reproduced all 114 stock modules and all 114 ported modules with zero diagnostics or mismatches. No patch or build was written to disk by this audit. Clone `git diff --check` also passed.
- Reviewed the current `evidence/phase2-r2` results against the underlying private RPC/observer logs and package selections, and re-read the probe/observer/parser scripts. The A/B run has actual successful Pi read execution, `CODE=ZEBRA-4471`, the expected file marker, normal stop and exit 0. Both private agents select the reviewed runtime through its package manifest. Manual compaction has reason `manual`, one successful end and a **1,984-character** summary; automatic has reason `threshold`, one successful end and a **609-character** summary. Neither has observer tool/probe activity within compaction. Both subsequently execute `read` successfully and return `COMPACTION_FIXTURE_OK`; automatic also returns `AUTO_COMPACTION_OK`. Successful Pi 0.87.1 compaction, whose summarizers reject provider `toolCall` blocks, supports the text-only summary claim. These are reviewed retained live results, not live calls made by this audit.
- Phase 0 hashes still match all 109 recorded installed adapter files, seven settings/models/extension files and the Luna extension. Installed Pi remains **0.85.1**, installed adapter **0.1.60**, and staged Pi **0.87.1**. The preserved baseline and current candidate evidence support proceeding to activation; they do not replace the plan's later installed-runtime, desktop, model-ID parity or server gates.
- D3's corrected stock result is **5 compaction failures and 9 passes out of 14**, with the two new legacy red cases covering the previously missing path. Partial stock passing is not a defect. D5 remains an accepted private manual-compaction fixture setting, with no production setting change. The acknowledged lack of a forced live stale-auth failure remains the approved verification limit.

No installation, runtime/config edit, Pi start, live provider call or server operation was performed by this audit. No auth file or credential value was opened. Only the assigned heartbeat and this append-only audit were intentionally written; other agents' files and retained evidence were preserved.

New findings: none. Open findings: **0 high, 0 medium, 0 low**. All three prior implementation findings are closed, relevant verification passes and no owner decision remains unresolved for Phases 0–2. The reviewed candidate is ready for Phase 3 under the already approved plan and its maintenance-window/activation gates; this is not a claim that activation or the overall upgrade is complete.

Verdict: PASS

## Implementation Audit Round 3 — Codex gpt-6-astra (max)

Date: 2026-09-23. Phase: Implementation Audit. Role: critic. Numeric round: 3, final ordinary round. Caller-selected model/effort: `gpt-6-astra` / `max`; continuing Codex session `01a0cf06-bdf3-7bc0-9794-9fc5738dd742`. Re-read both global rule files, both project rule files, the entire approved plan, updated implementation record and complete audit history, including all Owner Rulings and prior resolutions. Plan SHA-256 remains `e6136a35907bae75a655b627ce00c282334c1737079d4d54a3f944608388c116`; reviewed implementation SHA-256 is `e08c0642d076509220c0a5322bc7f402b4e8e7c009f30063f783387e053538c0`.

Outcome, scope and done criteria: Mac Pi 0.87.1 with adapter 0.3.10 preserving compaction isolation, one-time stale-auth recovery and model variants/effort mapping; then mock and backup on Pi 0.87.1 with stock adapter 0.3.10 through the existing sync. Completion is assessed against all eight criteria: actual launcher/Luna startup, installed manifest-loaded adapter, read/system-prompt behavior, ported regressions and Mac model-ID parity, private manual/automatic compaction followed by a tool turn, Electron model switching and installed packaged smoke, both server checks, and recovery records/kit/rollback/cleanup. WSL remains deferred. App source, Rust/Tauri builds, unrelated upstream behavior, the old adapter checkout and sync-script changes remain outside the approved scope. This round covers the complete executed task, including Phases 3–5.

### Verification against the complete task

- **Port and recovery:** the manifest and 20-file patch retain their Round 2 identities (`fbc44da9…133f7fd` and `333ee079…72c509`). All 114 source, 114 compiled and 12 shared files in the installed adapter match the reviewed private runtime and development clone. All eight retained test files match the clone, and the upstream test adaptation diff exactly matches the retained Round 2 diff. The independently passing Round 2 full suite (1,544 tests passed, 5 skipped), three-stage typecheck and reproducible emission/recovery checks therefore apply to the unchanged port. I1-01, I1-02 and I1-03 remain closed; D1–D5 retain their accepted/withdrawn/resolved dispositions. No redundant full-suite rerun was needed.
- **Mac activation, Done 1–3:** installed metadata is Pi 0.87.1 and adapter 0.3.10; the nvm launcher and `~/.pi/agent/bin/pi` resolve to the installed unbundled `dist/cli.js`. Independently ran the Luna checker through `~/.local/bin/pi` with the actual extension in `/Applications/Alamelu Pi Tauri.app/Contents/Resources/extensions/`: PASS, two RPC requests. My first invocation supplied an incorrect Application Support extension path and failed with “path does not exist”; using the path recorded in the deployment snapshot passed. That was an audit invocation error, not a release failure. Both repository and maintenance-kit adapter checkers independently passed. Reviewed install/patch logs show the 20 files patched without fuzz. Parsed installed A/B JSONL: successful Pi `read`, normal stop, correct code word and file marker; recorded exit 0. All three retained laptop provider probes answered `4`.
- **Done 4–5:** before/after Mac Cursor ID sets are exactly equal, 288 each. The current private manual and automatic evidence remains PASS, with 1,984- and 609-character summaries, expected compaction reasons, no tool/probe execution inside compaction boundaries and successful following reads. The installed package matches this manifest-loaded candidate. The approved limitation on forcing a live stale-auth failure remains accurately recorded.
- **Done 6:** retained Electron model-switch log shows the real picker test passing after two compactions (1 test); packaged smoke reports 47 providers, 816 models and 91 API members. Verified the clean export's lockfile, test, Electron helper, smoke script, verification script and relevant auth-bridge source against commit `4668c964a6df517e7b95a8d8cd3f60e151b8b5f0`; the task's runbook/manifest/patch overlays match the current canonical files. The retained upgrade-gate log has 31 passing app/RPC/wiring tests, intact recovery assets and 8 passing package-protection tests. No desktop launch, interaction or build was performed by this audit.
- **Preservation:** independently rehashed all 978 protected owner session files: zero changes and zero missing files. Models, extensions and the installed Luna extension match the pre-activation snapshots. Current config hashes match the saved after-snapshot; the sole settings change versus rollback is replacing the adapter package entry with `npm:pi-cursor-sdk@0.3.10`, preserving the other package. I did not open auth.json; the unchanged activation-time auth hash is a builder-reported preservation result. The three new provider-probe sessions are identified and retained, not confused with changed owner history.
- **Servers, Done 7:** read-only SSH independently confirms both hosts run Pi 0.87.1 with adapter 0.3.10 loading `dist/index.js`, with bundled Pi launchers. All 240 adapter source/dist/shared files on each host exactly match stock npm 0.3.10. Each server's settings differ from its rollback only in `packages`, retaining its other packages. Parsed both servers' saved A/B JSONL for Pi 0.85.1 and 0.87.1: each has successful Pi read execution, both expected markers, normal stop and exit 0. Saved catalogs contain both required relay IDs. The documented 47 omitted older IDs are consistent with the explicitly approved stock-server choice; the Mac parity criterion remains fully met. The unchanged sync script's retained log records both upgrades and successful xai, xai-i2o and openai-codex replies at 22:36–22:37 IST, outside the protected window. No remote prompt or model-list call was made by this audit.
- **Records and cleanup, Done 8/Phase 5:** reviewed the runbook diff, dated release status/logs, progress entry and repo-memory rows. Thirteen copied release evidence files match their task-workspace originals; all 20 release-status runtime hashes match the installed adapter. All 23 kit-manifest entries match both the kit files and canonical repository files. The runbook records the 0.3.10 recovery procedure, current Mac versions and WSL pending state. Mac rollback archives retain Pi 0.85.1 and adapter 0.1.60 metadata; both server archives retain adapter 0.1.42. Settings backups and the old kit are present. No private auth.json remains in the task-owned non-dependency directories. Other temporary evidence, test sessions and rollback files remain retained as planned. The commit remains pending the owner's authorization, as explicitly sequenced after audit PASS; this audit performs no commit.

### D6 and the sync-stdin incident

D6 is acceptable within the activation/verification scope. The builder reopened the app rather than the owner, but the resulting launch-path investigation stayed within the existing runtime verification and did not introduce an app fix. Historical startup logs show the same wrapper-first PATH, `/Users/sudhirjha/.local/package.json` lookup failure and reduced provider count on 2026-09-14. The unchanged auth bridge rejects executables outside the unbundled `dist/cli.js` layout. The corrected 2026-09-23 launch log shows the usual resolved runtime path, 47 providers, 818 models and no last error; read-only process inspection confirms its backend and Pi child are alive. The preserved owner-session hashes support the reported idle relaunch. The PATH behavior remains a reported pre-existing concern, outside this upgrade's required fixes.

The sync preflight indeed invokes `pi -p` with inherited stdin. Rerunning the unchanged script with `/dev/null` is a bounded invocation correction within the authorized sync. The recorded stop of the first run's own process tree is consistent with the reported local-preflight stall; the successful rerun and independently verified final server state support the completed outcome. No broader script hardening is required by this audit.

### I3-01 — low — The replacement memory lost the original cross-repository scope

Owner requirement: Phase 5.5 updates the existing repo-memory note about the Mac adapter/runtime so future rebuilds use the current facts.

Evidence/consequence: read-only database inspection shows `mem_84d3a82c0b0d` belonged to `alamelu-tauri-b776c178` with `scope=global` and is now retracted. Its corrected replacement, `mem_4ff83f86f2e3`, is active but belongs to `alamelu-771d196a` with `scope=project`. The installed RepoMem retrieval code (`repo_memory/core/store.py:201–220`) includes only the current project's notes or globally scoped notes. Applying that predicate for alamelu-tauri returns neither record. The corrected text is therefore unavailable through this project's memory retrieval, despite the implementation's record-update claim. This is a low-severity record defect: the current runtime, canonical runbook and standalone recovery kit are correct, and the memory source is informational rather than a guardrail. It was introduced by Phase 5 after Round 2, not a reopened finding.

Smallest remedy: preserve the corrected text and restore the replacement note's original global visibility; keep the stale note retracted. This is the existing Phase 5.5 update, not an additional workflow, runtime change or test program.

Only the assigned heartbeat and this append-only audit were intentionally written. No credential file/value was opened, no live model/provider call was made, and no app/runtime/server/kit/code changes were performed. The local RPC checker and read-only server/version/evidence checks were explicitly authorized by this round's prompt. Earlier history is preserved.

Open findings: **0 high, 0 medium, 1 low**. All operational verification gates pass; the single informational-record follow-up is within the stated allowance of at most three LOW findings. No unresolved owner scope/design decision blocks this review. Commit authorization and deferred WSL work retain their already specified owner-controlled sequence. The complete implementation meets this audit's PASS criteria.

Verdict: PASS

## Implementation Response Round 3 — Builder (Claude Opus 5.5)

- I3-01 — Accepted and fixed (trivial in-scope LOW; no further review round per the skill). The corrected text was re-added with `--global` as `mem_1acba792a055` (scope `global`, status `active`); the project-scoped duplicate `mem_4ff83f86f2e3` and the stale `mem_84d3a82c0b0d` are both `retracted`. `repomem recall` run from alamelu-tauri returns the corrected note.
- Implementation lifecycle closed after this final PASS: the critic runs were `codex exec` sessions that have exited; no owned critic process or monitor remains. Critic prompts, events and heartbeats are retained in `/private/tmp/pi087-critic.*` and `/private/tmp/pi087-impl-critic.*` pending the owner's approval to delete temp artifacts (alamelu-tauri AGENTS.md).
