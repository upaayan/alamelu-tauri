# Rebuild protection implementation — 2026-09-14

Owner scope: document and protect the deployed compaction and active-context fixes
against the next app rebuild or Pi/adapter reinstall, on Mac and Windows/WSL.
No new application behavior, Rust build, Pi upgrade, or owner-session mutation.

## Delivered

- Canonical `documents/REBUILD-PROTECTION.md`, linked from root/desktop agent
  instructions, desktop README and the Pi upgrade runbook.
- Tracked version-specific adapter patches and 14-test fixtures for Mac0.1.60
  and WSL0.3.6, with original/fixed hashes and manifest entry points.
- Read-only installed adapter checker: rejects unknown versions, unexpected
  loaders, missing files and overwritten source or dist. Baseline mode verifies
  exact original files before manual patching a candidate.
- `pnpm run verify:upgrade`: app/RPC behavior, integration/build scheduling,
  packaged maintenance resources, recovery asset integrity and negative tests.
- Both native Actions jobs depend on Mac + Windows compatibility jobs before
  Rust setup/build. A standalone compatibility workflow can run without Rust.
- Local backend/Tauri packaging routes schedule the same gate. Future Tauri
  packages include the maintenance kit as resources.
- Matching standalone kits copied outside installers on Mac, WSL and Windows;
  active global repomem entries point to the canonical runbook and S3 route.
  Mac adapter checkout also has a maintenance pointer document.

## Verification

Tested source commit: `3f35f6c9542b2e98ba2292dce41ff7ad01a73989`.
[GitHub Actions run 34877346673](https://github.com/upaayan/alamelu-tauri/actions/runs/34877346673)
passed on macos-14 and windows-2022. Each ran 31 app/RPC/wiring tests, eight
negative protection tests, and 12 WSL/completion regressions (51 total), plus
recovery asset integrity verification. No provider credentials or Rust used.

The first CI run found a Windows CRLF assumption in the new wiring test; app
behavior tests passed. Corrected the regex and confirmed CRLF succeeds locally.
Disposable copies with either the CI dependency or local build gate removed
failed as intended. No runtime source was changed for this test portability fix.

Both adapter recovery patches were applied in temporary directories containing
retained original files: baseline verification and dry-run succeeded; patched
files reproduced every installed fixed hash (three Mac, six WSL).

Mac and WSL installed package checks passed. Both actual Pi launchers loaded the
installed app's Luna extension and answered two fresh RPC requests. WSL ran the
eight negative tests too. Both machines' kits matched the same 14-file manifest.

Desktop typecheck passed. The normal local `build:tauri:backend` command ran the
new gate successfully and emitted exactly the installed fixed bundle:
`af14fa814ae294239522e8e136add88e7f9ecf186e75d3b033b84e42570ccf66`.
This confirms a rebuild from the preserved source retains the deployed fix.

Manual/automatic live compaction, normal tool turns and real Electron/native
Windows model-switch proofs were completed during the preceding rollout;
see `cursor_compaction_implementation.md` and its Fable audit. They were not
repeated for this documentation/gate-only change. The new runbook explicitly
requires those machine-level checks for future runtime releases; CI asset
verification is not a substitute for them. No new Fable review was requested.

## Copies, evidence and cleanup

- Mac kit: `~/Library/Application Support/Alamelu Pi/maintenance-kit`.
- WSL kit: `/home/ubuntu/.local/share/alamelu-pi-maintenance`.
- Windows kit: `C:\Users\Asus\AppData\Local\Alamelu Pi Maintenance`.
- Active Mac memory: `mem_84d3a82c0b0d`; WSL: `mem_66eb0d8b069b`.
- Mac evidence: `~/.pi/agent/backups/rebuild-protection-20260914`.

The poller consumed three command objects; the five remaining owned payload and
response objects were deleted after preserving responses. Temporary patch/wiring
fixtures and relay extraction directories were removed. Stable kits and existing
working rollbacks remain. Unrelated tracked changes and untracked local files
were preserved. Commits used `[skip ci]` to avoid triggering native compilation;
only the compatibility workflow was dispatched.
