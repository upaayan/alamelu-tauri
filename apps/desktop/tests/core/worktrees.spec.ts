import { expect, test } from "@playwright/test";
import {
  assertExists,
  createNamedThread,
  createSessionViaIpc,
  getDesktopState,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

// DISABLED on 2026-11-07, off by design: Alamelu Pi's only session driver (pi RPC) has no worktrees
// (`supportsWorktrees = false` in apps/desktop/electron/rpc-desktop-driver.ts; alpi_ux_repair_plan.md
// §1.4(d): "only honest disabling"). createWorktree and worktree threads are rejected, so these tests can
// never pass. Since 2026-11-08 the workspace menu no longer offers "Create permanent worktree". The off
// state, chip and menu, is checked by ux-repair.spec.ts ("a rejected worktree thread keeps the prompt and
// explains itself").

test.skip("creates and selects a worktree-backed workspace from the desktop UI", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-live-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    await window.getByRole("button", { name: "Create permanent worktree" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree" && (state.worktreesByWorkspace[rootWorkspace.id]?.length ?? 0) > 0;
      })
      .toBe(true);

    const stateAfterCreate = await getDesktopState(window);
    const worktreeWorkspace = stateAfterCreate.workspaces.find(
      (workspace) => workspace.id === stateAfterCreate.selectedWorkspaceId,
    );
    assertExists(worktreeWorkspace, "Expected the selected workspace to be the newly created worktree");
    if (worktreeWorkspace.kind !== "worktree") {
      throw new Error("Expected the selected workspace to be the newly created worktree");
    }

    await expect(window.locator(".environment-picker__button")).toContainText(worktreeWorkspace.name);
    await expect(window.locator(".empty-panel")).toContainText("Create a thread for this folder");
    await expect(window.locator(".empty-panel")).not.toContainText("/Users/");

    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
    await expect(window.getByRole("button", { name: "Local", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "Worktree", exact: true })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test.skip("shows a worktree icon in the sidebar without a local text badge", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-sidebar-indicator");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Local thread");
    const localRow = window.locator(".session-row", { hasText: "Local thread" });
    await expect(localRow).toBeVisible();
    await expect(localRow).toHaveAttribute("data-sidebar-indicator", "none");
    await expect(localRow.locator(".session-row__workspace-icon")).toHaveCount(0);

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    await window.getByRole("button", { name: "Create permanent worktree" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    const stateAfterCreate = await getDesktopState(window);
    const firstWorktree = stateAfterCreate.workspaces.find(
      (workspace) => workspace.id === stateAfterCreate.selectedWorkspaceId,
    );
    assertExists(firstWorktree, "Expected selected worktree workspace");

    await createSessionViaIpc(window, firstWorktree.id, "Worktree thread");
    const worktreeRow = window.locator(".session-row", { hasText: "Worktree thread" });
    await expect(worktreeRow).toBeVisible();
    await expect(worktreeRow).toHaveAttribute("data-sidebar-indicator", "none");
    await expect(worktreeRow.locator(".session-row__workspace-icon")).toHaveCount(1);
    await expect(window.getByTestId("workspace-list")).not.toContainText("Local project");
  } finally {
    await harness.close();
  }
});

test.skip("keeps orphaned worktree workspaces visible after removing the root workspace", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-orphan-visibility");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    await window.getByRole("button", { name: "Create permanent worktree" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    const createdState = await getDesktopState(window);
    const createdWorkspace = createdState.workspaces.find((workspace) => workspace.id === createdState.selectedWorkspaceId);
    assertExists(createdWorkspace, "Expected created worktree workspace");

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    window.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await window.getByRole("button", { name: "Remove" }).click();

    await expect(window.getByTestId("empty-state")).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.some((workspace) => workspace.id === createdWorkspace.id);
      })
      .toBe(true);
  } finally {
    await harness.close();
  }
});
