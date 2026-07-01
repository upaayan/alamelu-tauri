# Alpi Sidebar Defaults And No Repository Plan

Task: Implement two Alamelu Pi UX fixes:

1. The left sidebar should show only repository/workspace rows by default. Threads remain available by expanding a repo row.
2. The new-thread picker should support a working `No Repository` option, rename the ambiguous `Workspace` option, and expose `New Workspace...` as a folder picker action.

## Current Behavior

- `apps/desktop/src/hooks/use-workspace-menu.tsx` stores `collapsedWorkspaces` as local React state. Missing entries default to expanded.
- `apps/desktop/src/sidebar.tsx` renders each workspace group expanded unless `collapsedWorkspaces[rootWorkspace.id]` is true.
- `apps/desktop/src/new-thread-view.tsx` currently renders a select labelled `Workspace` containing only known workspace records.
- `apps/desktop/src/App.tsx` keeps `newThreadRootWorkspaceId`, derives `newThreadWorkspace`, and calls `api.startThread({ rootWorkspaceId, environment, ... })`.
- `apps/desktop/electron/app-store-worktree.ts` requires `rootWorkspaceId` to resolve to a real `WorkspaceRef`, and Pi sessions are created with `cwd: workspace.path`.

The observed RPC error from choosing the current `Workspace` option likely comes from the UI allowing an invalid or unintended workspace selection/path. A no-repo thread must still run with a real directory as `cwd`; it cannot be a fake empty id.

## Design

### 1. Collapse all repo groups by default

Change sidebar collapse semantics from "missing means expanded" to "missing means collapsed", with an explicit expansion when useful.

Implementation:

- Add a helper in `use-workspace-menu.tsx`, for example `isWorkspaceCollapsed(workspaceId: string): boolean`.
- Default missing `collapsedWorkspaces[workspaceId]` to `true`.
- Update `toggleWorkspaceCollapsed()` to invert the effective state, not the raw stored value:
  - `current[workspaceId] ?? true` is the current collapsed state.
  - first click on a default-collapsed workspace stores `false` and expands it.
- Update `expandWorkspace()` to use the same effective state and store `false` when the workspace is currently collapsed:
  - if `(current[workspaceId] ?? true) === true`, return `{ ...current, [workspaceId]: false }`.
  - otherwise return the current state unchanged.
- Update `sidebar.tsx` to use `wsMenu.isWorkspaceCollapsed(rootWorkspace.id)` rather than directly reading the map with `?? false`.

Rationale:

- This preserves the existing click-to-expand behavior while making first launch scannable by repo/workspace.
- Starting a new thread can still reveal the relevant repo through existing `wsMenu.expandWorkspace(newThreadRootWorkspaceId)` behavior.

### 2. Represent No Repository as a real scratch workspace

Add a generated Alpi no-repo workspace under app userData and register it like any other workspace. This is an Alamelu Pi behavior, not a generic pi-gui behavior:

- Path: `<userDataDir>/No Repository`
- Display name: `No Repository`

Implementation:

- Add shared helpers/constants for stable identity, not display-name checks:
  - no-repo display name: `No Repository`
  - no-repo directory name: `No Repository`
  - `isNoRepositoryWorkspace(workspace: WorkspaceRecord | undefined): boolean`, keyed by a typed field or the app-owned canonical path.
- Prefer adding an optional `specialKind?: "no-repository"` field to `WorkspaceRecord`, derived in `buildWorkspaceRecords()` by comparing each workspace path to the app-owned no-repo path supplied by `DesktopAppStore`.
- In `DesktopAppStore`, add `ensureNoRepositoryWorkspace()` or equivalent.
- Gate no-repo creation behind an Alpi option from Electron main, for example `enableNoRepositoryWorkspace`.
- During `initializeInternal()`, after normal initial workspace registration and before publishing state, create the directory and call `driver.syncWorkspace(noRepoPath, "No Repository")` if no existing workspace has that path.
- For Alpi RPC startup, do not auto-register the lab `workspace` folder as the visible default repository. `No Repository` is the explicit scratch option, and real folders remain user-selected repositories/workspaces.
- This gives the UI and RPC layer a valid `workspaceId` and `cwd` without requiring a git repo.
- Treat it as an ordinary primary workspace, but name it clearly.
- Use the stable `specialKind`/path-derived marker to disable git-only UI affordances for this workspace. Do not use `workspace.name === "No Repository"` as logic.

Rationale:

- Pi/RPC requires a concrete cwd for session creation.
- A stable app-owned directory is safer than using home, `/tmp`, or an invalid placeholder.
- The user can start general-purpose threads without attaching them to an existing repo.

### 3. New-thread picker labels and actions

Update `new-thread-view.tsx` so the current select becomes a repository picker with clear options:

- Screen-reader label: `Repository`
- Existing folder-backed workspaces appear by display name, including `No Repository`.
- Add a final option with sentinel value `__new_workspace__` labelled `New Workspace...`.
- When selected, call a new `onPickWorkspace()` prop instead of setting a bogus workspace id.

Update `App.tsx`:

- Pass `onPickWorkspace={() => api.pickWorkspace()}` to `NewThreadView`.
- Reuse the existing `onWorkspacePicked` event path to select the newly picked workspace in the new-thread surface.
- Ensure the root workspace selector includes `No Repository`.
- Disable `Worktree` environment when the stable no-repo marker says `No Repository` is selected, because no-repo is not a git repository.
- If `No Repository` is selected, force `environment` to `local` before submit.
- Hide or disable workspace menu actions that require git, such as permanent worktree creation, when the root workspace is the no-repo workspace.

Rationale:

- `No Repository` is the user's requested no-repo option.
- `New Workspace...` matches the user's mental model: select a folder to add.
- Preventing worktree mode for no-repo avoids a predictable git worktree failure.

### 4. Tests

Add or update focused tests:

- `apps/desktop/tests/core/sidebar-ordering.spec.ts` or a new core/sidebar collapse spec:
  - launch with a workspace containing threads
  - assert the workspace row is visible and thread rows are hidden initially
  - click workspace row and assert thread rows appear
- `apps/desktop/tests/core/new-thread-composer.spec.ts`:
  - assert the new-thread picker includes `No Repository`
  - start a thread with `No Repository`
  - assert no RPC/lastError blocks the UI and a thread is created
  - assert the final picker option is `New Workspace...`
- `apps/desktop/tests/native/open-folder.spec.ts` or a focused native spec:
  - stub `dialog.showOpenDialog`
  - select `New Workspace...` from the new-thread picker
  - assert the dialog was invoked
  - assert the chosen folder becomes the selected new-thread repository through the existing `workspacePicked` path
- If core tests are too expensive locally, add unit-level tests around store initialization for no-repo workspace creation and run the focused existing tests most likely to cover the flow.

## Expected Source Files

Likely source edits:

- `apps/desktop/electron/app-store.ts`
- `apps/desktop/electron/app-store-internals.ts` if helper typing is needed
- `apps/desktop/src/desktop-state.ts`
- `apps/desktop/src/workspace-roots.ts` or a new small workspace identity helper
- `apps/desktop/src/hooks/use-workspace-menu.tsx`
- `apps/desktop/src/sidebar.tsx`
- `apps/desktop/src/new-thread-view.tsx`
- `apps/desktop/src/App.tsx`
- focused tests under `apps/desktop/tests/core/` and `apps/desktop/tests/native/`

Debate-loop docs:

- `documents/plan-audit-implementation/alpi_sidebar_no_repository_plan.md`
- `documents/plan-audit-implementation/alpi_sidebar_no_repository_audit.md`
- `documents/plan-audit-implementation/alpi_sidebar_no_repository_implementation.md`

## Verification

Minimum verification before implementation audit:

```bash
node --test apps/desktop/tests/unit/*.test.mjs
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop typecheck
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/new-thread-composer.spec.ts apps/desktop/tests/core/sidebar-ordering.spec.ts
npx --yes pnpm@10.25.0 --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/native/open-folder.spec.ts
```

If the focused Playwright tests are too slow or fail for unrelated environment issues, record the actual output and run the narrower relevant test(s) plus typecheck.

## Edge Cases

- Existing user data may already contain a manually-added folder named `No Repository`; detect by path, not just name, to avoid duplicates.
- A user may rename the no-repo workspace; the app should still identify it by stable marker/path, not display text.
- If the app cannot create the no-repo directory, preserve startup and surface a non-fatal error rather than preventing existing repo use.
- If `No Repository` is selected while `Worktree` was previously active, force local mode.
- The new select sentinel must never be passed to `startThread`.
- Existing repo/worktree sessions must remain grouped under their root workspaces.
- New thread startup should continue to expand the target workspace after creating a thread, even though the default sidebar state is collapsed.
