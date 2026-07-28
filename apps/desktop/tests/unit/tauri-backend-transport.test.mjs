import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendDir = path.join(desktopDir, "out", "tauri-backend");

function findPi() {
  const explicit = process.env.PI_GUI_PI_BIN;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => path.join(entry, "pi"));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  throw new Error("Pi executable is required for the Tauri backend test");
}

test("backend becomes ready, correlates concurrent calls, and shuts down", { timeout: 60_000 }, async () => {
  assert.ok(fs.existsSync(path.join(backendDir, "main.cjs")), "build the Tauri backend first");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "alamelu-tauri-backend-"));
  const child = spawn(process.execPath, [path.join(backendDir, "main.cjs")], {
    cwd: backendDir,
    env: {
      ...process.env,
      ALAMELU_TAURI_BACKEND_DIR: backendDir,
      ALAMELU_TAURI_RESOURCES: backendDir,
      PI_APP_TEST_MODE: "background",
      PI_APP_USER_DATA_DIR: userData,
      PI_GUI_BRAND: "alpi",
      PI_GUI_PI_BIN: findPi(),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const errors = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => errors.push(chunk));

  const messages = [];
  const waiters = new Set();
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    for (const resolve of waiters) resolve();
  });

  async function waitFor(predicate, label) {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const match = messages.find(predicate);
      if (match) return match;
      await new Promise((resolve) => {
        const wake = () => {
          waiters.delete(wake);
          resolve();
        };
        waiters.add(wake);
        setTimeout(wake, 100);
      });
    }
    throw new Error(`${label} timed out\n${errors.join("")}`);
  }

  try {
    const ready = await waitFor((message) => message.type === "ready", "backend readiness");
    assert.ok(ready.handlers > 50);

    child.stdin.write(
      `${JSON.stringify({ type: "request", id: "ping", channel: "app:ping", args: [] })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({
        type: "request",
        id: "state",
        channel: "alamelu-pi:state-request",
        args: [],
      })}\n`,
    );

    const [ping, state] = await Promise.all([
      waitFor((message) => message.type === "response" && message.id === "ping", "ping"),
      waitFor((message) => message.type === "response" && message.id === "state", "state"),
    ]);
    assert.equal(ping.ok, true);
    assert.equal(ping.result, "pi desktop ready");
    assert.equal(state.ok, true);
    assert.ok(Array.isArray(state.result.workspaces));

    child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    const exitCode = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
