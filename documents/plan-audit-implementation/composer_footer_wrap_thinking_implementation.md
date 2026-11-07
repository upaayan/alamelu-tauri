# Composer footer, wrap reserve, thinking accept — implementation

Repo: `/Users/sudhirjha/playground/alamelu-tauri` only.

## What changed

- `apps/desktop/src/composer-panel.tsx` — hint/model/thinking first, then the reserved elapsed slot, then existing actions.
- `apps/desktop/src/styles/main.css` — `.composer__elapsed` keeps 36ch tabular nums, `margin: 0 18px`, centered text. Shared `.composer textarea` min-height stays 24px. Session-only `.composer:not(.new-thread__composer) textarea { min-height: 72px }`.
- `packages/pi-rpc-driver/src/pi-rpc-driver.ts` — removed `assertRestoredSessionConfig` and its call. `get_state` success, session-id match, closed/active guards, and snapshot merge of `restoredConfig` remain.
- `packages/pi-rpc-driver/test/rpc-client.test.mjs` — one fake-client rotate case: start `xai-i2o` / `grok-4.6` / `xhigh`, replacement `get_state` returns `cursor` / `composer-2.5` / `high`, replace succeeds and snapshot takes Pi’s config.

POC directory was not deleted and is not part of the product.

## Verification Round 1

```text
pnpm --filter @alamelu-pi/pi-rpc-driver run build
pnpm --filter @alamelu-pi/pi-rpc-driver test
```

`Ran 76 tests` `pass 76` including `PiRpcDriver rotates and accepts Pi provider model and thinking from replacement get_state`.

```text
pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci
```

`pass 4` (clipboard helpers, `fitComposerTextarea`, native attachments, Tauri API parity).

Live Alamelu Pi `xhigh` / `xai-i2o` / `grok-4.6` smoke needs a restart of the installed app.

## Verification Round 2

- Commit `3c02194` pushed to `main`.
- GitHub Actions: https://github.com/upaayan/alamelu-tauri/actions/runs/34772484587 — macOS Apple Silicon **success**. Windows job was not used for install.
- Installed GHA `Alamelu-Pi-Tauri-macos-arm64` to `/Applications/Alamelu Pi Tauri.app`.
- Previous app copied to `/Applications/Alamelu Pi Tauri.app.bak-20260913-2319`.
- This session is still the old running binary; quit and reopen Alamelu Pi to load `3c02194`.

## Verification Round 3 — Windows transfer + pi 0.85.1 (2026-09-14)

**Later correction:** the initial WSL Pi upgrade below did not establish app
compatibility. It was reverted to 0.84.2 after the app's Pi child failed. The
failure was subsequently reproduced in the preserved 0.85.1 package and repaired
using its unbundled launcher, without rebuilding the app. See
[Pi Windows upgrade diagnosis and required checks](../PI-UPGRADE-WINDOWS.md).

Owner asked whether Windows was at Mac level, then authorized transfer of the matching Windows installer and a pi bump to 0.85.1 via `sudhir-windows-relay`. Short timed relay commands only; no leftover `relay_cmd_` files.

- Same source as Mac: GHA run 34772484587, commit `3c02194`, artifact `Alamelu-Pi-Tauri-windows-amd64`.
- Previous Windows exe (2026-08-27) backed up to `C:\Users\Asus\AlameluPiTauriBackups\pre-3c02194-20260914`.
- Installed NSIS `/S`. New exe mtime 2026-09-13 23:17, sha256 `3b088d42c4ecd0183b9e456168d47bfb8ee2f64ce53f09e694470f1c98b5fc42`. App was not launched from the poller.
- Mac nvm pi `0.84.2` → `0.85.1` (backup tarball `/tmp/alpi-win-xfer-20260914/mac-pi-0.84.2/pi-coding-agent.tgz`). pi-ai patch still `fixed-upstream`. Accidental Homebrew global pi 0.85.1 removed after the nvm copy was updated.
- WSL toolchain pi `0.84.2` → `0.85.1` (backup `/home/ubuntu/.playground/sudhir-codex-toolchain/backups/pi-coding-agent-0.84.2-20260914.tgz`).
- Copied Mac `xai-i2o-oauth.ts` / `xai2-oauth.ts` onto WSL; previous copies in `~/.pi/agent/backups/ext-20260914`.
- Rollback installer still at `s3://sudhir-windows-relay/artifacts/Alamelu-Pi-Tauri-gha-windows-x64-3c02194.exe` until the owner confirms the live Windows app.
