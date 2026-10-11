# Pi 1.1.0 + pi-cursor-sdk 0.5.3 — implementation

Owner approved the plan after Plan Audit Round 1 PASS (2026-10-11) with D1 = (a), then (b) if (a) fails, (c) only if
both fail; D2 = Pi 1.1.0 (audit "Owner Ruling — 2026-10-11"). Task workspace (0700):
`~/.pi/agent/backups/pi110-cursor-053-20261011/` — `evidence/`, `rollback/`, `dev/` (upstream clone), `runtime/`
(private npm prefixes), `probe/` (harness copy and private agent dirs). Paths below are relative to it unless absolute.

## Verification Round 1 — Phases 0–2 (no production change)

### Phase 0 — baselines (2026-10-11 05:29–05:31 IST)

- Mac (`evidence/phase0/versions.txt`): `pi --version` 0.87.1; nvm (default 24 = v24.16.0) `bin/pi` →
  `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`; adapter 0.3.10 with `@cursor/sdk` 1.0.27; all 20
  manifest-listed patched files are in the "after" state (`adapter-0.3.10-patched-hashes.txt`).
- Mac hashes (`config-hashes.txt`): `settings.json`, `models.json`, the five `extensions/*.ts`,
  `cursor-sdk-model-list.json`, `cursor-sdk-context-windows.json`; installed app Luna extension (`luna-hash.txt`,
  `819e49d9…`). `auth.json` `cursor` entry key names: `key`, `type` (`auth-cursor-keys.txt`, no values).
- Mac models (`list-models-full.txt`, stdin `/dev/null`): 845 models, 294 Cursor IDs (`cursor-model-ids-before.txt`)
  including `composer-2.5` and `composer-latest:fast`. Re-hash after listing: unchanged.
- Servers (`server-{mock,backup}.txt`, SSH): both Pi 0.87.1 via the `~/.local/bin/pi` wrapper →
  `~/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pi` → `dist/bundle/cli.js` (`current` symlink → the same Node);
  Node v22.22.3; stock adapter 0.3.10 with `@cursor/sdk` 1.0.27; `packages` = `npm:pi-cursor-sdk@0.3.10`,
  `npm:pi-nvidia-nim`, `npm:pi-extension-nvidia-nim`, `../../playground/pi-web-access`; `npmCommand` =
  `[…/node-v22.22.3-linux-x64/bin/npm]`; `cursor` key names `key`, `type`; 766 models, 248 Cursor IDs each
  (`cursor-model-ids-before-{mock,backup}.txt`), relay IDs present. Running Pi processes: none on mock; two on backup
  (`timeout 2700 pi -p --no-session --provider cursor --model grok-4.7@256k --tools web_search,…`, 20–30 min old) —
  reported only; Phase 4 checks for running Pi jobs before touching a server.
- npm (`npm-latest.txt`): `@earendil-works/pi-coding-agent` latest 1.1.0 (engines `>=22.19.0`, siblings `^1.1.0`);
  `pi-cursor-sdk` latest 0.5.3 (engines `>=24`, `@cursor/sdk` 1.0.37); 0.3.10 engines `>=22.19.0`.
- September harness copied to `probe/` (`ab-probe.sh`, `parse.py`, `live-compaction.py`, `observer.ts`).

### Phase 1 — port in the upstream clone (`dev/pi-cursor-sdk`, Node v24.16.0)

- `git clone --branch v0.5.3` (tag object `4245615c` → commit `fa82450f`); `src/`, `shared/`, `package.json`
  byte-identical to the npm tarball; `npm ci` from the repo lockfile (dev Pi 1.0.4, `@cursor/sdk` 1.0.37).
- Untouched-tag baseline (`evidence/phase1/`): `npm run build` reproduces all 124 published `dist/` files byte-for-byte;
  `npm run typecheck` PASS; `vitest run` 154 files passed + 1 skipped, 1790 tests passed + 5 skipped.
- The 49 ported 0.3.10 tests were copied into `test/` and adapted only where 0.5.3 moved the API: prepare/runner
  params now carry `scope`, `request` (purpose) and `usageRecorder` (upstream helper `captureProviderTestOwnership` /
  `createProviderTestTurnUsage`); fixtures gain `execution: "conversation"` and `storeIdentity`; the bridge stub gains
  `onPendingToolCallsChanged`; the finalize mock gains `recordCursorProviderTerminalUsage`; the pre-send drain takes a
  scope key; summary prepare requests are flagged `purpose: "compaction"` (how Pi 1.x calls them; see D1). Full diff
  against the 0.3.10 assets: `evidence/phase1/ported-test-adaptations.diff`.
- Red/green on **stock** 0.5.3 (`red-stock-adapted.log`, then `red-stock-final.log` for the final 47):
  - (a) compaction — covered upstream. The 6 prepare tests pass when summaries carry Pi's compaction purpose (0.5.x runs
    LOCAL compaction/tree summaries in a separate agent with `tools: []`, no MCP bridge, no native replay, no pooling);
    with purpose `normal` 5 fail (`a-prepare-normal-purpose.log`) because 0.5.3 attaches the bridge to any ordinary
    request. 8 of 10 routing tests pass; the 2 failing ones use the legacy `{ systemPrompt, messages }` shorthand without
    tools, which Pi 1.x no longer sends to providers (they receive normalized transcript contexts). Not ported — D1.
  - (b) stale-auth recovery — still needed: 24 of 29 fail on stock (no recreate path; upstream says #247 stays open).
  - (c) model variants — unqualified IDs still needed (2 fail); `reasoning_effort` covered upstream (0.5.x has its own
    `parameterIds.reasoning_effort`, thinking map and outbound key; the one assertion on the Mac's merged `effort` flag
    now checks upstream's flag — D2).
- Port — 8 source files, small edits to 0.5.3's existing functions, no new files
  (`maintenance/pi-cursor-sdk/0.5.3/mac-local-fixes.patch`, 1265 lines, 8 `src` + 8 `dist`):
  - (b) `cursor-provider-errors.ts` (exported messages, in-band auth codes, `isRetryableStaleCursorAuthFailure`),
    `cursor-live-run-coordinator.ts` (`authRecreate`, `markAuthRecreate`, `isReady`), `cursor-provider-live-run-drain.ts`
    (`auth_recreate` outcome, pre-send release, `hasEmittedProgress` / `shouldAttemptAuthRecreate` /
    `teardownFailedAuthAttempt`), `cursor-provider-turn-emit.ts` (returns the drain outcome),
    `cursor-provider-run-finalizer.ts` (`markAuthRecreate` before progress; an abort still wins),
    `cursor-provider-turn-prepare.ts` (`forceCreate` on the primary local acquire), `cursor-provider-turn-runner.ts`
    (one retry loop — D3). These are the 0.3.10 Mac edits carried over by a 3-way merge (base stock 0.3.10, Mac 0.3.10,
    stock 0.5.3); conflicts resolved by keeping upstream's new text (message wording, abort handling, usage start).
  - (c) `model-discovery.ts`: after each context-variant selection's qualified IDs, the unqualified ID at 256k (else the
    first context), written to 0.5.3's `metadataMap` parameter.
- Result: ported tests 47/47; `npm run typecheck` 0 errors; full suite 161 files passed + 1 skipped, 1837 tests passed
  + 5 skipped (baseline 1790 + 47). Built `dist/` differs from the published one only in the 8 modules built from the 8
  changed sources (`dist-ported-diff.txt`).
- Upstream test adaptations (4 files, `upstream-test-adaptations.diff`): model-discovery (5 expectations) and
  model-snapshot-context (1) gain the unqualified IDs; run-finalizer passes `hasEmittedProgress: () => false`; stream-auth:
  the rejected-key test lets both attempts fail (one retry, as in September), and the two `run.wait` ConnectError tests
  use a session that already holds the user message (D3 note on the usage ledger).
- Recovery assets (alamelu-tauri): `0.5.3/mac-local-fixes.patch`, `0.5.3/test/` (8 files, 47 tests: 14 compaction,
  29 stale-auth, 4 model-variant), manifest `"0.5.3"` (entry `dist/index.js`, 16 files, 9 assets). Runbook rehearsal on a
  fresh stock copy: `--baseline` PASS → `patch --dry-run` 16 files → `patch` exit 0, no fuzz/offset → result identical
  to the ported layout. Checker unchanged; `check-cursor-compaction.py` assets PASS; installed Mac 0.3.10 still PASS;
  `test-upgrade-protection.py` 8 tests OK.

### Phase 2 — staged runtime (no production change)

- Pi 1.1.0 staged with the production global layout: `npm install -g --prefix runtime/pi-1.1.0-global` (Node v24.16.0);
  siblings pi-ai, pi-agent-core, pi-tui, pi-mcp, pi-codemode, chord all 1.1.0 (`staged-sibling-versions.txt`); npm's bin
  link → `dist/bundle/cli.js` (so activation must re-point the launcher, as before).
- Private agent dir `probe/agent` (0700): `~/.pi/agent` copied without `backups/`, `sessions/`, `npm/`, old `*.bak*` /
  `*.backup*` files, `.codegraph/` and `manual-extension-backups/` (D7); `npm/` = fresh `pi-cursor-sdk@0.5.3` (`@cursor/sdk`
  1.0.37) + the patch (`--baseline` PASS → patch, no fuzz → checker PASS); `packages` = `npm:pi-cursor-sdk@0.5.3`,
  `/Users/sudhirjha/playground/pi-web-access`. N1 answer: the Cursor SDK's default local store is `~/.cursor/projects`
  (outside the agent dir, shared with production), so every Phase 2 run set `PI_CURSOR_SDK_STATE_ROOT=probe/cursor-state`;
  `--no-session` runs use temporary stores anyway. That variable moves only the adapter's SQLite session stores (two roots
  under `probe/cursor-state`); the SDK still created its per-cwd folder under `~/.cursor/projects` for each probe cwd —
  `Users-sudhirjha-pi-agent-backups-pi110-cursor-053-20261011-probe-live-manual`, `…-probe-live-automatic` and
  `private-tmp-pi-ab-probe-PKHGsy` (11:26–11:27), each holding the SDK's copy of the Cursor plugin auth (`mcp-auth.json`) and
  the probes' synthetic transcripts. No existing production entry changed; the three are on the Phase 5.6 cleanup list
  (audit I1-01). September's eight similar entries are left as they are unless the owner asks.
- Credential copies (audit I1-02): the private dir also received `.vertex.json` and `.gemini-quota.json` (Google service
  accounts) and `models.json` (holds one provider API key); none was needed for the Cursor-only checks, and all three were
  deleted after Phase 2. The mock pre-check copy (`/tmp/pi110-precheck/agent`) had its `auth.json`, `.vertex.json`,
  `models.json` and an old `auth.json.before-sudhir-codex-20260727T111941Z` (the rsync exclude did not match that name)
  deleted the same way. Remaining copies, all Cursor-key-only `auth.json` files inside 0700 dirs, are deleted at 5.6:
  `probe/agent/auth.json`, `probe/live-manual/agent/auth.json`, `probe/live-automatic/agent/auth.json`.
- 2.3 Luna check: staged unbundled `dist/cli.js` **PASS**; bundled `dist/bundle/cli.js` FAIL (recorded; as with 0.85.1
  and 0.87.1). D6: a first staging with `npm install --prefix` (hoisted siblings) failed the Luna check because the Luna
  extension looks for pi-ai nested under the Pi package, which only the global layout provides.
- 2.4 Full-extension start (`probe/full-start.py`: RPC `get_state` ×2 + `get_available_models`, real extensions and
  packages + Luna): PASS, empty stderr, 838 models from 17 providers, 294 Cursor.
- 2.5 Migration check: private-dir hashes identical before and after the first starts — Pi 1.1.0 rewrote nothing.
- 2.6 Provider probes — **not run on the copy (D5)**: the copied OAuth logins were expiring (xai, xai-i2o in 3 minutes)
  or expired (xai2, openai-codex), so a probe would refresh them inside the copy and rotate their refresh tokens,
  breaking the production logins. After 2.4 (which changed no file) the private `auth.json` was reduced to the Cursor key.
  The four provider probes run on the installed runtime with the real `auth.json` in Phase 3.5, as planned there.
- 2.7 A/B probe: Pi `read` executed, `CODE=ZEBRA-4471`, correct file — PASS (`ab-1.1.0-candidate.*`).
- 2.8 Live compaction (`probe/live-compaction.py`, `cursor/grok-4.6:fast`, window 256000, synthetic filler, private
  workdirs whose `packages` name the patched candidate by absolute path):
  - manual — `manual` compaction, 1776-char summary; observer shows nothing between `session_before_compact` and
    `session_compact`; then a Pi `read` turn → `COMPACTION_FIXTURE_OK`. PASS.
  - automatic — private reserve 253500, keepRecent 1000; `threshold` compaction, 564-char summary; nothing between the
    two compaction events; `AUTO_COMPACTION_OK`; then a `read` turn → `COMPACTION_FIXTURE_OK`. PASS.
  - This is the live proof for D1: summaries stay text-only without the 0.3.x empty-tools rule.
- 2.9 D1(a) pre-check on mock (`/tmp/pi110-precheck`, nothing else touched): Pi 1.1.0 global-style install with the
  server's Node 22.22.3, run through the bundled entry the servers use; private copy of the server agent dir with stock
  0.3.10 + its NIM packages + `pi-web-access`, Cursor-only `auth.json`. `--list-models`: empty stderr, 248 Cursor IDs
  = mock baseline (0 missing, 0 new), `composer-2.5` and `composer-latest:fast` listed; A/B probe PASS. **D1 = (a)**:
  servers keep stock 0.3.10 under Pi 1.1.0; (b) is not needed.
- 2.10 Model parity, staged Mac runtime vs Phase 0: 294/294 Cursor IDs, 0 missing, 0 new; the normalized Cursor rows
  (context, max-out, thinking, images) are identical, so the unqualified IDs keep their context windows.

### Deviations from the approved plan (for the Implementation Audit)

- D1 — Fix (a) (compaction: omitted/empty tools → no Pi bridge, inactive native replay) is **not ported**: 0.5.x covers the
  requirement by request purpose (above); the only stock failures are the legacy-shorthand cases Pi 1.x does not produce,
  and they are dropped from the 0.5.3 test copy with a comment. This triggered the plan's stop condition ("a red test
  encodes behavior 0.5.3 deliberately changed"), so the builder asked the owner (2026-10-11) with the recommendation
  to rely on upstream if the live compaction gate passes (it did, 2.8). **Owner ruling 2026-10-11: "yes, drop fix (a)
  and go ahead."**
- D2 — Fix (c)'s `reasoning_effort` half is upstream; one ported assertion now checks `parameterIds.reasoning_effort`.
- D3 — Runner shape. 0.5.3's runner gained a per-attempt usage ledger (`usageRecorder.start`) and purpose routing. The
  port wraps prepare → usage start → send → live/direct in one loop for every runtime, with recreate allowed only for
  local `normal`-purpose (conversation) turns, instead of the Mac's separate cloud branch; summary and cloud turns run the
  loop body exactly once (stock behavior). On the catch path a started first attempt records its terminal usage as
  `error` before teardown (guarded against double recording); the retry makes its own usage claim, which needs the
  session's anchor entry — Pi persists the user message before the provider call (pi-agent-core awaits listeners), so
  real sessions have it; the two upstream stream-auth tests got that anchor.
- D4 — Upstream test edits are expectation/fixture adaptations only (4 files, 34+/10−); no production type was weakened.
- D5 — Phase 2.6 moved to Phase 3.5 (token-rotation risk, above).
- D6 — Staging layout (above).
- D7 — Private agent dir also leaves out old backup files (fewer credential copies).

### Readiness for Phase 3 (audit I1-03)

- The 20-minute production Pi job is the owner's LLM Costs watchboard on the laptop (`alamelu/quota/serve.py`, PID 4404,
  127.0.0.1:8899, up 16 days): each collection runs `quota/collect.py`, whose SuperGrok row probes the `xai-i2o` and `xai`
  logins with `pi -p --provider <login> --model grok-4.6:high "what is 2+2?"` (stdin closed, 180 s timeout) at :08, :28 and
  :48 past the hour; the 11:28 pair refreshed the live `auth.json` at 11:29. It uses `pi` from PATH or `~/.pi/agent/bin/pi`.
- Phase 3 handling, with no change to the watchboard: run 3.3–3.4 (`npm install -g`, launcher re-point, `pi install`, patch;
  about two minutes) right after a probe pair finishes, inside one 20-minute gap, and take the 3.1 snapshot including the
  live `auth.json` hash, so 3.7 can attribute a refresh to this job by its session files (cwd `alamelu`, prompt
  "what is 2+2?"). If a probe overlaps anyway, the watchboard shows one red meter for one cycle; nothing else depends on it.
- Unrelated work seen on the servers (reported, not touched): another session runs `poshyo-audit/run_auditor.sh grok 2700`
  over SSH on the backup server (Cursor `grok-4.7@256k`, up to 45 minutes per run). Phase 4 checks for running Pi jobs on each
  server right before the sync and asks the owner if one is active.
- Gate 4 lane prepared ahead (task workspace only): clean `git archive 0d23cb9` export, `pnpm install --frozen-lockfile`,
  the cached `electron-v39.8.10-darwin-arm64.zip` matched Electron's pinned `checksums.json` and was extracted with `ditto`
  (as in September), desktop build OK. As an early signal, `compacted-model-switch.spec.ts` with
  `PI_GUI_PI_BIN=<staged 1.1.0 dist/cli.js>` passed (1 passed, 11.8 s; the spec seeds its own agent dir with a test key).
  The required run against the installed Pi stays in Phase 3.6.

## Deployment Round 1 — Mac activation (Phase 3), after Implementation Audit Round 1 PASS and the owner's fix-(a) ruling

- 3.1 (11:57 AEDT) Alamelu Pi not running (`pgrep -x alamelu-pi-tauri` empty), no Pi processes. Snapshot
  (`evidence/phase3/snapshot-before.txt`): the Phase 0 config list (unchanged since Phase 0), live `auth.json`, Luna; 560 owner
  session files touched in 7 days hashed (`sessions-7d-before.txt`).
- 3.2 Rollback (`rollback/`): `pi-coding-agent-0.87.1.tgz` (package dir), `launcher-target.txt`
  (`../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`), `pi-agent-npm.tgz` (adapter 0.3.10 + deps),
  `settings.json`, `cursor-sdk-model-list.json`, `cursor-sdk-context-windows.json`.
- 3.3 (11:57–11:59, inside the watchboard gap) `npm install -g @earendil-works/pi-coding-agent@1.1.0` (Node v24.16.0, 56 s):
  npm reset nvm `bin/pi` to `dist/bundle/cli.js`; re-pointed to `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`;
  `~/.local/bin/pi --version` = 1.1.0. Luna check through `/Users/sudhirjha/.local/bin/pi`: **PASS** (Done 1). Resolved siblings
  (Pi 1.0.1+ is unpinned): pi-ai, pi-agent-core, pi-tui, pi-mcp, pi-codemode, chord, pi-telemetry all 1.1.0
  (`installed-sibling-versions.txt`). No agent file changed.
- 3.4 Private copy first: `pi install npm:pi-cursor-sdk@0.5.3` replaced `npm:pi-cursor-sdk@0.3.10` in place, only `packages`
  differed. Real install (11:59): same — `packages` = `npm:pi-cursor-sdk@0.5.3`, `../../playground/pi-web-access`; adapter 0.5.3,
  `@cursor/sdk` 1.0.37. Checker `--baseline` PASS → `patch --dry-run` and `patch`, 16 files, no fuzz/offset → checker
  **PASS** "source and manifest-loaded runtime fixed" (Done 2).
- 3.5 Installed gates (real config):
  - A/B probe (`--no-session`, `--tools read`, `cursor/composer-2.5`): Pi `read` executed, `CODE=ZEBRA-4471`, correct file —
    **PASS** (`ab-installed.*`, Done 4).
  - Provider probes (`--no-session`, stdin closed; `provider-probes.txt`): xai, xai2, xai-i2o (`grok-4.5:high`) answer `4`;
    **openai-codex (`gpt-5.6-luna:high`) FAILED at the token endpoint**: "refresh token has already been used"
    (`refresh_token_reused`). Cause, not the upgrade: the laptop and mock copies of that login expired about 7 hours earlier and
    the backup server renewed it at 04:52 IST (its copy is valid for about 10 days), which retired the shared refresh token.
    `server_pi_maintenance.sh`'s adopt step ranks the laptop, mock and backup copies and adopts the first that works, and its
    laptop preflight probes openai-codex with Pi 1.1.0 before touching any server, so Phase 4 closes this check.
  - Model parity (`list-models-installed.txt`, empty stderr): Cursor 294/294, 0 missing, 0 new, normalized rows identical
    (Done 7, Mac). Other providers: the same counts except OpenRouter 413 → 406 — Pi 1.1.0's built-in catalog dropped
    `anthropic/claude-3-haiku`, `inclusionai/ling-3.0-flash-fin:free`, `inclusionai/ling-3.0-flash-vl:free`,
    `kwaipilot/kat-coder-pro-v2.5`, `nex-agi/nex-n2.5-mini:free`, `nex-agi/nex-n2.5-pro:free`, `qwen/qwen3.8-27b:free`; none is
    referenced in lazydata/alamelu scripts or config or the Pi settings/models files; the relay chain's
    `openrouter/xiaomi/mimo-v2.5-pro` is still listed.
- 3.6 Gate 4 (export of `0d23cb9`): `compacted-model-switch.spec.ts` with `PI_GUI_PI_BIN=<installed 1.1.0 dist/cli.js>`,
  `PI_GUI_DRIVER=rpc`, `PI_GUI_BRAND=alpi`: **1 passed** (7.7 s). `ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app'`
  packaged smoke: **OK (49 providers, 838 models, 91 API members)** (Done 6, first half).
- 3.7 Snapshot re-check (12:02): changed — `settings.json` (the one `packages` entry) and `auth.json` (token refresh: the xai2
  probe renewed that expired login; the provider set and the `cursor` key names `key`, `type` are unchanged); unchanged —
  `models.json`, the five extensions, both Cursor cache files, Luna; 0 of 560 owner session files changed, no new session file
  (all probes used `--no-session`).
- 3.7 (cont.) The owner reopened Alamelu Pi himself at 12:06 (normal launch; avoids September's D6). `alpi-startup-debug.log`:
  PATH puts the nvm Pi `dist` first; "pi-ai patch not needed for pi 1.1.0 (fixed-upstream)" (`pi-patch-state.json` now
  piVersion 1.1.0); store initialized with 12 workspaces, every workspace **49 providers, 838 models** (= the packaged smoke),
  `lastError=none`; the backend (`node …/backend/main.cjs`) has its Pi child running. The watchboard's 12:08 probes ran on Pi
  1.1.0 and answered (xai-i2o "2 + 2 = 4", xai "4") (Done 6, second half).

## Deployment Round 2 — servers (Phase 4), Sunday 06:34–06:50 IST (not a trading day)

- 4.1 Both servers before the sync: Pi 0.87.1 (wrapper → Node 22.22.3 → `dist/bundle/cli.js`), stock adapter 0.3.10, no Pi
  process running (the backup server's `poshyo-audit` run had ended). Rollback on each:
  `~/.pi/agent/backups/pi110-cursor-053-20261011/rollback/{pi-agent-npm.tgz,settings.json,launcher-target.txt,pi-version.txt}`;
  Pi itself rolls back by reinstalling 0.87.1 with the server's npm.
- 4.2 D1 = (a): no adapter change on the servers.
- 4.3 npm `latest` still 1.1.0 (checked 12:04 AEDT).
- 4.4 `bash scripts/server_pi_maintenance.sh < /dev/null` (alamelu, laptop), started 12:10 AEDT after the watchboard's 12:08
  probes, exit 0, `PI ALL SERVERS PASS` (`evidence/phase4/sync-pi.out`; `alamelu/logs/server_pi_maintenance.log` run_ids
  `20261011_121242` mock, `20261011_121419` backup):
  - adopt: `PASS xAI credentials match on laptop, mock, backup and Hermes`, this run's xAI backups removed;
    **`adopt openai-codex from backup`** — the laptop's stale Codex login (Phase 3.5) was replaced by the backup server's
    working one.
  - laptop preflight on Pi 1.1.0: PASS xai, xai2, xai-i2o, **openai-codex** — this closes the Phase 3.5 provider probe that the
    stale login had blocked (all four provider probes now pass on the installed Mac runtime).
  - mock and backup: "Updating Pi … remote=0.87.1 local=1.1.0" with the server's own npm (Node 22.22.3); smoke xai, xai2,
    xai-i2o (`grok-4.5`) and openai-codex (`gpt-5.6-luna`) PASS; "Removed backups/<run_id> after passing smoke tests";
    `finished status=ok remote_version=1.1.0 upgrade_status=updated smoke=pass` on both.
- 4.5 After the sync (`postcheck-{mock,backup}.txt`, real config, `server-postcheck.sh`): both servers Pi 1.1.0 via
  `dist/bundle/cli.js`, siblings 1.1.0, adapter 0.3.10, `packages` unchanged; `--list-models` empty stderr, 786 models,
  Cursor 248/248 against Phase 0 (0 missing, 0 new), `composer-2.5` and `composer-latest:fast` listed; A/B probe **PASS** on
  both (Pi `read`, `CODE=ZEBRA-4471`, correct file) (Done 7 servers, Done 8). Every Pi model of the relay poller's fallback
  chain is listed on both servers: openai-codex/gpt-5.5, zai/glm-5.2, deepseek/deepseek-v4-pro, deepseek/deepseek-v4-flash,
  cursor/composer-2.5, cursor/composer-latest:fast, xai/grok-4.3, openrouter/xiaomi/mimo-v2.5-pro. (Non-Cursor totals went
  from 766 to 786; the cause was not investigated — not part of the parity criterion, and no relay or readiness model is
  missing.)

## Records and cleanup (Phase 5)

- 5.1 `documents/REBUILD-PROTECTION.md`: last verified release Mac 2026-10-11 (Pi 1.1.0 + pi-cursor-sdk 0.5.3, `dist/index.js`),
  launcher row now includes 1.1.0, adapter row and recovery section cover `0.5.3/mac-local-fixes.patch` (stale-auth + unqualified
  IDs; compaction and `reasoning_effort` upstream), 47-test note, Node 24 note for 0.4.0+, new dated release section (gates,
  staging layout lesson, servers on Pi 1.1.0 + stock 0.3.10 on Node 22.22.3, WSL pending). Release evidence (git-ignored):
  `documents/release-evidence/pi110-mac-20261011/` — `status.json` (gate results, rollback locations, the 16 installed patched-file
  hashes, all equal to the manifest's `after`) plus the A/B, e2e, packaged-smoke, provider-probe, parity, live-compaction,
  server pre/post-check, sync and test-adaptation files (17 files). `pnpm run verify:upgrade` in the clean `0d23cb9` export with
  this task's manifest, `0.5.3/` assets and REBUILD-PROTECTION overlaid: 31 tests pass, recovery assets PASS, 8 protection tests
  OK, "Upgrade build gate passed" (`evidence/phase5-verify-upgrade.log`).
- 5.2 Mac kit (`~/Library/Application Support/Alamelu Pi/maintenance-kit`; old kit kept in `rollback/maintenance-kit-before`):
  REBUILD-PROTECTION, manifest and `0.5.3/` copied; `kit-manifest.json` regenerated, 32 entries (was 23), no mismatch against the
  repository; the kit's checker passes its assets and the installed adapter; its protection tests OK.
- 5.3 alamelu `documents/progress.md`: "11 October 2026 — Pi 1.1.0 on the Mac (Cursor adapter 0.5.3) and on both servers" added at
  the top, `_Last updated: 2026-10-11_`. The file also holds other sessions' uncommitted entries (2 Oct, 1 Oct, 27 Sep MiniMax);
  only this entry would be staged.
- 5.4 Commits: none yet — after the final audit, with the owner's authorization; other sessions' unpushed commits are checked
  before any push.
- 5.5 Memory: repo-memory note `mem_60a5e7594386` (global, active) replaces `mem_1acba792a055` (retracted) with the new versions,
  the 1.1.0 launcher rule, the staging-layout rule and "never run OAuth probes against a copied auth.json"; the Claude
  project note on the deferred WSL upgrade points to this plan and the Node 24 requirement.
- 5.6 Credential copies: all gone — the three Cursor-key-only `auth.json` copies were deleted after Phase 4 (the service-account
  files, `models.json` and the mock copies earlier, audit I1-02); only an empty `auth.json.grok-provider.lock` remains in
  `probe/agent`. Staging to remove after the final audit (moved to Trash as in September, not hard-deleted): laptop task
  workspace `dev/` (574 MB), `runtime/` (318 MB), `probe/agent`, `probe/live-*`, `probe/install-check`, `probe/cursor-state`,
  `e2e-export/` (815 MB), `/tmp/pi-ab-probe.{PKHGsy,BztISu}`, the three `~/.cursor/projects` entries from audit I1-01 and
  `~/.cursor/projects/private-tmp-pi-ab-probe-BztISu` (audit I2-01); mock `/tmp/pi110-precheck` (staged Pi and agent copy, no
  credentials left), `/tmp/pi110-post.ojA60j`, `/tmp/pi-ab-probe.{Rtypgm,gFhrus}` and `~/.cursor/projects/tmp-pi-ab-probe-{Rtypgm,gFhrus}`;
  backup `/tmp/pi110-precheck` (probe files), `/tmp/pi110-post.aktQ44`, `/tmp/pi-ab-probe.1vEQLh` and
  `~/.cursor/projects/tmp-pi-ab-probe-1vEQLh`. September's older probe folders are left unless the owner asks. Kept: `evidence/`, `rollback/` (Mac and servers), and the
  harness (`probe/ab-probe.sh`, `parse.py`, `live-compaction.py`, `observer.ts`, `full-start.py`, `server-precheck.sh`,
  `server-postcheck.sh`).

## Done-criteria status

1 PASS (3.3/3.5 Luna through the real launcher) · 2 PASS (3.4 checker on the 0.5.3 manifest entry) · 3 PASS (47/47; stock split
recorded; fixes green on stock not ported) · 4 PASS (A/B on the installed Mac runtime) · 5 PASS (2.8 manual and automatic,
candidate identical to the installed patch) · 6 PASS (3.6 e2e + packaged smoke; 3.7 reopened app, no extension-load failure) ·
7 PASS (Mac 294/294; mock and backup 248/248; relay IDs present) · 8 PASS (sync pi PASS; both servers Pi 1.1.0; A/B and relay IDs
on both) · 9 PASS except commits (assets, manifest, REBUILD-PROTECTION, evidence, kit, progress entry, rollbacks; commit awaits
the owner).

## Cleanup done (after Implementation Audit Round 2 PASS)

- Laptop: the 5.6 items were moved (not hard-deleted) to `~/.Trash/pi110-cleanup-20261011/` (2.0 GB: `workspace/{dev,runtime,
  e2e-export,probe-agent,probe-live-manual,probe-live-automatic,probe-install-check,probe-cursor-state}`, `tmp/pi-ab-probe.*`,
  `cursor-projects/` with the four probe folders). The task workspace now holds only `evidence/`, `rollback/` and the harness
  scripts in `probe/` (159 MB).
- Mock and backup: `/tmp/pi110-precheck`, `/tmp/pi110-post.*`, `/tmp/pi-ab-probe.*` and the probe folders under `~/.cursor/projects`
  moved to `~/.local/share/Trash/files/pi110-cleanup-20261011/` (mock 247 MB, backup 192 KB); no task dir left in `/tmp`.
  Rollbacks stay in `~/.pi/agent/backups/pi110-cursor-053-20261011/rollback/` on each server.
- Final Implementation Audit: Round 2 PASS (0 high, 0 medium, 1 low I2-01, folded).
- Commits, with the owner's authorization ("can you commit? yes to both"): alamelu-tauri `1f8cfef` (this task's 14 files only:
  the three records, REBUILD-PROTECTION, the manifest and `0.5.3/`), pushed; alamelu `86695d8` (only this task's
  `progress.md` entry; other sessions' uncommitted entries left unstaged), pushed, and mock fast-forwarded with
  `git pull --ff-only` (tree `84fab838` on both sides; mock's own uncommitted files untouched).
