import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const defaultAppBundle = path.join(desktopDir, "release-alpi", "mac-arm64", "alpi.app");
const defaultExecutable = path.join(defaultAppBundle, "Contents", "MacOS", "alpi");
const executablePath = path.resolve(process.env.ALPI_SMOKE_EXECUTABLE ?? defaultExecutable);
const sourceUserDataDir = expandHome(
  process.env.ALPI_SMOKE_USER_DATA_SOURCE ?? "~/Library/Application Support/Alamelu Pi",
);
const agentDir = expandHome(process.env.ALPI_SMOKE_AGENT_DIR ?? "~/.pi/agent");
const fallbackWorkspacePath = expandHome(process.env.ALPI_SMOKE_WORKSPACE ?? "~/playground/alamelu");
const tempRoot = mkdtempSync(path.join(tmpdir(), "alpi-packaged-candidate-"));
const tempUserDataDir = path.join(tempRoot, "Alamelu Pi");
const copiedEntries = [];

try {
  assert.equal(existsSync(executablePath), true, `Packaged Alpi executable not found: ${executablePath}`);
  assert.equal(existsSync(sourceUserDataDir), true, `Source Alamelu Pi userData not found: ${sourceUserDataDir}`);
  assert.equal(existsSync(agentDir), true, `Installed Pi agent dir not found: ${agentDir}`);

  await mkdir(tempUserDataDir, { recursive: true });
  for (const entryName of ["catalogs.json", "ui-state.json", "transcripts", "sessions", "attachments"]) {
    const sourcePath = path.join(sourceUserDataDir, entryName);
    if (!existsSync(sourcePath)) {
      continue;
    }
    await cp(sourcePath, path.join(tempUserDataDir, entryName), { recursive: true });
    copiedEntries.push(entryName);
  }

  const app = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    args: [],
    env: {
      ...process.env,
      PI_APP_USER_DATA_DIR: tempUserDataDir,
      PI_GUI_USER_DATA_DIR: tempUserDataDir,
      PI_CODING_AGENT_DIR: agentDir,
      PI_APP_TEST_MODE: "background",
      PI_APP_OPEN_DEVTOOLS: "0",
      ALPI_BOOT_LOG: "1",
    },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => Boolean(window.piApp), undefined, { timeout: 30_000 });

    const appPaths = await app.evaluate(({ app: electronApp }) => ({
      name: electronApp.getName(),
      userData: electronApp.getPath("userData"),
    }));
    assert.equal(appPaths.name, "Alamelu Pi");
    assert.equal(realpathSync(appPaths.userData), realpathSync(tempUserDataDir));

    let state = await page.evaluate(() => window.piApp.getState());
    if (state.workspaces.length === 0) {
      assert.equal(existsSync(fallbackWorkspacePath), true, `No copied workspaces and fallback missing: ${fallbackWorkspacePath}`);
      state = await page.evaluate((workspacePath) => window.piApp.addWorkspacePath(workspacePath), fallbackWorkspacePath);
    }

    let workspace =
      state.workspaces.find((candidate) => candidate.path === fallbackWorkspacePath) ??
      state.workspaces.find((candidate) => existsSync(candidate.path));
    if (!workspace) {
      assert.equal(existsSync(fallbackWorkspacePath), true, `No usable copied workspaces and fallback missing: ${fallbackWorkspacePath}`);
      state = await page.evaluate((workspacePath) => window.piApp.addWorkspacePath(workspacePath), fallbackWorkspacePath);
      workspace = state.workspaces.find((candidate) => candidate.path === fallbackWorkspacePath);
    }
    assert.ok(workspace, "Expected at least one workspace from copied catalog state");

    state = await page.evaluate((workspaceId) => window.piApp.refreshRuntime(workspaceId), workspace.id);
    await page.waitForFunction(
      (workspaceId) =>
        window.piApp.getState().then((currentState) =>
          Boolean(currentState.runtimeByWorkspace[workspaceId]?.models?.some((model) =>
            model.providerId === "zai" && model.modelId === "glm-5.2",
          )),
        ),
      workspace.id,
      { timeout: 30_000 },
    );
    state = await page.evaluate(() => window.piApp.getState());
    const runtime = state.runtimeByWorkspace[workspace.id];
    assert.ok(runtime, `Expected runtime snapshot for workspace ${workspace.id}`);
    assert.equal(
      runtime.models.some((model) => model.providerId === "zai" && model.modelId === "glm-5.2"),
      true,
      "Expected runtime snapshot to include zai/glm-5.2",
    );

    await page.evaluate((workspaceId) => window.piApp.selectWorkspace(workspaceId), workspace.id);
    await page.evaluate(() => window.piApp.setActiveView("new-thread"));
    const modelBadge = page.locator(".new-thread__hint .model-selector__badge").first();
    await modelBadge.waitFor({ state: "visible", timeout: 15_000 });
    await modelBadge.click();
    const filter = page.locator(".new-thread__hint .model-selector__filter-input").first();
    await filter.waitFor({ state: "visible", timeout: 15_000 });
    await filter.fill("glm-5.2");
    await page.locator(".new-thread__hint .model-selector__dropdown").getByText("glm-5.2").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    const sessionCount = state.workspaces.reduce((count, entry) => count + entry.sessions.length, 0);
    console.log(JSON.stringify({
      appName: appPaths.name,
      copiedEntries,
      executablePath,
      modelCount: runtime.models.length,
      sessionCount,
      tempUserDataDir,
      userDataSource: sourceUserDataDir,
      workspaceCount: state.workspaces.length,
      workspacePath: workspace.path,
      foundModel: "zai/glm-5.2",
    }, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
} finally {
  if (process.env.ALPI_SMOKE_KEEP_TEMP !== "1") {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function expandHome(value) {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}
