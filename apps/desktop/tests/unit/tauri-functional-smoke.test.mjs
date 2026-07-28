import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendDir = path.join(desktopDir, "out", "tauri-backend");

function executable(name) {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(entry, name);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  throw new Error(`${name} executable is required`);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

class BackendClient {
  constructor(child) {
    this.child = child;
    this.messages = [];
    this.waiters = new Set();
    this.nextId = 1;
    this.errors = [];
    this.nativeRequestCounts = {
      "notification-status": 0,
      "notification-request": 0,
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.errors.push(chunk));
    this.lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      const message = JSON.parse(line);
      this.messages.push(message);
      if (message.type === "native-request") {
        this.nativeRequestCounts[message.method] += 1;
        this.send({
          type: "native-response",
          id: message.id,
          ok: true,
          result: message.method === "notification-status" ? "default" : "granted",
        });
      }
      for (const resolve of [...this.waiters]) resolve();
    });
  }

  async waitFor(predicate, label, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 100);
      });
    }
    throw new Error(
      `${label} timed out\n${this.errors.join("")}\nRecent messages: ${JSON.stringify(this.messages.slice(-20))}`,
    );
  }

  async request(channel, args = [], timeoutMs = 60_000) {
    const id = `request-${this.nextId++}`;
    this.child.stdin.write(`${JSON.stringify({ type: "request", id, channel, args })}\n`);
    const response = await this.waitFor(
      (message) => message.type === "response" && message.id === id,
      channel,
      timeoutMs,
    );
    if (!response.ok) throw new Error(`${channel}: ${response.error}`);
    return response.result;
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close() {
    if (this.child.exitCode !== null) return;
    this.child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    await new Promise((resolve) => this.child.once("exit", resolve));
  }
}

test(
  "Tauri backend supports workspace, diff, terminal, provider flow, and a real model",
  { timeout: 300_000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "alamelu-tauri-functional-"));
    const workspace = path.join(root, "workspace");
    const userData = path.join(root, "state");
    fs.mkdirSync(workspace);
    fs.mkdirSync(userData);
    fs.writeFileSync(path.join(workspace, "note.txt"), "first\n");
    git(workspace, "init");
    git(workspace, "config", "user.name", "Alamelu Tauri Test");
    git(workspace, "config", "user.email", "tauri-test@example.invalid");
    git(workspace, "add", "note.txt");
    git(workspace, "commit", "-m", "initial");

    const child = spawn(process.execPath, [path.join(backendDir, "main.cjs")], {
      cwd: backendDir,
      env: {
        ...process.env,
        ALAMELU_TAURI_BACKEND_DIR: backendDir,
        ALAMELU_TAURI_RESOURCES: backendDir,
        PI_APP_TEST_MODE: "background",
        ALAMELU_TAURI_TEST_NATIVE_NOTIFICATIONS: "1",
        PI_APP_TEST_PROVIDER_LOGIN_FLOW: "1",
        PI_APP_INITIAL_WORKSPACES: workspace,
        PI_APP_USER_DATA_DIR: userData,
        PI_GUI_BRAND: "alpi",
        PI_GUI_PI_BIN: executable("pi"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const backend = new BackendClient(child);

    try {
      await backend.waitFor((message) => message.type === "ready", "backend readiness");
      const state = await backend.request("alamelu-pi:state-request");
      const workspaceId = state.workspaces.find(
        (entry) => fs.realpathSync(entry.path) === fs.realpathSync(workspace),
      )?.id;
      assert.ok(workspaceId, "temporary workspace was not loaded");
      const runtime = state.runtimeByWorkspace[workspaceId];
      assert.ok(runtime.models.length > 100);
      assert.ok(runtime.providers.length > 10);
      assert.ok(Array.isArray(runtime.skills));
      assert.ok(Array.isArray(runtime.extensions));
      const unsupportedWorktree = await backend.request("alamelu-pi:create-worktree", [
        { workspaceId },
      ]);
      assert.match(unsupportedWorktree.lastError, /not supported/i);

      const files = await backend.request("alamelu-pi:list-workspace-files", [workspaceId]);
      assert.ok(files.includes("note.txt"));
      fs.writeFileSync(path.join(workspace, "note.txt"), "first\nsecond\n");
      const changed = await backend.request("alamelu-pi:get-changed-files", [workspaceId]);
      assert.ok(changed.some((entry) => entry.path === "note.txt"));
      const diff = await backend.request("alamelu-pi:get-file-diff", [workspaceId, "note.txt"]);
      assert.match(diff, /second/);
      await backend.request("alamelu-pi:stage-file", [workspaceId, "note.txt"]);
      assert.match(git(workspace, "diff", "--cached"), /second/);

      const terminal = await backend.request("alamelu-pi:terminal-ensure-panel", [
        workspaceId,
        "smoke",
        { cols: 80, rows: 24 },
      ]);
      const terminalId = terminal.activeSessionId;
      assert.ok(terminalId);
      await backend.request("alamelu-pi:terminal-write", [
        terminalId,
        "printf 'TAURI_TERMINAL_OK\\n'\r",
      ]);
      const terminalData = await backend.waitFor(
        (message) =>
          message.type === "event" &&
          message.channel === "alamelu-pi:terminal-data" &&
          String(message.payload?.data).includes("TAURI_TERMINAL_OK"),
        "terminal output",
        10_000,
      );
      assert.equal(terminalData.payload.terminalId, terminalId);
      await backend.request("alamelu-pi:terminal-close-session", [terminalId]);

      const loginPromise = backend
        .request("alamelu-pi:login-provider", [workspaceId, "cursor"])
        .catch((error) => error);
      const loginState = await backend.waitFor(
        (message) =>
          message.type === "event" &&
          message.channel === "alamelu-pi:provider-login-state-changed" &&
          message.payload?.status === "select",
        "provider login prompt",
      );
      await backend.request("alamelu-pi:provider-login-cancel", [loginState.payload.requestId]);
      await loginPromise;
      await backend.waitFor(
        (message) =>
          message.type === "event" &&
          message.channel === "alamelu-pi:provider-login-state-changed" &&
          message.payload?.status === "cancelled",
        "provider login cancellation",
      );

      let model = runtime.models.find(
        (entry) => entry.providerId === "cursor" && entry.modelId === "auto" && entry.available,
      );
      model ??= runtime.models.find((entry) => entry.available);
      assert.ok(model, "no authenticated model is available for the live smoke");
      let liveState = await backend.request("alamelu-pi:create-session", [
        { workspaceId, title: "Tauri live smoke" },
      ]);
      const sessionId = liveState.selectedSessionId;
      assert.ok(sessionId);
      const secondSessionState = await backend.request("alamelu-pi:create-session", [
        { workspaceId, title: "Ordinary refocus selection" },
      ]);
      const secondSessionId = secondSessionState.selectedSessionId;
      assert.ok(secondSessionId);
      await backend.request("alamelu-pi:select-session", [{ workspaceId, sessionId }]);

      const runningAt = new Date().toISOString();
      await backend.request("__alamelu_tauri:test-session-event", [
        {
          type: "sessionUpdated",
          sessionRef: { workspaceId, sessionId },
          timestamp: runningAt,
          runId: `tauri-running-${Date.now()}`,
          snapshot: {
            ref: { workspaceId, sessionId },
            workspace: {
              workspaceId,
              path: workspace,
              displayName: path.basename(workspace),
            },
            title: "Tauri live smoke",
            status: "running",
            updatedAt: runningAt,
            preview: "Background run",
            runningRunId: `tauri-running-${Date.now()}`,
          },
        },
      ]);

      backend.send({
        type: "window-state",
        focused: false,
        visible: true,
        minimized: false,
        closed: false,
      });
      await backend.waitFor(
        (message) =>
          message.type === "native-request" &&
          message.method === "notification-request",
        "native notification permission request",
      );
      assert.ok(backend.nativeRequestCounts["notification-status"] >= 1);
      assert.equal(backend.nativeRequestCounts["notification-request"], 1);

      await backend.request("__alamelu_tauri:test-session-event", [
        {
          type: "runCompleted",
          sessionRef: { workspaceId, sessionId },
          timestamp: new Date().toISOString(),
          runId: `tauri-notification-${Date.now()}`,
          snapshot: {
            ref: { workspaceId, sessionId },
            workspace: {
              workspaceId,
              path: workspace,
              displayName: path.basename(workspace),
            },
            title: "Tauri live smoke",
            status: "idle",
            updatedAt: new Date().toISOString(),
            preview: "Background completion",
          },
        },
      ]);
      const notification = await backend.waitFor(
        (message) => message.type === "notification" && message.id,
        "background completion notification",
      );
      let shimState = await backend.request("__alamelu_tauri:test-probe");
      assert.equal(shimState.window.focused, false);
      assert.ok(shimState.activeNotificationIds.includes(notification.id));

      await backend.request("alamelu-pi:select-session", [
        { workspaceId, sessionId: secondSessionId },
      ]);
      backend.send({
        type: "window-state",
        focused: true,
        visible: true,
        minimized: false,
        closed: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ordinaryRefocusState = await backend.request("alamelu-pi:state-request");
      assert.equal(ordinaryRefocusState.selectedSessionId, secondSessionId);

      backend.send({ type: "notification-activated", id: notification.id });
      const notificationDeadline = Date.now() + 10_000;
      do {
        shimState = await backend.request("__alamelu_tauri:test-probe");
        const activationState = await backend.request("alamelu-pi:state-request");
        if (
          shimState.window.focused &&
          !shimState.activeNotificationIds.includes(notification.id) &&
          activationState.selectedSessionId === sessionId
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < notificationDeadline);
      assert.equal(shimState.window.focused, true);
      assert.ok(!shimState.activeNotificationIds.includes(notification.id));
      const activatedState = await backend.request("alamelu-pi:state-request");
      assert.equal(activatedState.selectedSessionId, sessionId);

      const menuWorkspace = path.join(root, "menu-workspace");
      fs.mkdirSync(menuWorkspace);
      backend.send({ type: "native-open-workspace", path: menuWorkspace });
      const workspacePicked = await backend.waitFor(
        (message) =>
          message.type === "event" &&
          message.channel === "alamelu-pi:workspace-picked",
        "native open-folder route",
      );
      const menuState = await backend.request("alamelu-pi:state-request");
      assert.ok(
        menuState.workspaces.some(
          (entry) =>
            entry.id === workspacePicked.payload &&
            fs.realpathSync(entry.path) === fs.realpathSync(menuWorkspace),
        ),
      );
      await backend.request("alamelu-pi:select-session", [{ workspaceId, sessionId }]);

      await backend.request("alamelu-pi:set-session-model", [
        workspaceId,
        sessionId,
        model.providerId,
        model.modelId,
      ]);
      await backend.request("alamelu-pi:submit-composer", [
        "Reply with only the uppercase token TAURI_READY.",
      ]);
      await backend.waitFor(
        (message) => {
          if (message.type !== "event" || message.channel !== "alamelu-pi:state-changed") {
            return false;
          }
          const selected = message.payload?.workspaces
            ?.flatMap((entry) => entry.sessions)
            .find((entry) => entry.id === sessionId);
          return selected?.status === "idle";
        },
        "real model completion",
        180_000,
      );
      const transcript = await backend.request("alamelu-pi:selected-transcript-request");
      assert.match(JSON.stringify(transcript), /TAURI_READY/i);

      await backend.request("alamelu-pi:submit-composer", [
        "Write the integers from 1 through 500, one per line.",
      ]);
      await backend.waitFor(
        (message) => {
          if (message.type !== "event" || message.channel !== "alamelu-pi:state-changed") {
            return false;
          }
          const selected = message.payload?.workspaces
            ?.flatMap((entry) => entry.sessions)
            .find((entry) => entry.id === sessionId);
          return selected?.status === "running";
        },
        "running state before cancellation",
        30_000,
      );
      const cancelledState = await backend.request("alamelu-pi:cancel-current-run");
      const cancelledSession = cancelledState.workspaces
        .flatMap((entry) => entry.sessions)
        .find((entry) => entry.id === sessionId);
      assert.notEqual(cancelledSession.status, "running");
    } finally {
      await backend.close().catch(() => child.kill("SIGTERM"));
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
