import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  pasteTinyPng,
  seedAgentDir,
  seedTranscriptMessages,
} from "../helpers/electron-app";

test("new thread reuses composer behaviors for slash commands, image previews, and branding", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-composer-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    await expect(window.getByTestId("new-thread-logo")).toBeVisible();
    await expect(window.getByRole("heading", { name: "Let's build" })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveAttribute("placeholder", "Ask Alamelu Pi anything, use / for commands and skills");

    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await expect(modelBadge).toBeVisible();
    await expect(window.locator('.new-thread input[type="file"]')).toBeHidden();

    await composer.fill("/stat");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("/status");

    await composer.fill("Outline next steps /stat");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Outline next steps /status");

    await composer.fill("");
    await pasteTinyPng(window, "new-thread-image.png", "new-thread-composer");
    const chip = window.locator(".composer-attachment");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".composer-attachment__preview")).toBeVisible();
    await expect(chip.locator(".composer-attachment__name")).toContainText("new-thread-image.png");

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const transcript = await getSelectedTranscript(window);
        const userMessage = transcript?.transcript.find(
          (entry) => entry.kind === "message" && "role" in entry && entry.role === "user",
        );
        return userMessage?.attachments?.map((attachment) => attachment.kind).join(",") ?? "";
      }, { timeout: 15_000 })
      .toBe("image");
    await expect(window.locator(".timeline-item__attachment")).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".composer-attachment")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("new thread composer uses the lower canvas while keeping a small bottom gap", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("new-thread-spacing-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_GUI_BRAND: "alpi",
    },
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const metrics = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".canvas--new-thread");
      const hero = document.querySelector<HTMLElement>(".new-thread__hero");
      const composer = document.querySelector<HTMLElement>(".new-thread__composer");
      if (!canvas || !hero || !composer) {
        throw new Error("New-thread layout elements were unavailable");
      }

      const canvasBox = canvas.getBoundingClientRect();
      const heroBox = hero.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      return {
        bottomGap: Math.round(canvasBox.bottom - composerBox.bottom),
        heroGap: Math.round(composerBox.top - heroBox.bottom),
        composerCenterY: Math.round(composerBox.top + composerBox.height / 2),
        canvasCenterY: Math.round(canvasBox.top + canvasBox.height / 2),
      };
    });

    expect(metrics.composerCenterY).toBeGreaterThan(metrics.canvasCenterY);
    expect(metrics.bottomGap).toBeGreaterThanOrEqual(28);
    expect(metrics.bottomGap).toBeLessThanOrEqual(96);
    expect(metrics.heroGap).toBeGreaterThanOrEqual(18);
  } finally {
    await harness.close();
  }
});

test("thread content reserves room above horizontal scrollbars", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-scrollbar-clearance-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_GUI_BRAND: "alpi",
    },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Scrollbar clearance");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => [
        "```text",
        `last visible line ${"0123456789".repeat(90)}`,
        "```",
      ].join("\n"),
    });

    await expect(window.locator(".message__content pre[data-language='text']").last()).toBeVisible();

    const metrics = await window.evaluate(() => {
      const pane = document.querySelector<HTMLElement>("[data-testid='timeline-pane']");
      const codeBlocks = Array.from(document.querySelectorAll<HTMLElement>(".message__content pre[data-language='text']"));
      const codeBlock = codeBlocks.at(-1);
      if (!pane || !codeBlock) {
        throw new Error("Thread scrollbar clearance elements were unavailable");
      }

      const paneStyle = window.getComputedStyle(pane);
      const codeBlockStyle = window.getComputedStyle(codeBlock);
      return {
        panePaddingBottom: Number.parseFloat(paneStyle.paddingBottom),
        codeBlockPaddingBottom: Number.parseFloat(codeBlockStyle.paddingBottom),
        codeBlockScrollWidth: codeBlock.scrollWidth,
        codeBlockClientWidth: codeBlock.clientWidth,
      };
    });

    expect(metrics.panePaddingBottom).toBeGreaterThanOrEqual(16);
    expect(metrics.codeBlockPaddingBottom).toBeGreaterThanOrEqual(18);
    expect(metrics.codeBlockScrollWidth).toBeGreaterThan(metrics.codeBlockClientWidth);
  } finally {
    await harness.close();
  }
});

test("Alpi new thread can start from No Repository", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-real-repo-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_GUI_BRAND: "alpi",
    },
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const picker = window.locator(".new-thread__workspace");
    await expect(picker).toContainText("No Repository");
    await expect(picker).toContainText("New Workspace...");
    await picker.selectOption({ label: "No Repository" });

    await expect(window.getByRole("button", { name: "Local", exact: true })).toBeEnabled();
    await expect(window.getByRole("button", { name: "Worktree", exact: true })).toBeDisabled();

    await window.getByTestId("new-thread-composer").fill("start a no repository thread");
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return {
          activeView: state.activeView,
          selectedName: selected?.name,
          selectedKind: selected?.specialKind,
          lastError: state.lastError ?? "",
        };
      }, { timeout: 20_000 })
      .toEqual({
        activeView: "threads",
        selectedName: "No Repository",
        selectedKind: "no-repository",
        lastError: "",
      });
  } finally {
    await harness.close();
  }
});

test("new thread hides the onboarding notice after picking a thread model", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-no-default-workspace");
  await seedAgentDir(agentDir, { withDefaultModel: false });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const notice = window.getByTestId("model-onboarding-notice");
    const startButton = window.getByRole("button", { name: "Start thread" });
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();

    await window.getByTestId("new-thread-composer").fill("start a thread without a default");
    await expect(notice).toContainText("No default model set");
    await expect(modelBadge).toHaveText("Pick a model");
    await expect(startButton).toBeDisabled();

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toContainText("GPT-5");
    await expect(dropdown).toContainText("GPT-4o");
    const modelFilter = dropdown.locator(".model-selector__filter-input");
    await expect(modelFilter).toBeFocused();
    await modelFilter.fill("definitely-no-model");
    await expect(dropdown).toContainText("No matching models");
    await expect(modelBadge).toHaveText("Pick a model");
    await modelFilter.fill("4o");
    await expect(dropdown).toContainText("GPT-4o");
    await expect(dropdown).not.toContainText("GPT-5");
    await dropdown.getByRole("button", { name: /GPT-4o/ }).click();

    await expect(modelBadge).toHaveText("openai:gpt-4o");
    await expect(startButton).toBeEnabled();
    await expect(notice).toHaveCount(0);

    await startButton.click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("model-onboarding-notice")).toHaveCount(0);

    const composer = window.getByTestId("composer");
    await composer.fill("continue");
    await expect(window.getByTestId("send")).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("new thread routes disabled-model recovery to settings models", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-empty-models-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();

    await window.evaluate(async ({ workspaceId }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.setScopedModelPatterns(workspaceId, ["fake-provider/fake-model"]);
    }, { workspaceId: selectedWorkspaceId });

    await window.getByTestId("new-thread-composer").fill("try to start with all models disabled");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await expect(modelBadge).toBeVisible();
    await expect(modelBadge).toHaveText("No models available");
    await expect(window.getByTestId("model-onboarding-notice")).toContainText("Settings > Models");
    await expect(window.getByRole("button", { name: "Start thread" })).toBeDisabled();

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toContainText("No models available");
    await expect(dropdown).not.toContainText("Open Settings > Models");

    await window.getByTestId("model-onboarding-notice").getByRole("button", { name: "Open Settings > Models" }).click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Models");
  } finally {
    await harness.close();
  }
});

test("refreshing after a provider becomes available auto-enables that provider's models", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-provider-connect-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["fake-provider/fake-model"],
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    const notice = window.getByTestId("model-onboarding-notice");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await composer.fill("connect provider");
    await expect(modelBadge).toHaveText("No models available");
    await expect(notice).toContainText("Open Settings > Providers");

    await writeFile(
      join(agentDir, "auth.json"),
      `${JSON.stringify({ openai: { type: "api_key", key: "test-openai-key" } }, null, 2)}\n`,
      "utf8",
    );

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();
    await window.evaluate(async ({ workspaceId }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.refreshRuntime(workspaceId);
    }, { workspaceId: selectedWorkspaceId });

    await expect(modelBadge).toHaveText("Pick a model");
    await expect(notice).toContainText("No default model set");

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toContainText("GPT-5");
    await expect(dropdown).toContainText("GPT-4o");
  } finally {
    await harness.close();
  }
});

test("settings do not show stale enabled-model pills when no providers are connected", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-no-provider-settings-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    await window.getByTestId("new-thread-composer").fill("check no provider settings");
    await expect(window.getByTestId("model-onboarding-notice")).toContainText("Open Settings > Providers");

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");

    const enabledModelsSection = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Enabled models" }),
    });
    await expect(enabledModelsSection).toContainText("No connected models available yet.");
    await expect(enabledModelsSection).not.toContainText("openai/gpt-5");
    await expect(enabledModelsSection).not.toContainText("openai/gpt-4o");
    await expect(enabledModelsSection.locator(".settings-disclosure__summary")).toContainText("0");
  } finally {
    await harness.close();
  }
});
