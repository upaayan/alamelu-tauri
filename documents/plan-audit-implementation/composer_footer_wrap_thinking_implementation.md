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

Live Alamelu Pi `xhigh` / `xai-i2o` / `grok-4.6` smoke and Mac install wait for GitHub Actions macos artifact after implementation audit PASS.
