import { basename, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createNamedThread, emitTestSessionEvent, getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace, waitForWorkspaceByPath } from "../helpers/electron-app";

async function expandRepo(page: Page, name: string) {
  const group = page.locator(".workspace-group").filter({ has: page.locator(".workspace-row__name", { hasText: name }) });
  if (!(await group.locator(".session-list").count())) await group.locator(".workspace-row__select").click();
  return group;
}

async function expectCenteredTitle(page: Page) {
  const error = await page.locator(".topbar__title").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return Math.abs(rect.x + rect.width / 2 - window.innerWidth / 2);
  });
  expect(error).toBeLessThanOrEqual(1);
}

test("approved display: aligned controls, direct drafts, four-row limits and Others last", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const alphaPath = await makeWorkspace("display-alpha");
  const betaPath = await makeWorkspace("display-beta");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [alphaPath, betaPath], testMode: "background" });
  try {
    const page = await harness.firstWindow();
    const alpha = await waitForWorkspaceByPath(page, alphaPath);
    const beta = await waitForWorkspaceByPath(page, betaPath);
    const others = (await getDesktopState(page)).workspaces.find((w) => w.specialKind === "no-repository")!;
    expect(others).toBeTruthy();
    const brand = page.getByRole("button", { name: "Alamelu Pi", exact: true });
    await expect(brand).toHaveAttribute("aria-expanded", "false");
    await expect(brand.locator("svg")).toHaveCount(0);
    await expect(page.locator(".sidebar__nav")).toHaveCount(0);
    await brand.click();
    await expect(page.locator(".sidebar__nav-item")).toHaveText(["Skills", "Extensions", "Settings"]);
    await brand.click();
    await expect(page.getByRole("button", { name: "Threads", exact: true })).toHaveCount(0);
    await expect(page.locator(".sidebar .section__head")).toHaveCount(0);
    for (const workspace of [alpha, beta, others]) {
      for (let i = 1; i <= 5; i++) await createNamedThread(page, `${workspace.id === others.id ? 'Others' : workspace.name} item ${i}`, { workspaceName: workspace.name });
    }
    for (const name of [alpha.name, beta.name, "Others"]) {
      const group = await expandRepo(page, name);
      await expect(group.locator(".session-row")).toHaveCount(4);
      await group.getByRole("button", { name: "Show more", exact: true }).click();
      await expect(group.locator(".session-row")).toHaveCount(5);
      await group.getByRole("button", { name: "Show less", exact: true }).click();
      await expect(group.locator(".session-row")).toHaveCount(4);
    }
    const updated = (await getDesktopState(page)).workspaces.find((w) => w.id === alpha.id)!.sessions[0]!;
    const ref = { workspaceId: alpha.id, sessionId: updated.id };
    const timestamp = new Date(Date.now() + 1_000).toISOString();
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated", sessionRef: ref, timestamp,
      snapshot: { ref, workspace: { workspaceId: alpha.id, path: alpha.path, displayName: alpha.name }, title: updated.title, status: "idle", updatedAt: timestamp },
    });
    const dot = page.locator(".sidebar-unseen-dot");
    await expect(dot).toBeVisible();
    expect(await dot.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
    const centers = await page.locator(".sidebar__new, .workspace-row__new").evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect(); return r.x + r.width / 2;
    }));
    expect(centers.every((x) => Math.abs(x - centers[0]) <= 1)).toBe(true);
    await expect(page.locator(".workspace-group").last().locator(".workspace-row__name")).toHaveText("Others");
    for (const workspace of [alpha, beta, others]) {
      const name = workspace.id === others.id ? "Others" : workspace.name;
      await page.getByRole("button", { name: `New thread in ${name}`, exact: true }).click();
      await expect(page.getByTestId("new-thread-composer")).toBeVisible();
      await expect(page.locator(".new-thread__workspace")).toHaveValue(workspace.id);
      await expect(page.locator(".topbar__workspace")).toHaveText(name);
      await expect(page.locator(".topbar__session")).toHaveText("New Thread");
      await expect(brand).toHaveAttribute("aria-expanded", "false");
    }
    expect((await page.locator(".new-thread__workspace option").allTextContents()).slice(-2).map((s) => s.trim())).toEqual(["Others ( No Workspace )", "New Workspace..."]);
    await expectCenteredTitle(page);
    const separator = page.getByRole("separator", { name: "Resize thread sidebar" });
    const box = (await separator.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 150);
    await page.mouse.down(); await page.mouse.move(box.x + 75, box.y + 150); await page.mouse.up();
    await expectCenteredTitle(page);
    await page.getByTestId("sidebar-toggle").click();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expectCenteredTitle(page);
    await page.getByRole("button", { name: "Search chats", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Search chats", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("sidebar-toggle").click();
    await page.getByRole("button", { name: "Show recent activity", exact: true }).click();
    await expect(page.locator(".sidebar-timeline")).toBeVisible();
    await page.getByRole("button", { name: "Show projects", exact: true }).click();
    await expect(page.locator(".workspace-group").last().locator(".workspace-row__name")).toHaveText("Others");
    const first = page.getByRole("button", { name: alpha.name, exact: true });
    const second = page.getByRole("button", { name: beta.name, exact: true });
    await first.dragTo(second);
    await expect(page.locator(".workspace-group").last().locator(".workspace-row__name")).toHaveText("Others");
  } finally { await harness.close(); }
});

test("reading an older cold-opened session preserves recency; an explicit update promotes it", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("read-not-update");
  const firstRun = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  let before: Array<{ id: string; title: string; updatedAt: string }> = [];
  try {
    const page = await firstRun.firstWindow();
    const workspace = await waitForWorkspaceByPath(page, workspacePath);
    await createNamedThread(page, "Older conversation", { workspaceName: workspace.name });
    await createNamedThread(page, "Newer conversation", { workspaceName: workspace.name });
    await expandRepo(page, workspace.name);
    before = (await getDesktopState(page)).workspaces.find((w) => w.id === workspace.id)!.sessions.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    expect(before).toHaveLength(2);
    await expect(page.locator(".session-row__title").first()).toHaveText("Newer conversation");
    // Retain the original warm post-creation idle-stability regression check.
    await page.waitForTimeout(500);
    expect((await getDesktopState(page)).workspaces.find((w) => w.id === workspace.id)!.sessions.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))).toEqual(before);
    await expect(page.locator(".session-row__title").first()).toHaveText("Newer conversation");
  } finally { await firstRun.close(); }
  // Pi does not save an empty newly created conversation until it has entries.
  // Supply stored session fixtures so this checks a genuine cold open, not an absent-file error.
  const sessionDir = join(userDataDir, "sessions");
  await mkdir(sessionDir, { recursive: true });
  for (const session of before) {
    await writeFile(join(sessionDir, `stored_${session.id}.jsonl`), [
      { type: "session", version: 3, id: session.id, timestamp: session.updatedAt, cwd: workspacePath },
      { type: "session_info", id: "aabbccdd", parentId: null, timestamp: session.updatedAt, name: session.title },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  }
  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const page = await secondRun.firstWindow();
    const workspace = await waitForWorkspaceByPath(page, workspacePath);
    const group = await expandRepo(page, basename(workspacePath));
    await group.locator(".session-row__select", { hasText: "Older conversation" }).click();
    await expect(page.locator(".topbar__session")).toHaveText("Older conversation");
    await expect(page.getByTestId("composer")).toBeVisible();
    await expect.poll(async () => (await getDesktopState(page)).lastError).toBeFalsy();
    await expect.poll(async () => (await getDesktopState(page)).workspaces.find((w) => w.id === workspace.id)!.sessions.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))).toEqual(before);
    await expect(group.locator(".session-row__title").first()).toHaveText("Newer conversation");
    await page.getByRole("button", { name: "Search chats", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search chats", exact: true }).fill("Older conversation");
    await page.locator(".search-panel-result", { hasText: "Older conversation" }).click();
    await expect(page.locator(".topbar__session")).toHaveText("Older conversation");
    await expect(group.locator(".session-row__title").first()).toHaveText("Newer conversation");
    // Rename is a real session update, exercised without a live provider request.
    await group.locator(".session-row__select", { hasText: "Older conversation" }).click({ button: "right" });
    await group.getByRole("textbox", { name: "Rename Older conversation", exact: true }).fill("Updated conversation");
    await group.getByRole("button", { name: "Save", exact: true }).click();
    await expect(group.locator(".session-row__title").first()).toHaveText("Updated conversation");
    const updated = (await getDesktopState(page)).workspaces.find((w) => w.id === workspace.id)!.sessions.find((s) => s.title === "Updated conversation")!;
    expect(updated.updatedAt > before.find((s) => s.title === "Older conversation")!.updatedAt).toBe(true);
  } finally { await secondRun.close(); }
});
