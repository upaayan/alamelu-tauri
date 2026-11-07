import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedComposerHistorySessionFixture,
  selectSession,
  selectSessionAndWaitForDraft,
} from "../helpers/electron-app";

function parseRgb(color: string): [number, number, number] {
  const channels = color.match(/\d+(?:\.\d+)?/g);
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported color value: ${color}`);
  }
  return [Number(channels[0]), Number(channels[1]), Number(channels[2])];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linearized = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linearized[0] + 0.7152 * linearized[1] + 0.0722 * linearized[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseRgb(foreground));
  const backgroundLuminance = relativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test("supports keyboard shortcuts, slash menus, and topbar controls through the user surface", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("controls-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Controls session");
    await expect(window.locator(".topbar__session")).toHaveText("Controls session");

    const composer = window.getByTestId("composer");

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toContainText("General");

    await window.keyboard.press(desktopShortcut("Shift+O"));
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
    await expect(window.getByTestId("new-thread-composer")).toBeFocused();

    await selectSession(window, "Controls session");
    await expect(composer).toBeFocused();

    await composer.fill("/stat");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    const slashMenuBox = await slashMenu.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(slashMenuBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect((slashMenuBox?.y ?? 0) + (slashMenuBox?.height ?? 0)).toBeLessThanOrEqual((composerBox?.y ?? 0) + 2);

    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("/status");
    await composer.press("Enter");
    await expect(window.getByTestId("transcript")).toContainText(/Model |No session overrides set/);
    await expect(composer).toHaveValue("");

    await composer.fill("Need a quick check /stat");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Need a quick check /status");

    await composer.fill("/thinking");
    const optionsMenu = window.getByTestId("slash-options-menu");
    await expect(optionsMenu).toBeVisible();
    await expect(optionsMenu).toContainText("Low");
    await expect(optionsMenu).toContainText("Extra High");
    await composer.press("ArrowDown");
    await composer.press("ArrowDown");
    await composer.press("Enter");
    await expect(optionsMenu).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText("Thinking set to high");
    await expect(window.locator(".composer__hint")).toContainText("high");

    await composer.fill("Keep the draft /thinking");
    await expect(optionsMenu).toBeVisible();
    await composer.press("ArrowDown");
    await composer.press("Enter");
    await expect(optionsMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Keep the draft /thinking medium");

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();
    await window.evaluate(async ({ workspaceId }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.setScopedModelPatterns(workspaceId, ["fake-provider/fake-model"]);
    }, { workspaceId: selectedWorkspaceId });

    await composer.fill("/model");
    await expect(optionsMenu).toBeVisible();
    await expect(optionsMenu).toContainText("No models available");
    await expect(optionsMenu).toContainText("Open Settings > Models to enable models.");
    await composer.fill("continue");
    await expect(optionsMenu).toHaveCount(0);

    const onboardingNotice = window.getByTestId("model-onboarding-notice");
    await expect(onboardingNotice).toContainText("No models available");
    await expect(onboardingNotice).toContainText("Settings > Models");
    await expect(window.getByTestId("send")).toBeDisabled();

    await onboardingNotice.getByRole("button", { name: "Open Settings > Models" }).click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Models");
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("send")).toBeDisabled();

    const appRegions = await window.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>("[data-testid='topbar']");
      const addFolder = document.querySelector<HTMLElement>(".topbar__actions button");
      return {
        topbar: topbar ? getComputedStyle(topbar).getPropertyValue("-webkit-app-region") : "",
        addFolder: addFolder ? getComputedStyle(addFolder).getPropertyValue("-webkit-app-region") : "",
      };
    });
    expect(appRegions.topbar).toBe("drag");
    expect(appRegions.addFolder).toBe("no-drag");

    // A real maximise would show this hidden background window on screen, so the window keeps a
    // stand-in flag: the test proves the double-click reaches the app's real toggle handler, not that
    // the operating system maximises the window.
    await harness.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (!browserWindow) {
        throw new Error("No desktop window");
      }
      let maximized = false;
      browserWindow.isMaximized = () => maximized;
      browserWindow.maximize = () => {
        maximized = true;
      };
      browserWindow.unmaximize = () => {
        maximized = false;
      };
    });
    const maximizedBefore = await harness.electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false;
    });
    // Double-click an empty part of the bar, just right of the left button group (the handler ignores buttons).
    const emptyTopbarPoint = await window.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>("[data-testid='topbar']");
      const leftGroup = document.querySelector<HTMLElement>(".topbar__left");
      if (!topbar || !leftGroup) {
        throw new Error("Topbar layout is missing");
      }
      const bar = topbar.getBoundingClientRect();
      const x = leftGroup.getBoundingClientRect().right + 24 - bar.left;
      const y = bar.height / 2;
      const hit = document.elementFromPoint(bar.left + x, bar.top + y);
      return {
        x,
        y,
        isEmptyBar: Boolean(hit && topbar.contains(hit) && !hit.closest("button, .topbar__actions, .topbar__left")),
      };
    });
    expect(emptyTopbarPoint.isEmptyBar).toBe(true);
    await window.getByTestId("topbar").dblclick({ position: { x: emptyTopbarPoint.x, y: emptyTopbarPoint.y } });
    await expect
      .poll(() =>
        harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false),
      )
      .toBe(!maximizedBefore);
  } finally {
    await harness.close();
  }
});

test("dark mode keeps the send button visible before and after typing", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("dark-send-button-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Dark send button session");

    await window.keyboard.press(desktopShortcut(","));
    const settingsSurface = window.getByTestId("settings-surface");
    await expect(settingsSurface).toBeVisible();
    await settingsSurface.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Appearance");
    await settingsSurface.locator(".settings-row", { hasText: "Dark" }).locator('input[type="radio"]').click();
    await expect
      .poll(() => window.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(true);

    await settingsSurface.getByRole("button", { name: "Back to app" }).click();
    await selectSessionAndWaitForDraft(window, "Dark send button session");

    const sendButton = window.getByTestId("send");
    await expect(sendButton).toBeDisabled();
    await expect
      .poll(async () => {
        const styles = await sendButton.evaluate((button) => {
          const computed = getComputedStyle(button);
          return {
            backgroundColor: computed.backgroundColor,
            color: computed.color,
          };
        });
        return contrastRatio(styles.color, styles.backgroundColor);
      })
      .toBeGreaterThan(3);

    await window.getByTestId("composer").fill("make the arrow visible");
    await expect(sendButton).toBeEnabled();
    await expect
      .poll(async () => {
        const styles = await sendButton.evaluate((button) => {
          const computed = getComputedStyle(button);
          return {
            backgroundColor: computed.backgroundColor,
            color: computed.color,
          };
        });
        return contrastRatio(styles.color, styles.backgroundColor);
      })
      .toBeGreaterThan(4.5);
  } finally {
    await harness.close();
  }
});

test("Up and Down in an empty chat box recall this thread's earlier messages", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("composer-history-workspace");
  await seedAgentDir(agentDir);
  await seedComposerHistorySessionFixture(agentDir, workspacePath);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi", PI_GUI_DRIVER: "rpc" },
  });

  try {
    const window = await harness.firstWindow();
    // Workspaces start collapsed in the sidebar; expand this one so its thread row can be clicked.
    await window.locator(".workspace-row__select", { hasText: "composer-history-workspace" }).click();
    await selectSessionAndWaitForDraft(window, "Composer history fixture");
    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("First question");
    await expect(transcript).toContainText("Second question");

    const composer = window.getByTestId("composer");
    await expect(composer).toHaveValue("");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("Second question");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("First question");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("First question");
    await composer.press("ArrowDown");
    await expect(composer).toHaveValue("Second question");
    await composer.press("ArrowDown");
    await expect(composer).toHaveValue("");

    // Typed text is left alone.
    await composer.fill("typed text");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("typed text");
    await composer.fill("");

    // Recall once and let the app save it as this thread's draft.
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("Second question");
    await expect.poll(async () => (await getDesktopState(window)).composerDraft).toBe("Second question");

    // Another thread never shows this thread's messages.
    await createNamedThread(window, "Empty history session");
    await expect(window.locator(".topbar__session")).toHaveText("Empty history session");
    await expect(composer).toHaveValue("");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("");

    // Back in the first thread, the restored draft does not keep recalling: Up stays put.
    await selectSessionAndWaitForDraft(window, "Composer history fixture");
    await expect(composer).toHaveValue("Second question");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("Second question");
  } finally {
    await harness.close();
  }
});
