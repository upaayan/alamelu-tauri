import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertExists,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("supports workspace rename and remove from the sidebar menu", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("workspace-menu-a");
  const workspaceB = await makeWorkspace("workspace-menu-b");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspaceA);
    assertExists(workspace, "Expected first workspace");

    await window.getByRole("button", { name: `Workspace actions for ${basename(workspaceA)}` }).click();
    const workspaceMenu = window.locator(".workspace-menu").last();
    await expect(workspaceMenu.getByRole("button", { name: "Open folder" })).toBeVisible();
    await expect(workspaceMenu.getByRole("button", { name: "Edit name" })).toBeVisible();
    await expect(workspaceMenu.getByRole("button", { name: "Remove" })).toBeVisible();

    await workspaceMenu.getByRole("button", { name: "Edit name" }).click();
    const renameInput = window.getByLabel(`Rename ${basename(workspaceA)}`);
    await renameInput.fill("Renamed workspace");
    await window.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => {
      const latest = await getDesktopState(window);
      return latest.workspaces.find((entry) => entry.id === workspace.id)?.name;
    }).toBe("Renamed workspace");

    window.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await window.getByRole("button", { name: "Workspace actions for Renamed workspace" }).click();
    await window.getByRole("button", { name: "Remove" }).click();

    await expect.poll(async () => {
      const latest = await getDesktopState(window);
      return latest.workspaces.some((entry) => entry.id === workspace.id);
    }).toBe(false);
  } finally {
    await harness.close();
  }
});

test("hides Alpi helper workspaces while preserving them in state", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const visibleWorkspace = await makeWorkspace("workspace-menu-visible");
  const providerLoginWorkspace = await makeWorkspace("alpi-provider-login-workspace-test");
  const stateWorkspace = await makeWorkspace("alpi-state-workspace-test");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [providerLoginWorkspace, stateWorkspace, visibleWorkspace],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, visibleWorkspace);
    await waitForWorkspaceByPath(window, providerLoginWorkspace);
    await waitForWorkspaceByPath(window, stateWorkspace);

    const state = await getDesktopState(window);
    expect(state.workspaces.find((entry) => entry.path === providerLoginWorkspace)?.specialKind).toBe("system");
    expect(state.workspaces.find((entry) => entry.path === stateWorkspace)?.specialKind).toBe("system");
    expect(state.workspaces.find((entry) => entry.path === visibleWorkspace)?.specialKind).toBeUndefined();

    const workspaceList = window.getByTestId("workspace-list");
    await expect(workspaceList).toContainText(basename(visibleWorkspace));
    await expect(workspaceList).not.toContainText("alpi-provider-login-workspace-test");
    await expect(workspaceList).not.toContainText("alpi-state-workspace-test");

    await window.locator(".sidebar").getByRole("button", { name: "New thread", exact: true }).click();
    const picker = window.locator(".new-thread__workspace");
    await expect(picker).toContainText(basename(visibleWorkspace));
    await expect(picker).not.toContainText("alpi-provider-login-workspace-test");
    await expect(picker).not.toContainText("alpi-state-workspace-test");
  } finally {
    await harness.close();
  }
});
