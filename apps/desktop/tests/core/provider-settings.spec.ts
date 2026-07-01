import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  stubNextOpenDialog,
} from "../helpers/electron-app";

test("settings lets the user save an API key for a built-in provider", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-api-key-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const allProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "All providers" }),
    });
    await allProviders.locator(".settings-disclosure__summary").click();
    const openAiRow = allProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^openai$/ }),
    });
    await expect(openAiRow).toContainText("API key");
    await openAiRow.getByRole("button", { name: "Set API key" }).click();

    const dialog = window.getByTestId("provider-api-key-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("openai API key").fill("test-openai-key");
    await dialog.getByRole("button", { name: "Set API key" }).click();
    await expect(dialog).toHaveCount(0);

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Connected" }),
    });
    await expect(connectedProviders).toContainText("openai");
    await expect(connectedProviders).toContainText("API key");
    await expect(connectedProviders.getByRole("button", { name: "Manage" })).toBeVisible();

    await window.getByRole("button", { name: "Models", exact: true }).click();
    const enabledModels = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Enabled models" }),
    });
    await expect(enabledModels).toContainText("openai/gpt-5");
    await expect(enabledModels).toContainText("openai/gpt-4o");
  } finally {
    await harness.close();
  }
});

test("settings shows environment-configured providers as managed externally", async () => {
  test.setTimeout(60_000);
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-env-key";

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-env-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5"],
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Connected" }),
    });
    const openAiRow = connectedProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^openai$/ }),
    });
    await expect(openAiRow).toContainText("Environment variable");
    await expect(openAiRow.getByRole("button", { name: "Managed externally" })).toBeDisabled();
  } finally {
    await harness.close();
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  }
});

test("settings keeps models.json provider overrides in the external-config state", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-models-json-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5"],
  });
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          openai: {
            apiKey: "test-openai-models-json-key",
            baseUrl: "https://api.openai.com/v1",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Connected" }),
    });
    const openAiRow = connectedProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^openai$/ }),
    });
    await expect(openAiRow).toContainText("Configured externally");
    await expect(openAiRow.getByRole("button", { name: "Managed externally" })).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("opening the first workspace from the empty state hydrates provider and model settings without refresh", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-first-workspace");
  await seedAgentDir(agentDir, {
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const emptyState = window.getByTestId("empty-state");
    await expect(emptyState).toBeVisible();

    await stubNextOpenDialog(harness, [workspacePath]);
    await emptyState.getByRole("button", { name: "Open first folder" }).click();

    await expect(emptyState).toHaveCount(0);
    await expect(window.getByTestId("workspace-list")).toContainText("provider-settings-first-workspace");
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();

    await window.keyboard.press(desktopShortcut(","));
    const settingsSurface = window.getByTestId("settings-surface");
    await expect(settingsSurface).toBeVisible();
    await expect(settingsSurface.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);

    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Connected" }),
    });
    await expect(connectedProviders).toContainText("openai");
    await expect(connectedProviders).toContainText("API key");

    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");

    const enabledModels = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Enabled models" }),
    });
    await expect(enabledModels).toContainText("openai/gpt-5");
    await expect(enabledModels).toContainText("openai/gpt-4o");
  } finally {
    await harness.close();
  }
});

test("provider login dialog completes a mocked browser OAuth flow from Settings", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-login-browser-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: {
      PI_APP_TEST_PROVIDER_LOGIN_FLOW: "1",
    },
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Providers", exact: true }).click();

    const signInProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Sign in" }),
    });
    const providerRow = signInProviders.locator(".settings-row").filter({ hasText: /anthropic/i }).first();
    await expect(providerRow.getByRole("button", { name: "Login" })).toBeVisible();
    await providerRow.getByRole("button", { name: "Login" }).click();

    const dialog = window.getByTestId("provider-login-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Browser login" }).click();

    await expect(providerRow.getByRole("button", { name: "Signing in..." })).toBeVisible();
    await expect(dialog.getByText("Paste the redirect URL or code below")).toBeVisible();
    await expect(dialog).toContainText("https://example.invalid/oauth");
    await dialog.getByLabel("Redirect URL or code").fill("https://localhost/callback?code=test-code");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog.getByText("Confirm test provider login")).toBeVisible();
    await dialog.getByLabel("Provider login response").fill("ok");
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(providerRow.getByRole("button", { name: "Login" })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("provider login dialog shows device code and cancels without live auth", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-login-device-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: {
      PI_APP_TEST_PROVIDER_LOGIN_FLOW: "1",
    },
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Providers", exact: true }).click();

    const signInProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Sign in" }),
    });
    const providerRow = signInProviders.locator(".settings-row").filter({ hasText: /openai|chatgpt|codex/i }).first();
    await expect(providerRow.getByRole("button", { name: "Login" })).toBeVisible();
    await providerRow.getByRole("button", { name: "Login" }).click();

    const dialog = window.getByTestId("provider-login-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Device code login" }).click();

    await expect(dialog.getByTestId("provider-login-device-code")).toHaveText("TEST-CODE");
    await expect(dialog).toContainText("https://example.invalid/device");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(providerRow.getByRole("button", { name: "Login" })).toBeVisible();
  } finally {
    await harness.close();
  }
});
