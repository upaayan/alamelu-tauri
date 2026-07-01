# Sidebar Resizer Implementation

Scope: implementation-only change requested by Sudhir for the Alamelu Pi Electron UI. No plan phase was requested.

## Owner Request

- Add a draggable divider between the left thread sidebar and the right chat window.
- Let the sidebar become larger or smaller dynamically.
- Fix the tiny rename box problem.
- Keep the change simple and focused.

## Files Changed

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/sidebar.tsx`
- `apps/desktop/src/styles/sidebar.css`

## Implementation

- Added a persisted sidebar width preference in `App.tsx`.
  - Default: `292px`
  - Minimum: `240px`
  - Maximum: `620px`
  - Main chat area guard: keeps at least `520px` available for the main pane on wide layouts.
  - Stored in `localStorage` as `pi-gui.sidebarWidth`.

- Added a vertical `role="separator"` divider between `<Sidebar />` and `<main />`.
  - Pointer drag updates the CSS variable `--sidebar-width` live.
  - Mouse/pointer release stores the final width.
  - Double-click resets to the default width.
  - The divider is hidden when the sidebar is collapsed or under the existing narrow-screen breakpoint.

- Updated `.shell` from a two-column grid to a three-column grid:
  - sidebar
  - resize handle
  - main chat surface

- Improved rename layout.
  - Thread rename rows now add `session-row--renaming`.
  - While renaming, the trailing time/action column is hidden so the input gets the full row width.
  - Workspace rename form now uses full available sidebar width instead of being indented and squeezed.

## Verification

Commands run from `/Users/sudhirjha/playground/pi-gui-rpc-lab`:

```text
pnpm --dir apps/desktop run typecheck
```

Result:

```text
/bin/bash: pnpm: command not found
```

Fallback:

```text
npm --prefix apps/desktop run typecheck
```

Result:

```text
> @pi-gui/desktop@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit

exit 0
```

Production renderer/main build:

```text
npm --prefix apps/desktop exec electron-vite build -- --config electron.vite.config.mjs
```

Result:

```text
vite v6.4.1 building SSR bundle for production...
out/main/main.js  273.44 kB
vite v6.4.1 building SSR bundle for production...
out/preload/preload.js  16.23 kB
vite v6.4.1 building for production...
out/renderer/index.html
out/renderer/assets/index-BAvwvGpd.css
out/renderer/assets/index-BYg0HyGf.js
exit 0
```

## Notes

- The source tree already had many unrelated dirty files before this change. This implementation only intentionally touched the three files listed above.
- The app was not running during implementation, per Sudhir's note.

## Response to Implementation Audit Round 1

Accepted MEDIUM: passive window resize persisted the temporary viewport-clamped width.

- Reworked `App.tsx` to keep `preferredSidebarWidth` separate from the displayed `sidebarWidth`.
- `sidebarWidth` is now derived from `preferredSidebarWidth` plus the current `viewportWidth`.
- `window.resize` updates only `viewportWidth`, forcing a re-render without writing to `localStorage`.
- `localStorage` is written only on explicit drag completion or double-click reset.

Accepted LOW: clamp did not account for the 8px divider.

- Added `SIDEBAR_RESIZER_WIDTH = 8`.
- Subtracted it in `clampSidebarWidth` so the main pane keeps the intended minimum width.

Verification after repair:

```text
npm --prefix apps/desktop run typecheck
```

Result:

```text
> @pi-gui/desktop@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit

exit 0
```

```text
npm --prefix apps/desktop exec electron-vite build -- --config electron.vite.config.mjs
```

Result:

```text
out/main/main.js  273.44 kB
out/preload/preload.js  16.23 kB
out/renderer/index.html
out/renderer/assets/index-BAvwvGpd.css
out/renderer/assets/index-Deim24l6.js
exit 0
```

## Response to Implementation Audit Round 2

Accepted MEDIUM: startup still viewport-clamped the stored preference for the current session.

- Added `clampSidebarPreference`, which bounds stored preferences only by global min/max.
- `getStoredSidebarWidth` now uses `clampSidebarPreference`, not viewport-aware `clampSidebarWidth`.
- The display width is still computed from preference plus viewport, so a narrow launch can display a clamped width without losing the wider preferred width.

Verification after repair:

```text
npm --prefix apps/desktop run typecheck
```

Result:

```text
> @pi-gui/desktop@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit

exit 0
```

```text
npm --prefix apps/desktop exec electron-vite build -- --config electron.vite.config.mjs
```

Result:

```text
out/main/main.js  273.44 kB
out/preload/preload.js  16.23 kB
out/renderer/index.html
out/renderer/assets/index-BAvwvGpd.css
out/renderer/assets/index-d7SAA0Iq.js
exit 0
```
