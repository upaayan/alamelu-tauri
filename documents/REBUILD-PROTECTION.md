# Preserve the Alamelu Pi fixes when rebuilding or upgrading

Canonical checklist for Mac and native Windows + WSL. Last verified release:
Mac 2026-09-23, Pi 0.87.1 + pi-cursor-sdk 0.3.10. Windows/WSL is **pending**: still
Pi 0.85.1 + adapter 0.3.6; its upgrade was deferred by the owner on 2026-09-23. The app uses external Pi; rebuilding Tauri does not preserve
or repair an npm-installed extension. Keep this document, the maintenance assets,
and the app source fixes in the same Git checkout used by GitHub Actions.

## What must survive

| Overwrite route | Required protection | Check |
| --- | --- | --- |
| Tauri/backend rebuild from older source | Fresh Pi `get_messages` supplies model-switch size; no JSONL archive-size fallback | `pnpm run verify:upgrade` |
| Repeated compactions | Count current message content, not archived history, usage metadata or base64 | 19 preflight and 9 RPC tree/compaction regressions in that gate |
| Losing the composer/driver integration | Await current messages and pass them to the estimator | Integration wiring checks in that gate |
| `npm install -g` of Pi | For 0.85.1 and 0.87.1 retain the unbundled `dist/cli.js` launcher (npm resets it to `dist/bundle/cli.js`) | Actual launcher + installed Luna extension RPC check |
| `pi update` / reinstall of `pi-cursor-sdk` | Omitted/empty tools mean no Pi tool bridge or escaped tool call during summaries | Version-specific patch, hash check, adapter tests (14 on 0.1.60/0.3.6, 49 on 0.3.10) and live checks |
| Windows source-only adapter patch | 0.3.6 loads `dist/index.js`; patch all three source AND three compiled files | Manifest loader and all six hashes checked |
| Installer replacement | Build these fixes from tracked source; preserve external Pi config and platform dependencies | Both-platform release record, installed checks |

The two September failures were real release failures: checking only `pi --version`
missed the Luna extension startup failure; patching only WSL TypeScript missed the
manifest's compiled entry point. Both now have explicit failing checks. The old
1M+ display came from retained JSONL archive length; Pi's active estimate was
about 243k before recovery and 27.7k after it. Never truncate history to fix this.

## Before any Rust build

From the repository root, after `pnpm install --frozen-lockfile`:

```bash
pnpm run verify:upgrade
```

This builds only the two TypeScript driver packages, runs 31 app/RPC/wiring tests,
verifies the retained recovery assets and runs eight negative package-protection
tests. No Rust, Pi installation, credentials or model calls are needed.

Both native GitHub Actions jobs depend on `upgrade-compatibility.yml` succeeding
on macOS and Windows **before Rust setup or compilation**. Run that workflow alone
with `gh workflow run upgrade-compatibility.yml` when checking a proposed upgrade.
It also runs on pull requests. The local `build:tauri:backend` command runs the
same gate; `build:tauri`, `check:tauri`, and Tauri's `beforeBuildCommand` reach it.
Do not bypass it by invoking Cargo or the raw backend bundler directly. A wiring
test fails if the normal package/build routes no longer schedule the gate.

This gate verifies app behavior and recovery assets. It does **not** claim to run
Cursor's SDK, installed Pi, real compaction, or the native app in CI. Those are
machine release gates below. Do not replace them with an asset checksum result.

## Adapter recovery after reinstall

Durable files are in `maintenance/pi-cursor-sdk/` (not the ignored
`documents/release-evidence/` directory):

- `manifest.json`: reviewed before/after hashes and Pi loader entry for each version.
- `0.1.60/compaction.patch`: Mac's three source changes.
- `0.3.6/compaction.patch`: WSL's three source and three compiled changes.
- `0.3.10/mac-local-fixes.patch`: the Mac's local fixes ported to 0.3.10 — compaction (omitted/empty
  tools → no Pi bridge and inactive native replay), stale-auth recovery, model variants/effort mapping —
  ten source and ten compiled files.
- Each version's `test/`: two compaction test files and their fixture helper; 0.3.10 also keeps four
  stale-auth test files and a model-variant test.

Mac runs 0.3.10 (since 2026-09-23), which loads `dist/index.js`; the earlier Mac 0.1.60 loaded
`src/index.ts`. WSL 0.3.6 loads `dist/index.js`. Preserve these
separate versions and their other customizations. Do not copy the whole Mac
package onto WSL. First inspect `settings.json` → `packages` to identify the
package Pi actually loads; an editable checkout alone is not the runtime.

Read-only installed checks, from this repository or the copied maintenance kit:

```bash
# Mac
python3 scripts/check-cursor-compaction.py --package "$HOME/.pi/agent/npm/node_modules/pi-cursor-sdk"
# WSL (run inside WSL, not native PowerShell)
python3 scripts/check-cursor-compaction.py --package /home/ubuntu/.pi/agent/npm/node_modules/pi-cursor-sdk
```

A different version, different loader entry, missing file, or hash mismatch fails.
This deliberately does not auto-patch unknown versions or locally modified files.
For a known unpatched baseline, make a candidate copy and keep the working
runtime/one rollback. Set `candidate` to that copy and `kit` to this repository
or maintenance-kit root. Choose **the candidate's** version, then:

```bash
python3 "$kit/scripts/check-cursor-compaction.py" --package "$candidate" --baseline
patch --dry-run -d "$candidate" -p1 -i "$kit/maintenance/pi-cursor-sdk/0.3.6/compaction.patch"
patch -d "$candidate" -p1 -i "$kit/maintenance/pi-cursor-sdk/0.3.6/compaction.patch"
python3 "$kit/scripts/check-cursor-compaction.py" --package "$candidate"
```

Use `0.1.60` instead on that version; on 0.3.10 use `0.3.10/mac-local-fixes.patch`. Execute each step only after the previous
one succeeds. Never use patch fuzz/force to work around a failed baseline check.
For a new version, review whether upstream fixed the behavior; port only missing
changes, test its real manifest-loaded runtime, and deliberately update the
version entry, patches, tests and evidence. Historical hashes are not a permanent
requirement on legitimate new releases.

Copy the matching `test/` files into the candidate's `test/` directory and run its
existing Vitest runner:

```bash
cd "$candidate"
./node_modules/.bin/vitest run test/cursor-compaction.test.ts test/cursor-compaction-prepare.test.ts
# 0.3.10 also: test/cursor-live-run-auth-recreate.test.ts test/cursor-provider-auth-recreate.test.ts
#   test/cursor-provider-run-finalizer-auth-recreate.test.ts test/cursor-provider-turn-runner-auth-recreate.test.ts
#   test/cursor-model-variants.test.ts
```

Install the candidate's own locked development dependencies if its packaged copy
has no test runner. Do not upgrade dependency versions to obtain one. 0.1.60 and 0.3.6
have 14 focused tests; 0.3.10 has 49 (16 compaction, 29 stale-auth, 4 model-variant). WSL 0.3.6 needs its own session-store test stub; do not copy
Mac auth-recreation tests onto it. Tests prove omitted/empty-tool summaries stay
text-only and normal explicit-tool requests still use the bridge after success,
failure and cancellation. Preserve the package's existing broader tests too.

For 0.3.6, regenerate the three compiled files if porting a change. The verified
compiler emission was TypeScript `transpileModule`, ES2022 target, ESNext module;
original emissions reproduced original dist hashes byte-for-byte. Source-only
Vitest passing is insufficient: test through private `settings.packages` with the
actual package manifest, never `--extension src/index.ts` as a substitute.

## Installed runtime release gates — both machines

1. Run the actual Pi launcher with the installed app's Luna extension using
   `scripts/check-pi-app-extension.py`. See [Pi upgrade runbook](PI-UPGRADE-WINDOWS.md)
   for exact Mac/WSL paths and the 0.85.1 symlink fix. This uses two RPC requests,
   no model and no saved session. An npm reinstall can reset the launcher.
2. Verify the adapter through the checker above. Preserve auth/settings/models,
   visibility files, xAI extensions and each platform's npm paths. Do not sync
   credentials or all settings merely to deploy this fix.
3. With a private test session and private settings loading the package normally,
   require actual successful **manual and automatic** compaction events, nonempty
   main/prefix summaries, no Pi toolCall/toolUse or bridge execution escaping the
   summary, followed by a successful ordinary tool turn. Native Cursor tools can
   run internally; do not confuse their internal trace with a leaked Pi tool call.
4. Verify model selection after two compactions through the real Electron surface:
   `apps/desktop/tests/core/compacted-model-switch.spec.ts`. Use the normal lane:
   `pnpm --filter @alamelu-pi/desktop run build`, then
   `pnpm --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/compacted-model-switch.spec.ts`.
   On Windows additionally exercise the native backend → `wsl.exe` → Pi path;
   assert the intended resumed session and persisted `model_change`, not just
   absence of an error. Never test by prompting or compacting the owner's task.
5. Compare the candidate and installed backend hashes on both platforms for the
   same release. Retain Windows node-pty/native executable when shipping only JS.
   Do not copy Mac native dependencies. A future backend hash may legitimately
   differ from September's `af14fa814ae294239522e8e136add88e7f9ecf186e75d3b033b84e42570ccf66`.
6. Record source commit, Pi/adapter versions, loader paths, backend hashes, test
   results and rollback in a dated release record. Keep Windows **pending** until
   installed checks pass. After graceful app close, snapshot protected session
   and config hashes; compare before reopening. Never restore stale history over
   conversations that continued after the backup.

Windows fixture traps: `.bashrc` changes Pi cwd to `/home/ubuntu/playground/lazytrade`.
Seed Pi's exact-session fixture with that cwd and use absolute test-file paths.
An empty newly created session is a false model-switch proof. The September WSL
model advertised 256k, so a 33k auto-compaction fixture needed private reserve250000
and keepRecent1000; assert the event actually happened. Never change production
compaction settings merely to make the test pass.

## Mac release 2026-09-23 — Pi 0.87.1 + pi-cursor-sdk 0.3.10

Pi 0.86+ passes providers messages-only context, so adapters before 0.3.7 lose Pi's system prompt and
tool bridge silently. The Mac moved to 0.3.10 with its local fixes ported (above). The installed
launcher still needs the unbundled `dist/cli.js`; the Luna check, manifest checker, A/B read/system-prompt
probe, 288-ID Cursor model parity, `compacted-model-switch.spec.ts` and the packaged smoke passed on the
installed runtime; private manual and automatic Cursor compactions passed on the candidate. Mock and backup
run stock 0.3.10 on Pi 0.87.1. Plan, audit and evidence: `documents/plan-audit-implementation/`
`pi087_cursor_0310_upgrade_{plan,audit,implementation}.md` and `documents/release-evidence/pi087-mac-20260923/`.
Do not move WSL to Pi 0.86+ before its adapter is upgraded.

## Connection, copies and cleanup

Canonical source: `https://github.com/upaayan/alamelu-tauri`.
Mac checkout: `/Users/sudhirjha/playground/alamelu-tauri`.
An editable Mac adapter checkout at `/Users/sudhirjha/playground/pi-cursor-sdk`
is not Git-backed; these retained patches are its durable recovery source.

Windows connection uses `s3://sudhir-windows-relay`, region `ap-south-1`. Upload a
unique `relay_cmd_<id>.sh`, then fetch `relay_response_<id>.txt`. Response arrives
when the WSL script exits. Save it; do not resubmit an unresolved mutation. Use
absolute executables and narrowly scoped paths. Do not blindly run the old broad
`windows-sync.sh` credential sync for this task.

A copy of this kit lives outside installers on both sides:

- Mac: `~/Library/Application Support/Alamelu Pi/maintenance-kit`
- WSL: `/home/ubuntu/.local/share/alamelu-pi-maintenance`
- Windows: `C:\Users\Asus\AppData\Local\Alamelu Pi Maintenance`

Future Tauri packages also include it under their resources `maintenance-kit/`.
The kit contains this checklist, the Pi runbook, adapter patches/tests/manifest,
and the two runtime checkers plus protection tests. The full app gate requires
this repository and its dependencies; the standalone kit is for runtime checks
and recovery. Synchronize these copies after changing the canonical files.

Keep one viable rollback of changed runtime files. Remove only owned relay keys,
private fixture sessions and staging directories after all test children exit.
Keep concise evidence and do not delete owner history or unrelated backups.
September live evidence remains in `.pi/agent/backups/compaction-windows-20260914`
on each platform, with Mac's earlier implementation evidence in
`.pi/agent/backups/cursor-compaction-implementation-qrgjrw_u`.
