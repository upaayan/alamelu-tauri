# Alamelu Pi

A desktop app for `pi` sessions. macOS, local, single-user.

## What this is

Alamelu Pi is a **thin wrapper over the `pi` CLI you already have installed**. It does not bundle a Pi runtime and does not keep its own copy of your sessions, models, auth or configuration — the installed `pi` remains the single source of truth for all of it, and the app drives it over `pi --mode rpc`.

That is the main difference from the upstream project this is derived from, which bundled its own Pi runtime. Here, whatever you do in the terminal and whatever you do in the app are the same sessions, the same providers, the same settings.

## Scope

This is a personal build, not a product:

- **macOS only** (Apple Silicon). Windows would need a rewrite off Electron; not planned.
- **No releases, no Homebrew tap, no auto-update.** The app never phones home and has no update mechanism at all.
- **Built and installed locally** from this repo by its owner.

## Requirements

- A working `pi` installation on your `PATH`, already authenticated with whichever providers you use (`pi --list-models` should print a catalogue).
- Node 24 and `pnpm` (via `corepack enable`).

## Build and install

```bash
pnpm install
pnpm --filter @alamelu-pi/desktop run package:alpi:dir
```

That produces a signed `alpi.app` under `apps/desktop/release-alpi/mac-arm64/`. Back up the current app before replacing it:

```bash
cp -R "/Applications/Alamelu Pi.app" "/Applications/Alamelu Pi.app.backup-$(date +%Y%m%d)"
rm -rf "/Applications/Alamelu Pi.app"
cp -R apps/desktop/release-alpi/mac-arm64/alpi.app "/Applications/Alamelu Pi.app"
```

Signing uses an AWS Secrets Manager–backed identity; the packaging script fails loudly if the secret is unavailable rather than falling back to an unsigned build. The app is signed but **not notarized**, which is fine on the machine that built it and would matter only if it were given to someone else.

## Development

```bash
pnpm --filter @alamelu-pi/desktop dev        # run the app from source
pnpm --filter @alamelu-pi/desktop build      # compile main, preload and renderer
pnpm --filter @alamelu-pi/desktop typecheck  # both TypeScript projects
```

Tests:

```bash
node --test apps/desktop/tests/unit/*.test.mjs      # unit
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

- `apps/desktop` — the Electron app: `electron/` (main process), `src/` (renderer)
- `packages/pi-rpc-driver` — adapter to the installed `pi --mode rpc` process
- `packages/session-driver` — shared session/driver types
- `packages/catalogs` — workspace and session catalog state
- `documents/plan-audit-implementation` — plans, audits and implementation records

## Credits and licence

Derived from the **pi-gui** project, used under the MIT licence; see [LICENSE](./LICENSE) for the original copyright holder and terms. The agent runtime is [`earendil-works/pi`](https://github.com/earendil-works/pi).

MIT.
