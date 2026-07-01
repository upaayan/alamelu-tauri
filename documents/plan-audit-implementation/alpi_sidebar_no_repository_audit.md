<!-- critic_id: 019ee984-a579-7032-b6db-1f38545aaac8 -->

# Alpi Sidebar Defaults And No Repository Audit

## Plan Audit Round 1

Verdict: REVISE

Findings:

- HIGH: The collapse-state plan changes the meaning of a missing `collapsedWorkspaces[id]` entry without updating the state transitions that depend on the old meaning. The plan says to default missing entries to collapsed, but also says to keep `toggleWorkspaceCollapsed()` behavior and keep `expandWorkspace()` setting expansion. In current code, `toggleWorkspaceCollapsed()` writes `!current[workspaceId]`, so the first click on a missing/initially-collapsed row writes `true` and leaves it collapsed; `expandWorkspace()` returns early when `current[workspaceId]` is missing, so starting a new thread would not reveal the target workspace either. This breaks the core requirement that threads remain available by expanding a repo row and the plan's own edge case that new-thread startup should expand the target workspace. Require the plan to change both helpers under the new invariant, for example `isWorkspaceCollapsed(id) => current[id] ?? true`, `toggleWorkspaceCollapsed(id) => ({ ...current, [id]: !(current[id] ?? true) })`, and `expandWorkspace(id) => ({ ...current, [id]: false })` when `current[id] ?? true` is collapsed. Evidence: current helper behavior is in `apps/desktop/src/hooks/use-workspace-menu.tsx:150-158`, current sidebar default is `apps/desktop/src/sidebar.tsx:338-346`, and new-thread startup calls `wsMenu.expandWorkspace(newThreadRootWorkspaceId)` at `apps/desktop/src/App.tsx:1832-1838`. Plan lines `26-35` and `133` need revision.

- MEDIUM: The plan does not define a stable way for renderer code to identify the app-owned `No Repository` workspace. It says to disable/force local mode "when `No Repository` is selected", but the current renderer receives ordinary `WorkspaceRecord`s and `newThreadWorkspace` is selected from `rootWorkspaceOptions` by id with no no-repo marker. An implementation that checks `workspace.name === "No Repository"` would be fragile if a real repo has that display name or if the app-owned workspace is renamed, and an implementation that checks only display text could also disable worktree UI for the wrong workspace. Require the plan to add an explicit constant/helper keyed by the generated userData path or a typed field such as `workspace.specialKind === "no-repository"` in `WorkspaceRecord`, then use that for the new-thread worktree disable/submit guard and for other git-only actions exposed on the no-repo row. Evidence: `newThreadWorkspace` is just a normal workspace lookup at `apps/desktop/src/App.tsx:383-385`, `NewThreadView` receives only `workspaces` and `selectedWorkspaceId` at `apps/desktop/src/App.tsx:2158-2162`, and the plan's no-repo detection guidance is only by name/path at lines `41-49`, `70-72`, and `128-130`.

- MEDIUM: The verification plan does not actually prove the requested `New Workspace...` folder-picker action. It only asks the core new-thread test to assert that the final picker option is labelled `New Workspace...`; that would pass even if selecting it never calls `api.pickWorkspace()` or never processes `workspacePicked`. This repo already classifies folder pickers as native coverage and has reusable stubs for `dialog.showOpenDialog`, so the plan should add a targeted native test or an explicit mocked Electron test that selects `New Workspace...`, asserts the open dialog was invoked, and asserts the picked folder becomes the selected new-thread repository via the existing `workspacePicked` path. Evidence: desktop test guidance puts folder pickers in the native lane at `apps/desktop/tests/AGENTS.md:6-12`, dialog stubs exist at `apps/desktop/tests/helpers/electron-app.ts:864-885`, and existing native open-folder coverage demonstrates the pattern at `apps/desktop/tests/native/open-folder.spec.ts:22-40`. Plan lines `88-93` and verification line `121` should include this proof.

## Response to Plan Audit Round 1

This is Response to Plan Audit Round 1.

- HIGH collapse-state finding: Accepted. The plan now explicitly changes `toggleWorkspaceCollapsed()` and `expandWorkspace()` to operate on the effective state `current[id] ?? true`, so a first click expands and programmatic reveal stores `false`.
- MEDIUM no-repo identity finding: Accepted. The plan now requires a stable marker, preferably `WorkspaceRecord.specialKind === "no-repository"` derived from the app-owned no-repo path. It explicitly forbids using display name checks for logic.
- MEDIUM picker verification finding: Accepted. The plan now requires a native test that stubs `dialog.showOpenDialog`, selects `New Workspace...`, verifies the dialog path, and verifies the selected new-thread repository updates through `workspacePicked`.

## Plan Audit Round 2

Verdict: PASS

Findings:

- None.

Notes:

- Round 1 HIGH collapse-state issue is resolved: the plan now explicitly defines effective-state behavior for `toggleWorkspaceCollapsed()` and `expandWorkspace()` under the new default-collapsed invariant.
- Round 1 MEDIUM no-repo identity issue is resolved: the plan now requires a stable marker/path-derived identity and forbids display-name checks for logic.
- Round 1 MEDIUM picker verification issue is resolved: the plan now adds native coverage for selecting `New Workspace...`, stubbing `dialog.showOpenDialog`, and verifying the `workspacePicked` path updates the new-thread repository.

## Implementation Audit Round 1

Verdict: PASS

Findings:

- LOW: If the app-owned `No Repository` directory cannot be created or synced, `ensureNoRepositoryWorkspace()` preserves startup but only writes a console warning. The approved plan asked to preserve startup and surface a non-fatal error. This is not a blocker for the normal behavior, and failures here are likely to coincide with broader user-data filesystem problems, but the UI/user-visible part of that edge case is incomplete. Evidence: `apps/desktop/electron/app-store.ts:1021-1033`.

Behavior audit:

- Sidebar default-collapse behavior matches the plan. `isWorkspaceCollapsed()` defaults missing entries to `true`, first click stores `false`, and `expandWorkspace()` stores `false` for programmatic reveal. `sidebar.tsx` uses the helper instead of directly reading the map.
- `No Repository` is Alpi-gated and backed by a real userData directory. The marker is derived from the app-owned path as `specialKind: "no-repository"`, and renderer decisions use the marker instead of display-name checks.
- New-thread behavior matches the request. The picker is labelled `Repository`, includes `No Repository`, appends `New Workspace...`, sends that sentinel to the folder picker instead of `startThread`, disables Worktree for no-repo, and forces local mode at submit.
- Folder-picker behavior has direct native coverage using the existing `dialog.showOpenDialog` stub and verifies that `workspacePicked` updates the selected new-thread repository.

Verification and packaging evidence:

- The recorded verification is sufficient for this implementation audit: typecheck passed, desktop build passed, focused core Playwright passed after rebuild with 7 tests, native open-folder Playwright passed with 6 tests, package runtime dependency verifier passed, and the installed `/Applications/Alamelu Pi.app` passed `codesign --verify --deep --strict`.
- The rebuild/sign/replace evidence is sufficient: the report records an Alpi package rebuild, replacement of `/Applications/Alamelu Pi.app`, signing without exposing credential values, codesign identifier/authority, and an installed-app smoke launched from `/Applications/Alamelu Pi.app/Contents/MacOS/alpi` that observed `No Repository` with `specialKind: "no-repository"` and the expected picker labels.
