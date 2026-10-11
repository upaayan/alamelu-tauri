# Pi 1.1.0 + pi-cursor-sdk 0.5.3 upgrade — audit

Append-only audit log. Debate-loop with a full plan phase (Plan Audit rounds), then owner approval,
then implementation (Implementation Audit rounds). Critic: Claude Fable (effort high), chosen by the owner.

Artifact under review: `documents/plan-audit-implementation/pi110_cursor_053_upgrade_plan.md`.

---

## Plan Audit Round 1

**Reviewer:** critic (Claude Fable/high, session 1f7bc3ea-43eb-4785-96e4-edc9bff94db7)
**Date:** 2026-10-11

### Outcome, scope and done criteria (restated)

Outcome: the Mac moves from Pi 0.87.1 + patched pi-cursor-sdk 0.3.10 to Pi 1.1.0 + pi-cursor-sdk 0.5.3 carrying only the Mac
fixes upstream still lacks, with Alamelu Pi's protections intact; then the existing sync run puts mock and backup on Pi 1.1.0
with Cursor still working for the relay and readiness chains. Scope: Mac Pi package and launcher, Mac adapter (port, patch,
tests, manifest), the existing `server_pi_maintenance.sh` sync, the servers' adapter per D1, gates and records; WSL deferred
to month end; no app source change, no Rust build, no server Node change unless D1(b). Done when the nine listed criteria hold,
chiefly: Luna RPC check through the real launcher (gate 1), checker PASS on a `0.5.3` manifest entry (gate 2), red→green
ported tests, A/B `read`/`CODE=ZEBRA-4471` probe, private manual and automatic compaction with text-only summaries (gate 3),
`compacted-model-switch.spec.ts` plus packaged smoke (gate 4), model-ID parity, both servers on 1.1.0 with the relay-chain
Cursor IDs listed, and tracked assets/records/rollbacks.

### What the critic verified (read-only)

- Rule files (global CLAUDE.md, AGENTS.md/CLAUDE.md symlink), `REBUILD-PROTECTION.md`, `PI-UPGRADE-WINDOWS.md`, the whole
  plan, the whole September plan/audit/implementation record, and the audit header.
- npm: `@earendil-works/pi-coding-agent` latest = 1.1.0 (2026-10-07), `bin` = `dist/bundle/cli.js`, engines `>=22.19.0`;
  `pi-cursor-sdk` latest = 0.5.3 (2026-10-07), engines `>=24`, wildcard Pi/TypeBox peers, `pi.extensions` = `./dist/index.js`,
  depends on `@cursor/sdk` 1.0.37 (darwin-arm64 and linux-x64 optional binaries present). Published versions confirm no Pi
  0.88–0.98 releases. 0.3.10 has engines `>=22.19.0` and wildcard peers (relevant to D1(a)).
- Downloaded (not installed) the 1.1.0 Pi, 1.1.0 pi-ai and 0.5.3 adapter tarballs into a scratch dir: Pi 1.1.0 has
  `dist/cli.js`, `dist/index.js`, `dist/modes/interactive/interactive-mode.js`, `dist/migrations.js`; `dist/index.d.ts`
  still exports `ModelRuntime`, `AuthStorage`, `ModelRegistry` (used by `external-pi-auth-bridge.ts`); the unbundled extension
  loader (`dist/core/extensions/loader.js`) still aliases `@earendil-works/pi-coding-agent` to the filesystem entry via jiti
  (what `alpi-luna-websocket-recovery.ts` needs; same alias table shape as 0.87.1, including the `pi-ai` → compat alias).
  pi-ai 1.1.0 has `dist/api/openai-codex-responses.js` exporting `resetOpenAICodexWebSocketDebugStats` and
  `dist/api/openai-completions.js` containing the upstream fix signature that makes `pi-ai-patch.mjs` a no-op
  ("fixed-upstream"); the installed 0.87.1 pi-ai is in the same state. All CLI flags the plan, the Luna checker and the sync
  script rely on (`--mode rpc`, `--no-session`, `--no-extensions`, `--no-skills`, `--no-context-files`,
  `--no-prompt-templates`, `--no-themes`, `--extension`, `--tools`, `--append-system-prompt`, `--list-models`, `-p`,
  `--provider`, `--model`) are present in 1.1.0's `dist/cli/args.js`; RPC `get_state`/`get_messages`/`set_model`/`compact`
  exist in `dist/modes/rpc/rpc-mode.js`. `pi install` in 1.1.0 replaces a matching `npm:<name>` entry in place
  (`package-manager.js` ~629–640), as the plan's Phase 3.4 assumes. `migrations.js` only handles `oauth.json`/`apiKeys`,
  root `.jsonl`, `tools/`→`bin/`, `keybindings.json`, `commands/`→`prompts/`; none of those inputs exist in `~/.pi/agent`.
- Pi changelog 0.99.0→1.1.0: the only Breaking Change is the 1.0.3 `azure-openai-responses`→`azure` rename; grep of
  settings/models/auth for that key = 0 hits (no values printed). 0.99.0's `--no-extensions` now also disables built-in
  extensions: the app runs with `noExtensions: false` plus the Luna `--extension` (main.ts:665/857) and the Luna checker loads
  its extension explicitly, so neither is affected. 1.0.1 removed `npm-shrinkwrap.json` from the package (see note N3).
- Adapter changelog (tarball copy and upstream `main`): 0.4.0 "Require Node.js 24 and Pi 0.87.1"; 0.5.0 breaking change on
  bare `modelRegistry.complete/streamSimple` — `pi-web-access` uses only `modelRegistry.find/getApiKeyAndHeaders/getAvailable`
  and `registerCommand`; the Mac extensions use `registerProvider` only; the servers' extensions/NIM packages show no hits.
  0.5.0 isolates LOCAL compaction summaries in text-only agents (candidate cover for fix a); 0.5.0/0.5.3 map
  `reasoning_effort`/thinking+effort (candidate cover for fix c); no stale-auth recreate entry (fix b). Upstream tag `v0.5.3`
  exists (`4245615c`), its `package.json` has `build`/`typecheck`/`test` scripts and the repo has a `package-lock.json`.
  Tarball ships `src`, `dist` (124 files each), `shared`, build/prepare scripts and a nested `node_modules` (hono, MCP) but no
  tests or lockfile — the Phase 1 clone approach is required and viable.
- Mac state: `~/.local/bin/pi` wrapper execs nvm default (`default` → 24) `bin/pi`, which symlinks to
  `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`; `pi --version` = 0.87.1; adapter 0.3.10 at
  `~/.pi/agent/npm/node_modules/pi-cursor-sdk`; `scripts/check-cursor-compaction.py --package …` → PASS; `packages` =
  `npm:pi-cursor-sdk@0.3.10`, `../../playground/pi-web-access`; extensions as listed; `npmCommand` = `/opt/homebrew/bin/npm`
  (Homebrew Node v26.5.0, satisfies the adapter's `>=24` engine check at install time; runtime is Pi's Node 24.16.0);
  installed app Luna extension at `/Applications/Alamelu Pi Tauri.app/Contents/Resources/extensions/` is byte-identical to
  the repo copy; September harness files (`ab-probe.sh`, `parse.py`, `live-compaction.py`, `observer.ts`) exist. No Pi
  processes were running. `~/.pi/agent/sessions` is 191M and `~/.pi/agent/backups` 195M (relevant to P1-1).
- Servers (SSH, read-only): mock `e2e-95-36` and backup `e2e-94-217` both: wrapper `~/.local/bin/pi` → Node
  `~/.local/share/pi-node/node-v22.22.3-linux-x64`; `pi --version` 0.87.1 via `dist/bundle/cli.js`; adapter 0.3.10;
  `packages` exactly as the plan lists; `s3-relay` tmux alive; relay poller fallback chain names `pi:cursor:composer-2.5` and
  `pi:cursor:composer-latest:fast`. System Node is 22.22.3 (mock) / 22.18.0 (backup); no Node 24 anywhere → D1 is real.
- Sync script: syncs `auth.json`, `models.json`, `.vertex.json` and the two xAI extension files (not `settings.json`, so the
  servers' `packages` pin survives), installs `@earendil-works/pi-coding-agent@latest` with the server's own npm only when the
  remote version is lower than the laptop's, then runs four `pi -p` smokes. Consistent with Phases 4.3–4.5.
- REBUILD-PROTECTION gates: 1 → Phase 3.3/3.5; 2 → 3.4; 3 → 2.8 (candidate runtime, as accepted in September); 4 → 3.6
  (with the `ALAMELU_TAURI_APP_PATH` override from audit P1-02 of September); 5 n/a (no backend change); 6 → 3.1/3.7/5.1;
  `verify:upgrade` → 5.1; kit sync → 5.2. Build order: Phases 0–2 touch no production file (see P1-1 for the one
  under-specified copy); rollback precedes every change in Phases 3 and 4; the live `~/.pi/agent` is first touched in 3.4.

### Findings

1. **[severity: low]** P1-1 — Phase 2.2's "private agent dir = a copy of `~/.pi/agent`" is under-specified in two ways that
   produce false failures
   - Owner requirement: Phases 0–2 make no production change and give trustworthy pre-activation evidence (plan "Build
     order"; Done 4–7 depend on Phase 2 results).
   - Evidence/consequence: the task workspace lives at `~/.pi/agent/backups/pi110-cursor-053-20261011/`, so a plain
     recursive copy of `~/.pi/agent` into `…/probe/` copies `backups/` (195M, including the September workspace and the
     copy's own destination) and `sessions/` (191M of owner history) and recurses into itself. Separately, the `packages`
     entry `../../playground/pi-web-access` resolves against the agent dir; in the private dir it points at a non-existent
     `…/backups/…/playground/pi-web-access`, so Phase 2.4 would report an extension-load error that has nothing to do with
     Pi 1.1.0. No data loss either way, but a wasted round and misleading evidence.
   - Smallest remedy: in Phase 2.2 say the copy excludes `backups/` and `sessions/` (and the nested `npm/` is replaced by the
     candidate), and that `pi-web-access` is written as an absolute path in the private `settings.json`.

2. **[severity: low]** P1-2 — D2 implies Pi 1.1.0 is free of the adapter-reported startup refresh race (#337); the evidence
   does not say that
   - Owner requirement: D1/D2 "framed correctly with a sound recommendation" (critic brief); the owner decides on facts.
   - Evidence/consequence: the adapter's 0.5.1 "Known limits" says the race was demonstrated on official Pi 1.0.4 and that
     the repair is merged in the maintainers' fork, "this release does not claim the official host is fixed". Pi 1.1.0's
     changelog has no corresponding fix. The plan's D2 contrasts 1.1.0 with 1.0.4 "which the adapter changelog records with
     a startup refresh race", which reads as a reason 1.1.0 is safer; in fact the race is unknown-on-1.1.0. Practical
     effect is small (temporary fallback models / a spurious missing-key warning at startup, which Phase 2.10/3.5 parity
     and the A/B probe would surface), but the decision text should not overstate.
   - Smallest remedy: reword D2: "#337 was demonstrated on 1.0.4 and is not known fixed in 1.1.0; it is cosmetic at startup
     and the parity/A/B gates would expose it". Recommendation (1.1.0) stands.

3. **[severity: low]** P1-3 — The Mac rollback capture omits the adapter's two agent-root state files
   - Owner requirement: "rollback before every change"; REBUILD-PROTECTION "Keep one viable rollback of changed runtime
     files".
   - Evidence/consequence: `~/.pi/agent/cursor-sdk-model-list.json` (217 KB) and `cursor-sdk-context-windows.json` are
     written by the adapter; 0.5.x reworked catalog caching and store handling (0.5.1/0.5.2 changelog), so 0.5.3 may rewrite
     them in a newer shape. Phase 3.2 captures only the Pi package, the launcher target, the `npm` tar and `settings.json`;
     a Phase 3.8 rollback would run 0.3.10 against 0.5.3-written caches. Likely harmless, but the two files are small and
     the fix is one line.
   - Smallest remedy: add both files to the Phase 3.2 copy (and to the Phase 0.1 hash list so Phase 3.7 can say whether they
     changed).

### Notes and questions (not findings; no action required unless the builder agrees it is free)

- N1 (question, Phase 2 isolation): the private `PI_CODING_AGENT_DIR` isolates Pi's files, but where does `@cursor/sdk`
  keep its own local store, and is it shared with the production 0.3.10 adapter (SDK 1.0.27)? The 0.5.1 notes describe an
  SDK "MD5-to-SHA256 workspace migration" and a `PI_CURSOR_SDK_STATE_ROOT` override. If the store is shared, setting that
  variable to a private path during Phase 2 keeps "no production change" literally true at zero extra scope. Please answer in
  the implementation record rather than assume.
- N2 (question, D1(a)): the sync copies the Mac `auth.json` to the servers. Phase 2.9 tests Pi 1.1.0 + 0.3.10 with the
  server's current `auth.json`, not with the Mac's post-0.5.3 one. If 0.5.3 ever rewrites the `cursor` entry's shape, the
  servers' 0.3.10 would see it only after the sync (Phase 4.5 catches it; the script backs the remote file up). A keys-only
  (no values) comparison of the `cursor` entry before/after Mac activation in Phase 3.7 would close this for free. Not
  required.
- N3 (information): Pi 1.0.1 removed `npm-shrinkwrap.json`, so `npm install -g @1.1.0` (Phase 3.3) and `@latest` (Phase 4)
  resolve `^1.1.0` siblings (pi-ai, pi-agent-core, pi-tui, pi-mcp, pi-codemode) at install time; today all are 1.1.0. If a
  sibling patch is published between Phase 2 and Phase 3/4, installed bits differ from staged ones. All gates already run on
  the installed runtime, so this is a records point: note the resolved sibling versions in the evidence.
- N4 (no action): `~/.pi/agent/extensions/node_modules/@earendil-works/pi-coding-agent` is a stale 0.74.0 dev copy pulled in
  by `pi-agent-browser-native`; Pi's loader alias wins for extension imports, so it is inert. Mentioned only so nobody
  mistakes it for the runtime.
- Proportion check: nothing in the plan is unnecessary work. Phase 2.9 is the one addition versus September and it is
  exactly what D1 needs (it also tests Pi 1.1.0's unpinned dependency tree on Node 22 before any server changes). The plan's
  factual claims checked above are all correct.

### Verdict: PASS

0 high, 0 medium, 3 low; D1 and D2 remain the owner's approval-time choices and are soundly framed (P1-2 is a wording
correction, not a change of recommendation). The three low items are one-to-two-line edits to Phases 2.2, 3.2/0.1 and D2;
the builder should fold them in before the owner reads the plan, and answer N1/N2 in the implementation record. Build order,
rollback coverage (after P1-3), REBUILD-PROTECTION gate mapping and the "nothing touches live `~/.pi/agent` before Phase
3.4" property all hold. Precedent followed: this plan is the September plan with the version numbers, the Node-24 server
constraint (D1) and a migration check added.

---

## Response to Plan Audit Round 1

**Builder:** Claude (Opus 5.5). **Date:** 2026-10-11

### Accepted changes (all three lows, folded into the plan; low fixes need no extra review round)

1. P1-1 — Accepted. Phase 2.2 now copies `~/.pi/agent` excluding `backups/` and `sessions/`, replaces the nested `npm/`
   with the candidate, and writes the candidate adapter and `pi-web-access` into the private `settings.json` by absolute path.
2. P1-2 — Accepted. D2 reworded: #337 was demonstrated on Pi 1.0.4 and is not known fixed in 1.1.0; its effect is cosmetic
   at startup and the parity/A/B gates would expose it. Recommendation (1.1.0) unchanged.
3. P1-3 — Accepted. `cursor-sdk-model-list.json` and `cursor-sdk-context-windows.json` added to the Phase 0.1 hash list
   and the Phase 3.2 rollback copy.

### Notes adopted at no extra scope

- N1 — Phase 2.2 now checks where `@cursor/sdk` keeps its local store before any run and sets `PI_CURSOR_SDK_STATE_ROOT`
  to a private path if it is shared with production; the answer goes in the implementation record.
- N2 — Phase 0.1 records the key names (no values) of the `cursor` entry in `auth.json`; Phase 3.7 compares them.
- N3 — Phase 3.3 records the resolved sibling package versions in the evidence.
- N4 — noted, no action.

Plan phase complete: PASS (Round 1). Critic session closed after PASS; implementation will start a new recorded lifecycle
after owner approval.

---

## Owner Ruling — 2026-10-11 (implementation approval)

The builder summarized the PASSED plan and asked: "Do you approve the plan with D1 = (a) and D2 = 1.1.0?"
Owner: "D1 --> try (a). If that fails, try (b). (c) is if everything fails" and "D2 --> agree 1.1.0".

- Plan approved for implementation (the owner's earlier "I approve and then you implement" plus this reply).
- D1: (a) first, decided by the Phase 2.9 staged test on mock; if (a) fails, (b) without a further stop; (c) only if
  (b) also fails. The plan's "builder stops and asks for (b) or (c)" is replaced by this ruling (plan D1 updated in place).
- D2: Pi 1.1.0.
- Builder sequencing (September precedent, recorded in the plan): Implementation Audit Round 1 (new Fable lifecycle)
  runs after Phases 0–2 and the D1 result, before any production change; a final Implementation Audit round follows
  Phases 3–5.

---

## Implementation Audit Round 1

**Reviewer:** critic (Claude Fable/high, session 0c590ab3-6f84-4af1-96d1-c3138a458993)
**Date:** 2026-10-11
**Scope of this round:** Phases 0–2 (no production change) and the D1 server decision — the record's "Verification Round 1".
Phases 3–5 have not run and are reviewed in a later round.

### Outcome, scope and done criteria (restated)

Outcome: the Mac moves from Pi 0.87.1 + patched pi-cursor-sdk 0.3.10 to Pi 1.1.0 + pi-cursor-sdk 0.5.3 carrying only the Mac
fixes upstream still lacks, with Alamelu Pi's protections intact; then the existing sync run puts mock and backup on Pi 1.1.0
with Cursor still working for the relay and readiness chains (adapter per D1). Scope: Mac Pi package/launcher, Mac adapter
(port, patch, tests, manifest), the existing `server_pi_maintenance.sh` sync, the servers' adapter per D1, gates and records;
WSL deferred; no app source change, no Rust build, no server Node change unless D1(b). Owner rulings: D1 = (a) first, (b) if (a)
fails, (c) last; D2 = 1.1.0. Done when the nine plan criteria hold. For this round the relevant ones are Done 3 (red→green ported
tests, green-on-stock = covered upstream, not ported), Done 5 (private manual and automatic compaction, text-only summaries,
then a tool turn), Done 7 (model-ID parity) and the Phase 2.9 pre-check that decides D1; plus the recovery assets being
correct before anything touches the live `~/.pi/agent` in Phase 3.4.

### What the critic verified

Read in full: global and repo rules, `REBUILD-PROTECTION.md`, the plan, this audit's history, the implementation record, the
September plan/audit/implementation records, the 0.5.3 patch (src and dist hunks), the eight 0.5.3 test assets, the
clone's working diff, and the evidence files cited. Independent checks (read-only on the clone; a throwaway copy under
`/tmp/critic-053-*` for anything that writes):

- **Recovery assets.** All 9 asset hashes in the `"0.5.3"` manifest entry match the tracked files; all 16 `before` hashes match
  the published 0.5.3 tarball (`dev/tarball/x/package`) and all 16 `after` hashes match the ported clone. The `0.1.60`, `0.3.6`
  and `0.3.10` entries are byte-identical to `HEAD`; `scripts/check-cursor-compaction.py` is unmodified (git clean, last
  change `9ae1e5e`). Checker with no `--package`: PASS. Runbook rehearsal on a fresh copy of the published tarball: after-check
  on the unpatched copy FAIL (as it must) → `--baseline` PASS → `patch --dry-run` 16 files → `patch` exit 0, no fuzz/offset →
  after-check PASS. Installed Mac 0.3.10: PASS. Staged candidate `probe/agent/npm/node_modules/pi-cursor-sdk`: PASS.
  `scripts/test-upgrade-protection.py`: 8 tests OK.
- **dist ↔ src.** Copied the 8 ported `src` files onto a stock copy and ran `npm run build`: the 8 rebuilt `dist` files hash
  exactly to the manifest `after` values; only those 8 `dist` files differ from the tarball. Clone is tag `v0.5.3`
  (`4245615c` → commit `fa82450f`) as recorded.
- **Tests.** On the clone: the 47 ported tests pass (7 files) and `npm run typecheck` (src, tests, replay-compile) exits 0. On a
  stock copy with the 8 test assets copied in: 26 failed / 21 passed — exactly the record's split (stale-auth 24/29 red:
  11+7+2+4; model-variants 2/4 red; compaction 14/14 green with purpose `compaction`). The 6 prepare tests with
  `ALPI_SUMMARY_PURPOSE=normal` on stock: 5 fail — so 0.5.3's protection is keyed on request purpose, not on the tool list.
- **Port (b) against the 0.3.10 Mac fixes** (`dev/merge/mac-0.3.10` vs stock 0.3.10): `cursor-provider-errors.ts`,
  `cursor-live-run-coordinator.ts`, `cursor-provider-turn-emit.ts` and the three drain helpers are carried over verbatim
  (upstream's reworded messages kept). Finalizer: the recreate branch is inserted after upstream's new abort branch, so an
  abort still wins (0.3.10 had no abort branch). Prepare: `forceCreate` is passed to `acquireSessionCursorAgent`, which stock
  0.5.3 already supports (`resumeEligible = localResume && !forceCreate`), so `cursor-session-agent.ts` no longer needs
  patching. Runner: the 0.3.10 separate cloud branch is replaced by one loop with `authRecreateEligible = local && purpose
  "normal"`; cloud and summary turns run the body once (stock behavior). The in-loop catch now rethrows to the outer catch
  (stock's single `applyTerminalEvent`) instead of 0.3.10's in-loop `applyTerminalEvent; return` — equivalent. Scope key:
  `scope.scopeKey` (the session-owned receipt) replaces `getCursorSessionScopeKey()` as the fallback, which is what stock
  0.5.3 itself uses for the pre-send drain. Narrowing recreate to `purpose: "normal"` is justified: 0.5.3 summary turns create
  a fresh agent every time (`cursor-provider-turn-summary.ts`), so pooled stale auth cannot occur there.
- **New 0.5.3 interactions.** Usage ledger: in the live path the first attempt's terminal usage is written by
  `awaitFinalizeCursorRunOutcome` before `markAuthRecreate` is reached; in the direct path likewise; in the catch path the
  runner records `error` through the `usageTerminalRecorded`-guarded helper. The live run's `onAbandon` (abandon record) fires
  only `if (abandoned) { if (!run.done) …}` and `teardownFailedAuthAttempt` sets `done = true` before release, so no double
  terminal record. The retry's second `usageRecorder.start` needs `origin.anchorId` to remain in the branch: Pi 1.1.0's
  agent-core awaits `message_end` for the user prompt (agent-session appends it) before `streamAssistantResponse`, and
  `before_provider_headers` fires inside the stream call, so a real session (file or in-memory) always has the anchor — the
  two stream-auth test adaptations supply exactly that and nothing else.
- **Port (c).** The unqualified-ID block is the 0.3.10 code written to 0.5.3's `metadataMap` parameter; the
  `reasoning_effort` half is dropped because 0.5.3 has `parameterIds.reasoning_effort`, its own thinking map and outbound
  key (the two `reasoning_effort` tests pass on stock). Parity 294/294 with identical normalized rows confirms the unqualified
  IDs keep their context windows.
- **Test adaptations.** Ported files: only moved API (`scope`, `request`, `usageRecorder`, `execution`/`storeIdentity`,
  `onPendingToolCallsChanged`, `recordCursorProviderTerminalUsage`, scope-keyed pre-send drain) plus the two owner-visible
  changes already declared as D1 (summary purpose) and D2 (`reasoning_effort` flag). Upstream files (4): expectation lists
  gain the unqualified IDs; `hasEmittedProgress: () => false` added to a fixture; the rejected-key test lets both attempts
  fail (one retry, as in September); the two `run.wait` ConnectError tests get the session anchor. No production type or
  protection weakened.
- **D1 mechanics (read in code, not inferred).** `cursor-provider-binding.ts` records the `signal` of every
  `session_before_compact` / `session_before_tree` event and resolves `purpose` by signal identity at stream time; Pi 1.1.0
  passes that same `AbortController.signal` from the hook into `compact()` → `generateSummary` → `completeSimple(…, {signal})`
  on both the manual and the automatic path (`agent-session.js` 2191–2199 and 2481–2490; `compaction.js` 463–531). Local
  requests with `purpose !== "normal"` go to `prepareCursorSummaryProviderTurn`: fresh agent, `tools: []`, `bridgeEnabled:
  false`, `useNativeToolReplay: false`, temporary store, never pooled. Pi 1.1.0's agent loop sends providers
  `normalizeContext({ messages })` with tool availability declared by system messages, so the legacy `{systemPrompt, messages}`
  shorthand the two dropped tests encode is not produced by Pi 1.x; bare `modelRegistry.complete/streamSimple` calls to
  Cursor are rejected by the ownership receipt, so no extension can reach the provider with an ad-hoc tool-less context. For a
  normal turn whose active tool set is empty, the bridge snapshot is built from `pi.getActiveTools()` (empty → no Pi tool
  exposed) and native replay partitions by the declared tools (empty → inactive trace).
- **Staged runtime evidence.** Luna check: unbundled PASS (checker's own PASS text), bundled FAIL recorded. Full-extension start:
  PASS, empty stderr, 17 providers, 294 Cursor. Migration: private-dir hashes identical before, after Luna and after the full
  start (the later diff is only the intentional reduction of `auth.json` to the Cursor key). A/B: PASS, and the JSONL names
  `probe/agent` six times and carries `pi-cursor-sdk:usage-origin-v1` entries, which exist only in 0.5.x — so the probe did
  run against the candidate, not the installed adapter. Live compaction: both result files, observer logs (only
  `session_before_compact` → `session_compact` → `read` call/result) and run logs match the record; the private dirs'
  `packages` name the patched candidate by absolute path and their `auth.json` holds only `cursor`. Parity: recomputed
  294/294 (Mac) and 248/248 (mock pre-check), `composer-2.5` and `composer-latest:fast` present in both. Mock pre-check script
  touches only `/tmp/pi110-precheck`, uses the server's Node 22.22.3 and bundled entry, a Cursor-only `auth.json` copy; list
  stderr 0 bytes; A/B PASS → D1 = (a) is correctly decided by the plan's own criterion.
- **No production change.** Live Mac: Pi 0.87.1, launcher → `dist/cli.js`, adapter 0.3.10 checker PASS, all nine Phase 0
  config hashes unchanged, no production session file written by the task. `~/.pi/agent/auth.json` was rewritten at 11:29 —
  see Note N1-1: it was a production `pi -p` job, not a staged run. Evidence files contain no credential values (regex scan: the
  two hits are the usage-ledger entry names in the A/B JSONL).
- **Deviations.** D1 — see Findings/Verdict (owner decision). D2, D3, D4 — hold as described. D5 — correct call: the copied
  xai/xai-i2o tokens were minutes from expiry, a probe in the copy would have rotated the real refresh tokens; the
  full-extension start had already loaded every extension cleanly, so only the stream/refresh path waits for 3.5, which runs
  with rollback in hand. D6 — the global-layout staging matches what Phase 3.3 installs. D7 — fine, but see I1-02.

### Findings

1. **[severity: low]** I1-01 — The N1 answer overstates the isolation: the Cursor SDK still wrote per-cwd state under the
   production `~/.cursor/projects`
   - Owner requirement: Phases 0–2 "no production change"; records must say what actually happened (plan N1: "answer in the
     record rather than assume").
   - Evidence/consequence: `PI_CURSOR_SDK_STATE_ROOT` moved the adapter's SQLite session store to `probe/cursor-state` (two
     roots created there), but the SDK's own per-project directory is keyed by cwd and ignores that variable: three new
     entries appeared at 11:26–11:29 — `…pi110-cursor-053-20261011-probe-live-manual`, `…-probe-live-automatic`,
     `private-tmp-pi-ab-probe-PKHGsy` — each with `mcp-auth.json` (the user's Cursor plugin auth records, copied by the SDK as it
     does for every cwd) and the probes' synthetic agent transcripts. No existing production entry was modified; September's
     harness left eight such entries that are still there. Nothing to roll back, but the record's sentence "every Phase 2 run
     set `PI_CURSOR_SDK_STATE_ROOT`" reads as full isolation.
   - Smallest remedy: one sentence in the record stating the actual boundary (SQLite store isolated; SDK per-cwd dirs under
     `~/.cursor/projects` still written) and list the three directories in the Phase 5.6 cleanup. Whether to remove
     September's eight as well is the owner's call (not required).

2. **[severity: low]** I1-02 — Credential copies remaining in the private dirs are not all listed
   - Owner requirement: "never print or copy credential values" beyond need; plan 2.2 "credentials copied without printing,
     deleted at cleanup"; D7 "fewer credential copies".
   - Evidence/consequence: `probe/agent/auth.json` was correctly reduced to `cursor`, but `probe/agent/.vertex.json` and
     `probe/agent/.gemini-quota.json` are Google service-account files (top-level keys include `private_key`), copied with the
     agent dir and not mentioned; `probe/agent/state/pi-bootstrap.json` (0600) was not reviewed. On mock, `/tmp/pi110-precheck/agent`
     holds a Cursor-key copy plus whatever private files the server's agent dir has. All are inside 0700 directories; no
     exposure happened, but the record and the 5.6 deletion list do not name them, so cleanup could miss them.
   - Smallest remedy: name these files in the record's Phase 2 section and in the Phase 5.6 deletion list (laptop and mock),
     or delete the laptop copies now — Phase 2 is complete and Phase 3 uses the real config, so nothing still needs them.

3. **[severity: low]** I1-03 — Phase 3.1's "no Pi processes remain" is a point check; a 20-minute production `pi -p` job exists
   - Owner requirement: Phase 3 is a maintenance window in which the Pi package, launcher and `settings.json` are replaced;
     REBUILD-PROTECTION gate 6 (snapshot before/after; attribute every change).
   - Evidence/consequence: production sessions in `sessions/--Users-sudhirjha-playground-alamelu--/` are created at :08, :28 and
     :48 past every hour (pairs: `xai-i2o` then `xai`, `grok-4.6`, 7-entry sessions), including 11:08, 11:28 and 11:48 today;
     the 11:28 run refreshed the live `auth.json` at 11:29 (xai / xai-i2o `expires` now 17:24). It is not in `crontab` or
     `~/Library/LaunchAgents`, so it is a background loop the builder has not identified. During 3.3 (`npm install -g` replaces
     the package directory, then the launcher is re-pointed) and 3.4 (`pi install` rewrites `settings.json`), a run of this job
     could start on a half-installed Pi or race the settings write; a run during 3.7 changes `auth.json` and adds session files
     the snapshot comparison must attribute. The September activation ran with this cadence present and passed, so this is a
     readiness gap, not a blocker.
   - Smallest remedy: before 3.1, identify the loop (likely a tmux/background script in `~/playground/alamelu`), note it in the
     record, and either run 3.3–3.5 inside one 20-minute gap or pause it for the window (owner's call); add `auth.json`'s hash
     to the 3.1 snapshot so 3.7 can say "token refresh by the known job" rather than "may have changed".

### Notes (not findings)

- N1-1 — The live `auth.json` mtime change during Phase 2 is explained by the job in I1-03, not by any staged run: every Phase 2
  run set `PI_CODING_AGENT_DIR` to a private dir (verified in `live-compaction.py`, `full-start.py`'s caller evidence and the
  A/B JSONL), no production session file was written by the task, and the live `auth.json` key names and `cursor` keys
  (`key`, `type`) are unchanged.
- N1-2 — `e2e-export/` and `evidence/phase3/e2e-pnpm-install.log` (11:35) show Phase 3.6's clean export and `pnpm install`
  were prepared before this audit. That touches only the task workspace and is harmless; it is simply not part of this round.
- N1-3 — Full-start reported 838 models vs Phase 0's 845: RPC `get_available_models` and `--list-models` enumerate differently
  and the private dir's auth is a subset; the Cursor count (294) is what parity measures and it matches.
- N1-4 — `runtime/pi-1.1.0` (the hoisted first staging attempt) is dead weight next to `runtime/pi-1.1.0-global`; fine to leave
  for Phase 5.6.
- N1-5 — The prepare test's `ALPI_SUMMARY_PURPOSE` knob is a test-only switch with a safe default; acceptable, and useful for
  re-checking the purpose dependency after future upstream releases.
- Proportion check: the port is the smallest equivalent edit set (8 files vs September's 10), every change sits in an existing
  stock function, and no scope was added. The three findings are one-sentence record edits plus a cleanup list and a
  pre-window check.

### D1 — assessment of the builder's recommendation (owner decides)

The evidence supports not porting fix (a). Each link of the argument was verified in code and by a live run, not from the
changelog: (1) Pi 1.1.0 tags both manual and automatic compaction with the hook's signal; (2) 0.5.3 resolves purpose from that
signal and sends tagged requests to a fresh, tool-less, bridge-less, replay-less summary agent; (3) the only way a tool-less
*untagged* request could reach the provider is the legacy shorthand, which Pi 1.x's agent loop does not produce and which no
extension can inject because bare registry calls are rejected; (4) an ordinary turn with an empty active tool set exposes no Pi
tool through the bridge and routes native tools to trace; (5) the staged manual and automatic compactions produced text-only
summaries followed by a working `read` turn. The residual difference from the September rule is therefore theoretical: a
future Pi change that stops passing the hook's signal (or a third-party caller that bypasses the agent loop) would reach
0.5.3's conversation path; the ported prepare tests would not catch that, because they now assert the purpose mechanism.

If the owner keeps (a), the concrete change is the September Round-2 shape re-applied to 0.5.3: `cursor-context-tools.ts`
returns an empty set for omitted tools, `cursor-provider-turn-prepare.ts` passes `disablePiToolBridge: activeToolNames.size === 0`
and `cursor-session-agent.ts` skips `createRun` for it (3 more `src` + 3 `dist` files; patch 22 files), the two legacy tests
return (16 compaction tests), the shared upstream fixture `test/helpers/context-fixtures.ts` has to declare tools as in
September plus the ~10 expectation edits that followed, and Phases 1.5–1.6, 2.1, 2.7, 2.8 and 2.10 are rerun; that new diff
needs a further audit round before Phase 3. The owner should weigh that cost against a protection that, on Pi 1.1.0, is
already provided by upstream.

### Verdict: REVISE (pending owner decision only)

0 high, 0 medium, 3 low. All relevant verification passes (ported tests 47/47 and typecheck re-run by the critic; red/green
split reproduced on stock; dist reproducibility and the runbook rehearsal reproduced; staged-runtime evidence consistent with
the record; live Mac untouched). The round cannot be a plain PASS because the fix-(a) question is an unresolved owner decision.

- If the owner accepts the recommendation (rely on upstream for (a)): **PASS** once the three lows are folded in — they are
  record edits and cleanup-list items, and per the Plan Audit precedent low fixes need no extra review round; Phase 3 may then
  start, with I1-03's pre-window check done first.
- If the owner keeps fix (a): REVISE — port per the paragraph above, rerun the listed Phase 1–2 steps, and submit the new diff
  and evidence for Implementation Audit Round 2 before Phase 3.

---

## Response to Implementation Audit Round 1

**Builder:** Claude (Opus 5.5). **Date:** 2026-10-11

### Accepted (all three lows; record edits, cleanup and a pre-window check — no further review round needed)

1. I1-01 — Accepted. The record's N1 answer now states the real boundary: `PI_CURSOR_SDK_STATE_ROOT` moved only the
   adapter's SQLite stores; the SDK's per-cwd folders `…pi110-cursor-053-20261011-probe-live-manual`,
   `…-probe-live-automatic` and `private-tmp-pi-ab-probe-PKHGsy` were created under `~/.cursor/projects` and are on the
   5.6 cleanup list. September's eight entries are left unless the owner asks.
2. I1-02 — Accepted, fixed now rather than at 5.6: the laptop private dir's `.vertex.json`, `.gemini-quota.json` and
   `models.json` (one provider API key) and the mock copy's `auth.json`, `.vertex.json`, `models.json` and
   `auth.json.before-sudhir-codex-20260727T111941Z` were deleted (Phase 2 is complete and D1 is decided). The remaining
   Cursor-key-only `auth.json` copies (three, laptop) are listed for 5.6. `state/pi-bootstrap.json` holds bookkeeping keys only
   (`last_success`, `fingerprint`, model lists); no secret.
3. I1-03 — Accepted. The job is the owner's LLM Costs watchboard (`alamelu/quota/serve.py` → `quota/collect.py` SuperGrok
   probes `pi -p --provider xai-i2o|xai --model grok-4.6:high "what is 2+2?"` every 20 minutes). Phase 3.3–3.4 will run inside
   one gap right after a probe pair; the 3.1 snapshot adds the live `auth.json` hash. The watchboard itself is not paused or
   changed (that would be the owner's call; it is not needed).

### Notes

- N1-2: the gate 4 lane preparation and an early, non-required run of `compacted-model-switch.spec.ts` against the staged
  Pi (passed) are now recorded under "Readiness for Phase 3".
- D1 (fix a) remains the owner's decision; the critic's assessment supports the recommendation. Phase 3 waits for that
  answer and for the owner to quit Alamelu Pi.

---

## Owner Ruling — 2026-10-11 (fix (a))

Owner: "yes, drop fix (a) and go ahead."

- Fix (a) is not ported to 0.5.3; upstream's purpose-routed summary agent provides the protection on Pi 1.1.0 (D1 in the
  record; critic assessment in Implementation Audit Round 1). The 0.5.3 test assets keep 14 compaction tests.
- With the three lows folded (Response to Implementation Audit Round 1), Implementation Audit Round 1 resolves to **PASS**
  per the critic's stated condition ("PASS once the three lows are folded in"). Phase 3 starts now; Phases 3–5 get a final
  Implementation Audit round.

---

## Implementation Audit Round 2

**Reviewer:** critic (Claude Fable/high, session 5f3e28a0-2e9b-4b92-86db-eaec320fd22e)
**Date:** 2026-10-11 (12:25–12:35 AEDT)
**Scope of this round (final):** the Round 1 bookkeeping and owner ruling, Phase 3 (Mac activation), Phase 4 (servers / "sync pi"),
Phase 5 (records, kit, progress entry, memory, cleanup state and list), and whether the Round 1 lows were folded correctly.

### Outcome, scope and done criteria (restated)

Outcome: the Mac runs Pi 1.1.0 + pi-cursor-sdk 0.5.3 carrying only the two Mac fixes upstream still lacks (stale-auth recovery,
unqualified context-variant IDs; fix (a) dropped by the owner's ruling, `reasoning_effort` upstream), with Alamelu Pi's protections
intact; mock and backup run Pi 1.1.0 with stock 0.3.10 on Node 22.22.3 (D1 = (a), decided by the Phase 2.9 pre-check); everything
is recorded so it can be rebuilt, checked and rolled back. Scope: Mac Pi package/launcher, Mac adapter, the existing sync run,
servers' adapter per D1, gates and records; WSL deferred; no app source change, no Rust build, no server Node change. Done when the
nine plan criteria hold; for this round: Done 1, 2, 4, 6, 7 (Mac and servers), 8 and 9 (all but the commit, which waits for the
owner), plus the fold-in of I1-01..03 and the completeness and safety of the 5.6 cleanup list.

### What the critic verified (read-only; nothing live was changed)

- **Read in full:** global and repo rules, `REBUILD-PROTECTION.md` (current working copy and `git diff`), the plan, this audit's
  whole history including both owner rulings, the whole implementation record, `status.json`, `sync-pi.out`, the sync log for run_ids
  `20261011_121242` and `20261011_121419`, all Phase 3/4 evidence files, `phase5-verify-upgrade.log`, the alamelu `progress.md` top
  entry, the WSL memory note and the repo-memory note surfaced at session start.
- **Mac is in the recorded state.** `~/.local/bin/pi --version` = 1.1.0; the wrapper execs nvm default (v24.16.0) `bin/pi`, which is
  a symlink (11:58) to `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` while the package's own `bin` is still
  `dist/bundle/cli.js` (so the launcher rule in REBUILD-PROTECTION is right); the seven siblings nested under the Pi package (pi-ai,
  pi-agent-core, pi-tui, pi-mcp, pi-codemode, chord, pi-telemetry) are all 1.1.0, matching `installed-sibling-versions.txt`;
  `~/.pi/agent/npm/node_modules/pi-cursor-sdk` is 0.5.3 with `@cursor/sdk` 1.0.37 and `pi.extensions` = `./dist/index.js`;
  `settings.json` `packages` = `npm:pi-cursor-sdk@0.5.3`, `../../playground/pi-web-access` (only that entry differs from the rollback
  copy). Checker on the installed package: PASS "source and manifest-loaded runtime fixed"; checker without `--package`: PASS. All 16
  installed patched-file hashes equal the manifest `after` values and `status.json`; all 9 asset hashes match the tracked files.
- **Gate 1 reproduced.** The critic ran `scripts/check-pi-app-extension.py --pi /Users/sudhirjha/.local/bin/pi --extension <installed
  Luna>` (RPC, `--no-session --no-extensions`, no model): PASS; afterwards `auth.json`, `settings.json`, both Cursor cache files and
  `models-store.json` kept their earlier mtimes (12:12, 11:59, 3 Oct, 10 Oct, 12:02), so the run touched nothing.
- **Rollback (Mac).** `rollback/` holds `pi-coding-agent-0.87.1.tgz` (144 MB, 15,527 entries, `dist/` and `node_modules/` included),
  `pi-agent-npm.tgz` (13 MB, contains `npm/node_modules/pi-cursor-sdk/package.json`), `launcher-target.txt` (the `dist/cli.js`
  target), `settings.json` (packages `npm:pi-cursor-sdk@0.3.10`), `cursor-sdk-model-list.json`, `cursor-sdk-context-windows.json`
  (P1-3 folded) and `maintenance-kit-before/`. Usable as written in 3.8.
- **Phase 3 gates.** `luna-installed.txt` PASS; `checker-baseline-installed.txt` → `patch-dry-run`/`patch-apply` (16 files, no
  fuzz) → `checker-after-installed.txt` PASS; `ab-installed.summary` `pi_tools=["read"]`, `CODE=ZEBRA-4471`, `FILE=PROBE-7F3A9C-LAPTOP`,
  `pi_exit=0`, and the JSONL names `cursor/composer-2.5` and carries one `pi-cursor-sdk:usage-origin-v1` entry (0.5.x only); provider
  probes xai/xai2/xai-i2o exit 0, openai-codex exit 1 with `refresh_token_reused` in `probe-openai-codex.err` (no credential value in
  the file); parity: the 294 Cursor IDs before/after are identical by diff, `cursor-rows-diff-installed.txt` empty, `list-models-installed.err`
  empty, `composer-2.5` and `composer-latest:fast` present; OpenRouter 413 → 406 with the seven removed IDs listed in
  `openrouter-removed.txt` (none in lazydata/alamelu config per the record; the relay's `openrouter/xiaomi/mimo-v2.5-pro` is in the
  after list); gate 4 `e2e-compacted-model-switch-installed.log` 1 passed (7.7 s) against the installed Pi; `packaged-smoke.log` OK
  (49 providers, 838 models, 91 API members). Snapshot: `sessions-7d-before.txt` and `-after.txt` are byte-identical (0 of 560 owner
  session files changed); `snapshot-before.txt` includes the live `auth.json` hash (I1-03 folded); the live `cursor` entry still has
  exactly `key`, `type` (N2 folded); the provider set is unchanged.
- **openai-codex story.** Consistent end to end: stale refresh token at 3.5 (12:00) → sync adopt step "adopt openai-codex from backup"
  (12:12, `auth.json` mtime 12:12, `openai-codex` now has `access`/`accountId`/`expires`/`refresh`/`type`) → laptop preflight on Pi
  1.1.0 PASS for all four providers → both servers' smoke PASS openai-codex `gpt-5.6-luna`. Done 6's "four provider probes on the
  installed runtime" is therefore met by the preflight, as the record says.
- **Watchboard.** Handled as recorded: 3.3–3.4 ran 11:57–11:59 inside the gap after the 11:48 pair; the 12:08 pair's session files
  exist (`2026-10-11T01-08-54Z`, `01-08-59Z`), i.e. the watchboard ran on Pi 1.1.0 and completed. Not paused or changed.
- **App reopen.** `alpi-startup-debug.log` from 01:06:42Z: PATH puts the nvm Pi `dist` first; "pi-ai patch not needed for pi 1.1.0
  (fixed-upstream)"; `pi-patch-state.json` = `{piVersion 1.1.0, fixed-upstream}`; store initialized 12 workspaces, 49 providers and 838
  models each, `lastError=none`; no error/fail/warn lines after that point. The app (pid 45426), its backend (46029) and its Pi child
  (46277) are running; the critic did not touch them.
- **Phase 4 (servers, SSH read-only).** mock `e2e-95-36` and backup `e2e-94-217`: `pi --version` 1.1.0 through the wrapper; nvm-less
  `bin/pi` → `dist/bundle/cli.js` (as the servers always ran); package 1.1.0 with all seven siblings 1.1.0; adapter 0.3.10; `packages`
  unchanged (four entries); no Pi process running; `s3-relay` tmux alive on both. Sync log: both run_ids show `remote=0.87.1
  local=1.1.0` → "Updating Pi" → four smoke PASS → "Removed backups/<run_id> after passing smoke tests" → `finished status=ok
  remote_version=1.1.0 upgrade_status=updated smoke=pass`. Post-checks: `postcheck-{mock,backup}.txt` differ only in hostname/time/
  workdir; 248 Cursor IDs each, identical by diff to the Phase 0 baselines, both relay IDs present, `list_exit=0 stderr_bytes=0`, A/B
  `CODE=ZEBRA-4471` `pi_exit=0` on both. Server rollbacks present on both (`rollback/{pi-agent-npm.tgz 14 MB with the 0.3.10
  package.json, settings.json with the 0.3.10 packages, launcher-target.txt, pi-version.txt=0.87.1}`, 0700). D1 (a) outcome recorded
  correctly (no adapter change; the mock pre-check evidence copied to release evidence is byte-identical to the Phase 2 file).
- **Phase 5.** `REBUILD-PROTECTION.md` diff: header, launcher row (adds 1.1.0), adapter row (0.5.x summary agent wording), recovery
  bullets (0.5.3 patch = stale-auth + unqualified IDs; compaction/`reasoning_effort` upstream, owner ruling), "Mac runs 0.5.3 since
  2026-10-11", Node 24 for 0.4.0+, runbook and test instructions for 0.5.3 (47 = 14+29+4, `ALPI_SUMMARY_PURPOSE` note), and a dated
  2026-10-11 release section with the staging-layout lesson, server state and the WSL rule. Grep of the file finds no stale "current"
  claim; the September section is kept as history. Release evidence: 17 files + `status.json`, git-ignored (`.gitignore:9`), its
  gates/rollback/servers/wsl entries match what was verified above. `phase5-verify-upgrade.log`: 31 tests pass, recovery assets PASS,
  8 protection tests OK, "Upgrade build gate passed". Kit: 32 files; REBUILD-PROTECTION, PI-UPGRADE-WINDOWS, manifest, all 0.5.3 assets
  and the three scripts are byte-identical to the repository; `kit-manifest.json` 32 entries, 0 hash mismatches; the kit's own checker
  PASS. Progress entry (top of alamelu `progress.md`, `_Last updated: 2026-10-11_`): accurate and plain, matches the evidence (versions,
  what was patched and dropped, gates, sync, Codex login adoption, rollback paths, WSL unchanged); the file carries other sessions'
  uncommitted entries, as the record says. Memory: the session-start recall surfaces only `mem_60a5e7594386` with the new versions and
  the launcher/staging/OAuth rules; the Claude WSL note (`project_wsl_pi087_upgrade_deferred.md`, modified 2026-10-11) points to this
  plan and the Node 24 requirement. Credential copies: a name-only search of the task workspace and `/tmp/pi-ab-probe.*` for
  `auth.json*`, `.vertex.json`, `models.json`, `.gemini-quota.json`, `mcp-auth.json`, `*.pem`, `.env*` finds only the empty
  `probe/agent/auth.json.grok-provider.lock`; `probe/live-*/agent` hold only `settings.json`, `models-store.json` and the context-window
  cache; `probe/install-check` holds `settings.json` + `npm/`; mock `/tmp/pi110-precheck` likewise has only the empty lock file. A secret
  regex over `evidence/` and the release evidence returns no hits. I1-01, I1-02 and I1-03 are folded as the response says.
- **5.6 list safety.** Everything on it is staging or probe output (`dev/`, `runtime/`, `probe/agent`, `probe/live-*`,
  `probe/install-check`, `probe/cursor-state`, `e2e-export/`, the two `/tmp/pi-ab-probe.*` dirs, the servers' `/tmp/pi110-*`); nothing
  that must be kept (`evidence/`, `rollback/`, the harness scripts, the September workspace, owner sessions) is on it. Completeness:
  see I2-01.

### Findings

1. **[severity: low]** I2-01 — The 5.6 cleanup list omits four more Cursor SDK per-cwd folders created by this task's A/B probes
   - Owner requirement: plan 5.6 "delete the private credential copies and temp staging dirs created by this task"; the accepted
     I1-01 remedy (list the SDK per-cwd folders).
   - Evidence/consequence: the list names the three `~/.cursor/projects` entries from Phase 2 but not the ones the later probes made
     in the same way, each holding the SDK's `mcp-auth.json` copy plus the probe's synthetic transcript: laptop
     `~/.cursor/projects/private-tmp-pi-ab-probe-BztISu` (12:00, the Phase 3.5 installed A/B probe; its cwd `/tmp/pi-ab-probe.BztISu`
     *is* on the list); mock `~/.cursor/projects/tmp-pi-ab-probe-Rtypgm` (05:59 IST, the Phase 2.9 pre-check) and
     `tmp-pi-ab-probe-gFhrus` (06:49 IST, the Phase 4.5 post-check); backup `tmp-pi-ab-probe-1vEQLh` (06:49 IST, post-check). Same
     class as I1-01: inside the user's home, no exposure, nothing to roll back; September's similar server entries (`QpvLX0`, `XKUfDC`,
     `Hbdily`, `s3gIaU`) are still there too. Without the list entry the cleanup step will leave them.
   - Smallest remedy: add the four directories to the record's 5.6 list (laptop and per server). Whether September's server entries
     go as well is the owner's call, as in Round 1 (not required).

### Notes (not findings)

- N2-1 — `~/.pi/agent/models-store.json` (Pi's discovered-model cache, not in the Phase 0 config list) was rewritten at 12:02 by the
  Phase 3.5 `--list-models`; expected, and not a protected config file. The three session files under the alamelu cwd at 12:12 come
  from the sync script's own laptop preflight (`pi -p` per provider), and the 12:08/12:28 pairs from the watchboard; none from the
  task's probes (all `--no-session`). All post-3.7 changes to `~/.pi/agent` are therefore attributable.
- N2-2 — The servers' non-Cursor model totals rose 766 → 786 and the record says this was not investigated. Acceptable under the
  parity criterion (Cursor IDs and every relay-chain model verified present); mentioned so nobody reads it as a gap later.
- N2-3 — Commit scoping for the owner's authorization step: the alamelu-tauri working tree also carries other sessions' uncommitted
  work (`README.md`, `apps/desktop/**`, `tauri.conf.json`, the capabilities files, three other plan-audit document sets, `.poc-*`,
  `poc/`, `.codegraph/graph.db`). This task's commit is exactly: the three `pi110_cursor_053_upgrade_*.md` files,
  `maintenance/pi-cursor-sdk/manifest.json`, `maintenance/pi-cursor-sdk/0.5.3/**` and `documents/REBUILD-PROTECTION.md`; in alamelu,
  the top `progress.md` entry only (staged by hunk).
- N2-4 — The record's Done 6 wording ("four provider probes" at 3.5) and the status.json gate line both already say that openai-codex
  passed in the sync preflight rather than at 3.5; no edit needed.
- Proportion check: Phases 3–5 did exactly what the plan says and nothing more; the only extra artifacts are evidence and rollbacks.
  The single finding is a two-line edit to a list in the record.

### Verdict: PASS

0 high, 0 medium, 1 low (I2-01, a cleanup-list edit; per the established precedent low fixes need no further review round). All
relevant verification passes and was reproduced where the critic could do so without touching anything live: Luna gate re-run PASS
through the real launcher; checker PASS on the installed package; installed and asset hashes equal the manifest; Cursor parity re-diffed
(Mac 294/294, mock and backup 248/248, relay IDs present); session snapshot diff identical; sync log and post-checks consistent; both
servers on Pi 1.1.0 with stock 0.3.10 and rollbacks in place; kit byte-identical to the repository with 0 manifest mismatches;
`verify:upgrade` log green; no credential copies left beyond an empty lock file; app running on 1.1.0 with `lastError=none`. No
unresolved owner decision remains for this task. Next steps are the owner's: authorize the commit of the paths in N2-3 (and the
alamelu progress entry), then the 5.6 cleanup with I2-01's four directories added.

---

## Response to Implementation Audit Round 2

**Builder:** Claude (Opus 5.5). **Date:** 2026-10-11

- I2-01 — Accepted. The record's 5.6 list now names `~/.cursor/projects/private-tmp-pi-ab-probe-BztISu` (laptop),
  `tmp-pi-ab-probe-{Rtypgm,gFhrus}` (mock) and `tmp-pi-ab-probe-1vEQLh` (backup), plus the matching `/tmp/pi-ab-probe.*` probe dirs
  on the servers. September's older probe folders stay unless the owner asks. A list edit; no further review round.
- Notes N2-1..N2-4 accepted as written; the commit scope in N2-3 is what will be put to the owner.

Implementation lifecycle complete: final Implementation Audit PASS (Round 2). Critic session closed after PASS. Commits await the
owner's authorization.
