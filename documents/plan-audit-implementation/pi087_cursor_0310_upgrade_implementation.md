# Pi 0.87.1 + pi-cursor-sdk 0.3.10 — implementation

Owner approved the plan after Plan Audit Round 2 PASS (2026-09-23) and quit Alamelu Pi. Task workspace (0700):
`~/.pi/agent/backups/pi087-cursor-0310-20260923/` — `evidence/`, `dev/` (upstream clone), `runtime/` (private npm
prefix), `probe/` (A/B probe, live-compaction harness, private agent dirs). Verification Round 1 made **no production
change**: installed Pi, adapter, settings and the app are untouched.

## Verification Round 1 — Phases 0–2 (no production change)

### Phase 0 — baselines

- Installed: Pi 0.85.1, nvm `bin/pi` → `dist/cli.js`; adapter 0.1.60. Hashes: `evidence/phase0/config-hashes.txt`
  (settings, models, extensions), `luna-hash.txt`, `adapter-0.1.60-hashes.txt` (109 files).
- Cursor model IDs before upgrade: 288 (`evidence/phase0/cursor-model-ids-before.txt`), including
  `claude-opus-5-5@1m`, `claude-opus-5-5@300k`, `composer-2.5`, `composer-latest:fast`.
- A/B probe saved as `probe/ab-probe.sh` + `probe/parse.py` (PASS needs Pi `read` executed, `CODE=ZEBRA-4471`,
  correct file). Self-test on the saved runs: installed 0.85.1 PASS; staged 0.87.1 + adapter 0.1.60 FAIL.

### Phase 1 — port in the upstream clone

- `git clone --branch v0.3.10` = `8a5c0aa5`; `src/` and `shared/` byte-identical to the npm tarball; `npm ci` from the
  repo lockfile (386 packages, Node v24.16.0).
- Untouched-tag baseline: `npm run build` reproduces all 114 published `dist/` files byte-for-byte; `npm run typecheck`
  PASS; `vitest run` 132 files passed + 1 skipped, 1495 tests passed + 5 skipped.
- Tests brought in: the 0.3.6 maintenance compaction tests (2 files, 14 tests) and fixture helper; the four stale-auth
  files from the 0.1.60 checkout (29 tests); new `test/cursor-model-variants.test.ts` (4 tests). The model-variant test
  passes 4/4 against the installed Mac `model-discovery.ts` (SHA `0469519c…`) in a temporary copy of the 0.1.60 checkout.
- Red on stock 0.3.10: 33 failed / 14 passed of 47. Passing on stock: the 8 compaction routing tests, 1 prepare test and
  5 stale-auth tests that exercise unchanged code paths.
- Port — 9 source files, all present in stock 0.3.10 (full diff: `maintenance/pi-cursor-sdk/0.3.10/mac-local-fixes.patch`):
  - (a) compaction, bridge half: `cursor-provider-turn-prepare.ts` computes the request tool set before acquire and passes
    `disablePiToolBridge: (activeToolNames?.size ?? 0) === 0`; `cursor-session-agent.ts` skips bridge creation for that
    call. The routing half is not ported — see D2.
  - (b) stale-auth: `cursor-provider-errors.ts` (exported messages, `isRetryableStaleCursorAuthFailure`),
    `cursor-live-run-coordinator.ts` (`authRecreate`, `markAuthRecreate`, `isReady`), `cursor-provider-live-run-drain.ts`
    (`auth_recreate` outcome, pre-send release, the three helpers — see D1), `cursor-provider-turn-emit.ts` (returns the
    drain outcome), `cursor-provider-run-finalizer.ts` (`markAuthRecreate` on a retryable auth failure before progress),
    `cursor-provider-turn-prepare.ts` (`forceCreate`), `cursor-provider-turn-runner.ts` — 3-way merge (base stock 0.1.60,
    Mac, stock 0.3.10): upstream's four `runtimeTarget` hunks merged cleanly; one conflict resolved by keeping both the
    upstream `runtimeTarget` assignment and the Mac `isLocal` split (`evidence/phase1/merge-turn-runner/`).
  - (c) model variants: `model-discovery.ts` — `reasoning_effort` accepted for the thinking map, the effort capability
    flag and the outbound key; after each context-variant selectable ID's qualified IDs, an unqualified ID at 256k
    (else the first context) with the 0.1.60 single-key context-window lookup.
- Ported tests: compaction 14/14, stale-auth 29/29, model-variant 4/4.
- Full checks on the port: build PASS; built `dist/` differs from the published one only in the 9 modules built from
  the 9 changed sources; typecheck FAIL — *corrected in Round 2 (I1-02):* five diagnostics in four files, three of them
  ported test files (`auth-recreate-fixtures.ts:115`, `cursor-compaction.test.ts:21,33`,
  `cursor-provider-run-finalizer-auth-recreate.test.ts:26`) and one upstream fixture
  (`cursor-provider-run-finalizer.test.ts:114`), not "one upstream test"; suite: 24 upstream tests fail in 11 files,
  1518 pass, 5 skipped (`evidence/phase1/test-ported.log`).
- Divergence attribution (same failing files rerun with each fix switched off; `evidence/phase1/variant-*`): fix (a) 17,
  fix (b) 1, fix (c) 6 — disjoint, complete, and no fix-off variant fails anything else. Adapted checks on the clone
  (scratch edits, reverted with `git checkout`):
  - (c): with only the unqualified-ID block removed, all 6 pass — including "maps Claude effort with distinct xhigh and
    max values"; the `reasoning_effort` edits change no upstream expectation.
  - (b): "labels likely auth failures without leaking the supplied API key" passes when the key fails on both attempts
    (auth message and `/login`/`CURSOR_API_KEY` guidance surfaced after the one retry, key not leaked). It fails as
    written only because its mock rejects once and returns nothing on the retry.
  - (a): 14 of 17 pass once the request declares a tool (13 in the combined run, "delayed pi bridge MCP calls" in
    isolation). The other 3 require the bridge on a request whose tool list is empty or absent — the behavior the
    2026-09-14 owner rule prevents: pi-context "keeps the empty request snapshot distinct from the bridge's
    registry-owned surface", stream-config "keeps pi bridge prompt guidance … even if context tools are empty",
    replay-post-tool "does not trim final text when pre-tool text is only a word prefix" (requires `pi_tools` on the
    absent-snapshot fixture; declaring a tool also breaks its passing sibling, so it cannot be adapted).
- Recovery assets (alamelu-tauri): `maintenance/pi-cursor-sdk/0.3.10/mac-local-fixes.patch` (1405 lines, 18 files: 9 `src`
  + 9 `dist`), `0.3.10/test/` (8 files), manifest `"0.3.10"` (entry `dist/index.js`, 18 files, 9 assets). Runbook
  rehearsal on a fresh stock copy: assets PASS → `--baseline` PASS → `patch --dry-run` 18 files → `patch` exit 0, no
  fuzz/offset → after PASS → result byte-identical to the ported layout. An unpatched copy fails the after check.
  `scripts/check-cursor-compaction.py` unchanged.

### Phase 2 — private runtime candidate

- `npm install --prefix runtime pi-cursor-sdk@0.3.10` (8 packages, `@cursor/sdk` 1.0.27); `--baseline` PASS → patch
  (no fuzz) → after PASS on `runtime/node_modules/pi-cursor-sdk`.
- Private agent dirs (0700): `settings.json` `packages` = the candidate only; `auth.json` (0600) holds only the `cursor`
  entry, copied without printing. Pi = staged 0.87.1 `dist/cli.js`, Node v24.16.0.
- A/B probe: Pi `read` executed, `CODE=ZEBRA-4471`, correct file — PASS (`evidence/phase2/ab-0.87.1-candidate.*`).
- Live compaction (`probe/live-compaction.py`, adapted from the September `live-check.py` + `observer.ts`; synthetic
  filler history, no owner content; `cursor/grok-4.6:fast`, window 256000):
  - manual — compaction `manual`, 1651-char summary; observer shows no tool call or probe between
    `session_before_compact` and `session_compact`; then a Pi `read` turn → `COMPACTION_FIXTURE_OK`. PASS.
  - automatic — private reserve 253500 (threshold ≈2500 tokens), keepRecent 1000; `threshold` compaction, 596-char
    summary; no tool call or probe during the summary; `AUTO_COMPACTION_OK`; then a Pi `read` turn →
    `COMPACTION_FIXTURE_OK`. PASS.
  - Results: `evidence/phase2/live-{manual,automatic}-{result.json,observer.jsonl}`.
- Stale-auth recovery is proven by the ported tests and the adapted upstream test only; a live expired login cannot be
  forced (known limit from the plan).

### Deviations from the approved plan (for the Implementation Audit)

- D1 — Helper location. Plan Phase 1.4(b) (P1-01 remedy) named the turn runner. The ported
  `cursor-provider-turn-runner-auth-recreate.test.ts` spies on `teardownFailedAuthAttempt` through a module mock, which
  cannot intercept a call inside the same module. The three helpers therefore live in the already-patched
  `cursor-provider-live-run-drain.ts` (it already imports `cursor-session-agent` and `cursor-provider-errors`; neither
  imports the drain; no new file; checker unchanged). Test adaptation: helper import path, and the spy moved into the
  test's existing drain mock.
- D2 — *Withdrawn in Round 2 (I1-01 accepted).* It ported only the bridge half; a legacy context with a system prompt
  and no tools still routed native tools as active (`queue_replay`). The routing half is now ported too.
- D3 — Done 4 says the 14 compaction tests fail on stock; *corrected in Round 2:* on stock 0.3.10 5 of 14 fail (5
  prepare tests) and 9 pass (8 routing tests and 1 prepare test). The 8 routing passes did not cover the legacy
  system-prompt form (I1-01); the two cases added in Round 2 fail on stock routing.
- D4 — *Resolved in Round 2 (I1-03), no waiver needed:* after the fixture and expectation adaptations the full suite is
  green with all three fixes enabled. Round 1 left 24 upstream failures and did not modify upstream tests.
- D5 — Manual live compaction used a private `keepRecentTokens: 1000` (the plan named private thresholds for automatic
  only): synthetic history is far below the default 20k keep-recent and `/compact` refused ("Nothing to compact").

## Verification Round 2 — response to Implementation Audit Round 1 (no production change)

- I1-01 (legacy omitted-tools routing): `src/cursor-context-tools.ts` now returns
  `new Set(tools?.map((tool) => tool.name) ?? [])` with tools from 0.3.10's `resolveCursorPiContext` — the September
  empty-set rule for legacy and transcript contexts alike; `cursor-provider-turn-prepare.ts` uses the Mac form
  `disablePiToolBridge: activeToolNames.size === 0`. The ported `cursor-compaction.test.ts` loop adds the legacy
  `{ systemPrompt, messages: [] }` form (two new tests, routing and drain): both fail on stock routing
  (`evidence/phase1-r2/legacy-cases-red-on-stock-routing.log`) and pass on the port. Compaction tests 16/16.
- I1-02 (fixture types): `auth-recreate-fixtures.ts` types its partial prepared-turn test double
  `as unknown as CursorProviderTurnPrepareResult`; `cursor-compaction.test.ts` adds `isError: false`;
  `cursor-provider-run-finalizer-auth-recreate.test.ts` passes `runtimeTarget: () => "local"`; the upstream
  `cursor-provider-run-finalizer.test.ts` passes `hasEmittedProgress: () => false`. No production type was weakened.
  Full `npm run typecheck` (src, tests, replay-compile): 0 errors.
- I1-03 (verification gate kept, no waiver): with I1-01 in place the full suite had 87 failures in 21 files
  (`evidence/phase1-r2/test-r2.log`) — the shared fixture `test/helpers/context-fixtures.ts` `makeContext()` builds a
  legacy request with a system prompt and no tool list, which the Mac rule treats as "no tools" (no bridge, native tools
  inactive). A real Pi request declares its active tools, so the shared fixture now declares the adapter's own
  `NATIVE_CURSOR_TOOL_NAMES`: 10 failures left, 0 new (`test-r2-fixture.log`). Ten expectation edits then encode the
  owner's behavior: five model-discovery ID lists gain the unqualified IDs (one follow-on index `models[2]`→`models[3]`);
  the snapshot-context test asserts runtime IDs = shared identities + the unqualified IDs; pi-context and stream-config
  assert that an empty request snapshot gets no bridge and no bridge guidance (renamed); stream-auth lets both attempts
  fail (one retry); mcp-timeout-override passes a valid `{ messages: [] }` context. All adaptations:
  `evidence/phase1-r2/upstream-test-adaptations.diff` (8 files, 184 lines). No production code changed for I1-03.
- Result with all three fixes enabled: typecheck 0 errors; `vitest run` 139 files passed + 1 skipped, 1544 tests passed
  + 5 skipped (baseline 1495 + 49 ported tests) — `evidence/phase1-r2/test-r2b.log`, `typecheck-r2b.log`.
- Recovery assets regenerated: `0.3.10/mac-local-fixes.patch` 1428 lines, 20 files (10 `src` + 10 `dist`); three test
  assets changed; manifest `"0.3.10"` 20 files, 9 assets. Rehearsal on a fresh stock copy: assets PASS → `--baseline`
  PASS → dry-run 20 files → patch exit 0, no fuzz/offset → after PASS → identical to the ported layout.
- Private runtime reset to stock (`--baseline` PASS), re-patched (no fuzz), after PASS. Live evidence re-run on this
  candidate (`evidence/phase2-r2/`): A/B probe PASS; manual compaction PASS (1984-char summary); automatic compaction
  PASS (`threshold`, 609-char summary); both with no tool call or probe during the summary and a following Pi `read`
  turn returning `COMPACTION_FIXTURE_OK`.
- Deviation status: D1 accepted by the critic; D2 withdrawn; D3 corrected; D4 resolved; D5 accepted by the critic.

## Deployment Round 1 — Mac activation (Phase 3), after Implementation Audit Round 2 PASS

- 3.1 Alamelu Pi closed, no Pi processes (22:08 IST). Snapshot: 7 config files (unchanged since Phase 0), Luna hash,
  `auth.json` hash, 978 owner session files touched in 7 days (`evidence/phase3/*-before*`).
- 3.2 Rollback: `rollback/pi-coding-agent-0.85.1.tgz`, `rollback/launcher-target.txt` (`…/dist/cli.js`),
  `rollback/pi-agent-npm.tgz` (adapter 0.1.60 + deps), `rollback/settings.json`.
- 3.3 `npm install -g @earendil-works/pi-coding-agent@0.87.1` (Node v24.16.0): npm reset nvm `bin/pi` to
  `dist/bundle/cli.js`; re-pointed to `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`;
  `~/.local/bin/pi --version` = 0.87.1; Luna check through `~/.local/bin/pi` PASS (Done 1).
- 3.4 Private settings copy first: `pi install npm:pi-cursor-sdk@0.3.10` replaces `npm:pi-cursor-sdk` in place
  (only `packages` changes). Real install: same result — `packages` = `npm:pi-cursor-sdk@0.3.10`,
  `../../playground/pi-web-access`; adapter 0.3.10 loads `dist/index.js`; checker `--baseline` PASS → patch 20 files,
  no fuzz → after PASS (Done 2).
- 3.5 Installed gates: Luna check PASS; A/B probe with the real config (`--no-session`, `--tools read`) PASS (Done 3);
  provider probes xai / xai-i2o (`grok-4.5:high`) / openai-codex (`gpt-5.6-luna:high`) answer `4`; Cursor model IDs
  288 before / 288 after, 0 missing, 0 new (Done 4 parity). Anthropic `claude-opus-5-5` now native.
- 3.6 Clean `git archive 4668c96` export, `pnpm install --frozen-lockfile`, desktop build. Harness setup: Electron's
  `install.js` stalled after a cache hit (extract stops, Node exits 0), so the cached
  `electron-v39.8.10-darwin-arm64.zip` was checked against Electron's pinned `checksums.json` (match) and extracted with
  `ditto`. `compacted-model-switch.spec.ts` with `PI_GUI_PI_BIN=<installed dist/cli.js>`, `PI_GUI_DRIVER=rpc`,
  `PI_GUI_BRAND=alpi`: 1 passed. `ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app'` packaged smoke: OK
  (47 providers, 816 models, 91 API members) (Done 6).
- 3.7 Snapshot re-check: only `settings.json` changed (the one `packages` entry); models, extensions, Luna and
  `auth.json` unchanged; 0 of 978 owner session files changed; 3 new session files under `sessions/--private-tmp--`
  from the three `pi -p` provider probes (the sync script's preflight does the same).
- D6 — the builder reopened the app (`open -a`) instead of the owner. That launch put `~/.local/bin` first on the app's
  PATH, so the app resolved the `~/.local/bin/pi` bash wrapper; its auth bridge rejects a non-`dist/cli.js` layout and
  the store showed 18 providers. Pre-existing: the two 2026-09-14 starts that resolved the wrapper on Pi 0.85.1 showed
  17. Reproducing the bridge against both installs gave 47 providers on 0.85.1 and on 0.87.1. After confirming the app
  was idle, it was relaunched with `PI_GUI_PI_BIN=~/.pi/agent/bin/pi` (its usual resolution, now 0.87.1
  `dist/cli.js`): 47 providers, 818 models, Pi child alive, no extension-load failure. The app's PATH-order behavior is
  not changed here (out of scope; reported to the owner).
- Model catalog changes from upstream Pi 0.87.1 (app 825 → 818): removed 23 OpenRouter entries, `openai-codex/gpt-5.4`
  and `gpt-5.4-mini`, one `opencode-go` alpha; added Anthropic Opus 5.5 and three Meta models. Every relay-chain and
  smoke model is still present.

## Deployment Round 2 — servers (Phase 4), 22:20–22:45 IST

- 4.1 Both servers: Pi 0.85.1 (wrapper → `pi-node/current/bin/pi` → `dist/bundle/cli.js`), adapter 0.1.42, 175 Cursor
  IDs incl. `composer-2.5` / `composer-latest:fast`, no Pi processes. Rollback on each:
  `~/.pi/agent/backups/pi087-cursor-0310-20260923/rollback/{pi-agent-npm.tgz,settings.json}`.
- 4.2 `pi install npm:pi-cursor-sdk@0.3.10` on each (only `packages` changed; stock 0.3.10 loads `dist/index.js`);
  A/B probe on Pi 0.85.1 PASS on both.
- 4.3 npm `@latest` = 0.87.1 confirmed. First `server_pi_maintenance.sh` run hung in the laptop preflight: its `pi -p`
  calls have no `</dev/null`, and a foreground tool call keeps stdin open. Only that run's process tree was stopped;
  both servers were confirmed unchanged (Pi 0.85.1, adapter 0.3.10). Rerun unchanged with `< /dev/null`: adopt PASS,
  preflight PASS, mock and backup updated 0.85.1 → 0.87.1, smoke xai / xai-i2o / openai-codex PASS on both.
- 4.4 Both on Pi 0.87.1 (bundled launcher) + stock 0.3.10: A/B probe PASS; `composer-2.5` and `composer-latest:fast`
  listed (Done 7). Cursor IDs 175 → 244; 47 older IDs are not offered by stock 0.3.10 — none is referenced in lazydata,
  alamelu scripts/config or Pi settings on either server.

## Records and cleanup (Phase 5)

- `REBUILD-PROTECTION.md`: Mac verified release 2026-09-23 (Pi 0.87.1 + 0.3.10, `dist/index.js`), launcher fix for 0.87.1,
  0.3.10 patch/tests/recovery command, 49-test note, dated release section, Windows/WSL pending (0.85.1 + 0.3.6,
  deferred 2026-09-23).
- Release evidence (git-ignored): `documents/release-evidence/pi087-mac-20260923/` (`status.json` with gate results,
  rollback locations and the 20 installed patched-file hashes; A/B, e2e, smoke, parity, server and sync logs).
- `pnpm run verify:upgrade` in the clean export with this task's files overlaid: 31 app/RPC/wiring tests pass, recovery
  assets PASS, 8 package-protection tests ran, gate passed.
- Mac maintenance kit synced (old kit backed up to `rollback/maintenance-kit-before`): 23-entry `kit-manifest.json`, no
  mismatches; the kit's checker passes its assets and the installed adapter.
- alamelu `documents/progress.md`: 2026-09-23 entry appended (file also holds another uncommitted edit; commit is the
  owner's call).
- Repo-memory: corrected note `mem_1acba792a055` (global scope, like the note it replaces) active; stale
  `mem_84d3a82c0b0d` ("Mac 0.1.60 loads src") and the interim project-scoped `mem_4ff83f86f2e3` retracted (audit I3-01).
- Private cursor-only `auth.json` copies deleted (5). With owner approval, the temporary artifacts were moved (not
  deleted) to `~/.Trash/pi087-cleanup-20260923` on the laptop (2.7 GB: the `/private/tmp` staging copies, adapter copies,
  test folders and critic runs; the task workspace's `dev/`, `e2e-export/`, `runtime/`, `diag-bridge/`, `probe/`; the three
  probe session files) and to `~/.local/share/Trash/files/pi087-cleanup-20260923` on each server (`/tmp/pi087-*`, probe
  scripts). The A/B probe, parser, live-compaction harness and observer are kept in `evidence/harness/`; evidence and
  rollbacks are kept in the task workspace.
- Committed with owner authorization: alamelu-tauri `3c93dde` (this task's documents, 0.3.10 recovery assets, manifest,
  `REBUILD-PROTECTION.md`). Not pushed. WSL remains deferred.

Implementation Audit Round 3 (final): PASS, 0 high / 0 medium / 1 low (I3-01, fixed as above).

## Done-criteria status

1 PASS (3.3) · 2 PASS (3.4) · 3 PASS (3.5) · 4 PASS (red→green tests, 288/288 parity) · 5 PASS (Phase 2 r2, candidate
identical to the installed patch) · 6 PASS (3.6) · 7 PASS (Phase 4) · 8 PASS (committed as `3c93dde`).
