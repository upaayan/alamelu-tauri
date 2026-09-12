import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(
  desktopDir,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Alamelu Pi Tauri.app",
);
const executable = path.join(appPath, "Contents", "MacOS", "alamelu-pi-tauri");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "alamelu-tauri-packaged-"));
const stateDir = path.join(root, "state");
const reportPath = path.join(root, "ui-report.json");
const smokeWorkspace = path.join(root, "workspace");
const smokeAttachment = path.join(root, "smoke-attachment.txt");
fs.mkdirSync(stateDir);
fs.mkdirSync(smokeWorkspace);
fs.writeFileSync(smokeAttachment, "Tauri native attachment smoke\n");

assert.ok(fs.existsSync(executable), `Packaged executable is missing: ${executable}`);
const identifier = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIdentifier", path.join(appPath, "Contents", "Info.plist")],
  { encoding: "utf8" },
).trim();
assert.equal(identifier, "com.alamelu.pi.tauri");
assert.equal(findNamed(appPath, /electron/i), undefined, "Electron must not be bundled");

const child = spawn(executable, [], {
  env: {
    ...process.env,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    PI_APP_TEST_MODE: "background",
    PI_APP_USER_DATA_DIR: stateDir,
    PI_GUI_SHARED_THREAD_DATA_DIR: stateDir,
    PI_CODING_AGENT_SESSION_DIR: path.join(stateDir, "sessions"),
    ALAMELU_TAURI_SMOKE_FILE: reportPath,
    ALAMELU_TAURI_SMOKE_WORKSPACE: smokeWorkspace,
    ALAMELU_TAURI_SMOKE_ATTACHMENT: smokeAttachment,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk));
child.stderr.on("data", (chunk) => output.push(chunk));

try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Packaged smoke timed out\n${Buffer.concat(output).toString()}`)),
      60_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, Buffer.concat(output).toString());
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.ping, "pi desktop ready");
  assert.equal(report.hasPiApp, true);
  assert.ok(report.apiMethodCount >= 90);
  assert.ok(report.providerCount > 10);
  assert.ok(report.modelCount > 100);
  assert.equal(report.themeRoundTrip, "dark");
  assert.equal(report.nativeThemeEvent, "light");
  assert.equal(report.removedThemeSubscriptionStayedRemoved, true);
  assert.equal(report.nativeTransparency, true);
  assert.equal(report.backgroundWindowProbe.window.focused, false);
  assert.equal(report.backgroundWindowProbe.window.visible, true);
  assert.equal(report.backgroundWindowProbe.window.minimized, false);
  assert.ok(report.nativeWorkspaceId);
  assert.equal(report.nativeAttachmentAdded, true);
  assert.equal(report.pastedImageAdded, true);
  assert.ok(["granted", "denied", "default", "unknown"].includes(report.notificationPermission));
  assert.match(report.bodyText, /New Thread/);
  assert.deepEqual(report.display.navigation, ["Skills", "Extensions", "Settings"]);
  assert.equal(report.display.navigationInitiallyCollapsed, true);
  assert.equal(report.display.draftTitle, "New Thread");
  assert.deepEqual(report.display.pickerTail, ["Others ( No Workspace )", "New Workspace..."]);
  for (const key of ["fourThreadOverflow", "searchWhileCollapsed", "recentActivity", "plusAligned", "othersLast", "noThreadsRows", "noBrandChevron"]) {
    assert.equal(report.display[key], true, key);
  }
  assert.ok(report.display.expandedTitleError <= 1);
  assert.ok(report.display.collapsedTitleError <= 1);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const processes = execFileSync("ps", ["-axo", "command="], { encoding: "utf8" });
  assert.ok(!processes.includes(stateDir), "Packaged quit left a backend or Pi child running");
  console.log(
    `Packaged Tauri smoke: OK (${report.providerCount} providers, ${report.modelCount} models, ${report.apiMethodCount} API members)`,
  );
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  fs.rmSync(root, { recursive: true, force: true });
}

function findNamed(rootPath, pattern) {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (pattern.test(entry.name)) return path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findNamed(path.join(rootPath, entry.name), pattern);
      if (nested) return nested;
    }
  }
  return undefined;
}
