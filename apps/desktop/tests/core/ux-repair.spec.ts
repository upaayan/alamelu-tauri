import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

// Debt owed by the UX repair plan: each of these guards a defect that shipped once.
// All branded, because the unbranded (sdk) path cannot boot in this fork.

async function launchAlpi(workspaceName: string) {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace(workspaceName);
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });
  return { harness, workspacePath };
}

test("a rejected worktree thread keeps the prompt and explains itself", async () => {
  test.setTimeout(60_000);
  const { harness } = await launchAlpi("ux-repair-env-chip");

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "New thread" }).first().click();

    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("this prompt must survive a failed start");

    // Worktrees are unsupported under RPC, so the control must say so rather than
    // accept a click that throws.
    const worktreeChip = window.locator(".new-thread__environment", { hasText: "Worktree" }).first();
    await expect(worktreeChip).toBeDisabled();
    await expect(worktreeChip).toHaveAttribute("title", "Not available in this build");

    // The prompt is still there either way — the old bug wiped it on any failure.
    await expect(composer).toHaveValue("this prompt must survive a failed start");
  } finally {
    await harness.close();
  }
});

test("double-clicking Start creates exactly one thread", async () => {
  test.setTimeout(90_000);
  const { harness } = await launchAlpi("ux-repair-double-start");

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "New thread" }).first().click();
    await window.getByTestId("new-thread-composer").fill("only one thread please");

    const start = window.getByRole("button", { name: "Start thread" });
    await start.click();
    // The second click lands while the first start is still in flight.
    await start.click({ force: true }).catch(() => undefined);

    await expect
      .poll(async () => window.locator(".session-row").count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await window.waitForTimeout(2_000);
    expect(await window.locator(".session-row").count()).toBe(1);
  } finally {
    await harness.close();
  }
});

test("the model dropdown opens fully inside the window", async () => {
  test.setTimeout(60_000);
  const { harness } = await launchAlpi("ux-repair-dropdown");

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "New thread" }).first().click();

    const badge = window.locator(".new-thread__hint .model-selector__badge").first();
    await badge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toBeVisible();

    // The dropdown used to open downward from a bottom-anchored composer and clip.
    const box = await dropdown.boundingBox();
    const viewport = window.viewportSize() ?? (await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  } finally {
    await harness.close();
  }
});

test("/tree is offered now that the driver implements it", async () => {
  test.setTimeout(60_000);
  const { harness } = await launchAlpi("ux-repair-tree-command");

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "New thread" }).first().click();
    await window.getByTestId("new-thread-composer").fill("start a thread for the tree check");
    await window.getByRole("button", { name: "Start thread" }).click();

    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 30_000 });

    // Phase 3 hid /tree and /compact because the driver stubbed them out; Phase 5
    // implements both against pi, so the menu must offer them again.
    await composer.fill("/");
    const slashMenu = window.locator(".slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("/tree");
    await expect(slashMenu).toContainText("/compact");
  } finally {
    await harness.close();
  }
});
