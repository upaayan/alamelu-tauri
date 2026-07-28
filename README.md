# Alamelu Pi Tauri

A Tauri desktop app for `pi` sessions. The window is branded **Alamelu Pi**;
the bundle is separately named **Alamelu Pi Tauri** so it can coexist with the
existing Electron app.

## What this is

Alamelu Pi is a **thin wrapper over the `pi` CLI you already have installed**.
It does not bundle a Pi runtime or credentials. The installed `pi` remains the
source of truth for providers, models, auth, skills and extensions, and the app
drives it over `pi --mode rpc`.

The existing React interface and Pi session engine are reused. Tauri owns the
native window and a small Rust-to-Node transport; Electron is not present in the
bundle.

## Builds

GitHub Actions produces:

- a macOS Apple Silicon `.app`
- a Windows AMD64 installer

The macOS CI artifact is ad-hoc signed, not notarized. The Windows app uses
native Tauri and Node on Windows, then runs the installed `pi` through WSL.
It reads Pi credentials from the default WSL distribution; credentials are
never bundled in either artifact or stored in this repository.

The Windows/WSL path is compiled and unit-tested in CI, but its final runtime
test must be performed on a real Windows machine with WSL. There is no
auto-update system.

## Requirements

- macOS: a working `pi` on your `PATH`, already authenticated.
- Windows: WSL with a working, authenticated `pi`; and Node 24 on Windows.
- Building locally also requires `pnpm`, Rust stable and platform build tools.

## Build and install

```bash
pnpm install
pnpm run check:tauri
pnpm run package:tauri
pnpm --filter @alamelu-pi/desktop run sign:tauri
pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged
```

The signed candidate is produced at
`apps/desktop/src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app`.
These commands do not replace or modify `/Applications/Alamelu Pi.app`.

Local macOS signing uses an AWS Secrets Manager–backed identity; the packaging
script fails loudly if that secret is unavailable. Public GitHub builds do not
receive that secret and use an ad-hoc signature instead.

## Development

```bash
pnpm --filter @alamelu-pi/desktop run build:tauri:assets
pnpm --filter @alamelu-pi/desktop run typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Tests:

```bash
node --test apps/desktop/tests/unit/*.test.mjs      # unit
pnpm --filter @alamelu-pi/desktop run test:tauri:unit
pnpm --filter @alamelu-pi/desktop run test:tauri:functional
pnpm --filter @alamelu-pi/pi-rpc-driver test        # RPC driver suite
```

End-to-end specs run under Playwright against a real Electron window. Specs must set `PI_GUI_BRAND=alpi` and an isolated `PI_APP_USER_DATA_DIR`; unbranded specs select a driver this fork no longer has and cannot boot. Run them by name:

```bash
pnpm --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/ux-repair.spec.ts
```

## The pi-ai patch

`pi-ai` truncates composite tool-call IDs to 40 characters, which makes parallel tool calls from one turn collapse into the same ID; providers then reject the replayed history with `400 Duplicate value for 'tool_call_id'` after a model switch. The app patches the installed `pi-ai` to make that truncation collision-proof, and **re-applies the patch automatically whenever the installed `pi` version changes**, since `pi update` reinstalls the library and reverts it. Manual control if you want it:

```bash
node apps/desktop/scripts/patch-global-pi-ai.mjs --check
node apps/desktop/scripts/patch-global-pi-ai.mjs --apply
```

The patcher refuses to touch the file if pi's source no longer matches what it expects, rather than guessing.

## Repository layout

- `apps/desktop/src-tauri` — Tauri host, native commands and process transport
- `apps/desktop/src/tauri-bridge.ts` — Tauri implementation of `window.piApp`
- `apps/desktop/electron` — reused desktop backend plus the small Tauri
  compatibility sidecar
- `apps/desktop/src` — shared React renderer
- `packages/pi-rpc-driver` — adapter to the installed `pi --mode rpc` process
- `packages/session-driver` — shared session/driver types
- `packages/catalogs` — workspace and session catalog state
- `documents/plan-audit-implementation` — plans, audits and implementation records

## Credits and licence

Derived from the **pi-gui** project, used under the MIT licence; see [LICENSE](./LICENSE) for the original copyright holder and terms. The agent runtime is [`earendil-works/pi`](https://github.com/earendil-works/pi).

MIT.
