import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

// Debt owed by the UX repair plan: each of these guards a defect that shipped once.
// All branded, because the unbranded (sdk) path cannot boot in this fork.

async function launchAlpi(workspaceName: string, seed?: (agentDir: string) => Promise<void>) {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace(workspaceName);
  await seedAgentDir(agentDir);
  await seed?.(agentDir);
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

    // Nor does the workspace menu offer a worktree it cannot make (2026-11-08).
    await window.getByRole("button", { name: "Workspace actions for ux-repair-env-chip" }).click();
    await expect(window.locator(".workspace-menu")).toContainText("Open folder");
    await expect(window.getByRole("button", { name: "Create permanent worktree" })).toHaveCount(0);
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

test("/tree is turned off: not offered, and refused when typed; /compact is still offered", async () => {
  test.setTimeout(60_000);
  // A skill whose name contains "tree", like Sudhir's using-git-worktrees, puts an entry in the "/tree" menu.
  const { harness } = await launchAlpi("ux-repair-tree-command", async (agentDir) => {
    await mkdir(join(agentDir, "skills", "using-git-worktrees"), { recursive: true });
    await writeFile(
      join(agentDir, "skills", "using-git-worktrees", "SKILL.md"),
      "---\nname: using-git-worktrees\ndescription: Use this skill when work needs an isolated git worktree.\n---\n\n# Using git worktrees\n",
      "utf8",
    );
  });

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "New thread" }).first().click();
    await window.getByTestId("new-thread-composer").fill("start a thread for the tree check");
    await window.getByRole("button", { name: "Start thread" }).click();

    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 30_000 });

    // Phase 5 implemented /tree and /compact against pi. /tree was turned off on 2026-11-07
    // (Sudhir: "I do not need the tree command"); the reasons are in tree-command.spec.ts.
    await composer.fill("/");
    const slashMenu = window.locator(".slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("/compact");
    await expect(slashMenu).not.toContainText("/tree");

    // An exact "/tree" + Enter is refused, even with that skill in the menu (2026-11-08).
    await composer.fill("/tree");
    await expect(slashMenu).toContainText("using-git-worktrees");
    await composer.press("Enter");
    await expect(window.getByText("/tree is turned off in Alamelu Pi.")).toBeVisible();
    await expect(composer).toHaveValue("/tree");
    await expect(window.getByTestId("tree-modal")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("sidebar toggle button collapses and re-expands the sidebar via mouse clicks", async () => {
  test.setTimeout(60_000);
  const { harness } = await launchAlpi("ux-repair-sidebar-toggle");

  try {
    const window = await harness.firstWindow();
    const toggleButton = window.getByTestId("sidebar-toggle");
    await expect(toggleButton).toBeVisible();
    await expect(window.locator(".sidebar")).toBeVisible();

    // 1. Click toggle button to collapse sidebar
    await toggleButton.click();
    await expect(window.locator(".sidebar")).toHaveCount(0);
    await expect(toggleButton).toBeVisible();

    // Verify app-regions when collapsed: toggle button must be no-drag and inside topbar
    const collapsedRegions = await window.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>("[data-testid='topbar']");
      const toggle = document.querySelector<HTMLElement>("[data-testid='sidebar-toggle']");
      return {
        topbarRegion: topbar ? getComputedStyle(topbar).getPropertyValue("-webkit-app-region") : "",
        toggleRegion: toggle ? getComputedStyle(toggle).getPropertyValue("-webkit-app-region") : "",
        isToggleInsideTopbar: topbar ? Boolean(topbar.querySelector("[data-testid='sidebar-toggle']")) : false,
      };
    });
    expect(collapsedRegions.topbarRegion).toBe("drag");
    expect(collapsedRegions.toggleRegion).toBe("no-drag");
    expect(collapsedRegions.isToggleInsideTopbar).toBe(true);

    // 2. Click toggle button while collapsed to re-expand sidebar
    await toggleButton.click();
    await expect(window.locator(".sidebar")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("topbar open/add folder icon displays shortcut tooltip on mouseover", async () => {
  test.setTimeout(60_000);
  const { harness } = await launchAlpi("ux-repair-topbar-folder-tooltip");

  try {
    const window = await harness.firstWindow();
    const folderActionWrap = window.locator(".topbar__actions .shortcut-tooltip-wrap").last();
    const folderButton = folderActionWrap.locator("button");
    const folderTooltip = folderActionWrap.locator(".shortcut-tooltip");

    await expect(folderButton).toBeVisible();
    await expect(folderTooltip).toBeAttached();
    await expect(folderTooltip).toContainText("Open folder");
    const shortcutExpected = process.platform === "darwin" ? "⌘O" : "Ctrl+O";
    await expect(folderTooltip.locator("kbd")).toHaveText(shortcutExpected);

    // Tooltip starts transparent (opacity: 0)
    await expect(folderTooltip).toHaveCSS("opacity", "0");

    // Hovering reveals tooltip (opacity: 1)
    await folderActionWrap.hover();
    await expect(folderTooltip).toHaveCSS("opacity", "1");
  } finally {
    await harness.close();
  }
});

test("typing the letter o in composer does not trigger open folder", async () => {
  test.setTimeout(60_000);
  const { harness } = await launchAlpi("ux-repair-typing-o");

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "New thread" }).first().click();

    const composer = window.getByTestId("new-thread-composer");
    await composer.click();
    await composer.pressSequentially("hello world");
    await expect(composer).toHaveValue("hello world");
  } finally {
    await harness.close();
  }
});
