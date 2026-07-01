import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPiRpcDriver } from "../dist/index.js";

class FakeRpcClient {
  constructor(commands) {
    this.commands = commands;
  }

  async sendCommand(command) {
    this.commands.push(command);
    if (command.type === "get_state") {
      return {
        success: true,
        data: {
          sessionId: "session-1",
          sessionName: "Test Session",
        },
      };
    }
    return { success: true };
  }

  onEvent() {
    return () => {};
  }

  close() {}
}

test("sendUserMessage maps running-session delivery modes to native Pi RPC commands", async () => {
  const commands = [];
  const driver = makeDriver(commands);
  const workspace = { workspaceId: "workspace-1", path: fs.mkdtempSync(path.join(os.tmpdir(), "pi-rpc-workspace-")) };
  const snapshot = await driver.createSession(workspace);

  await driver.sendUserMessage(snapshot.ref, { text: "start work" });
  await driver.sendUserMessage(snapshot.ref, { text: "steer now", deliverAs: "steer" });
  await driver.sendUserMessage(snapshot.ref, { text: "follow up later", deliverAs: "followUp" });

  assert.deepEqual(
    commands.map((command) => command.type),
    ["get_state", "prompt", "steer", "follow_up"],
  );
  assert.equal(commands[2].message, "steer now");
  assert.equal(commands[3].message, "follow up later");
});

test("sendUserMessage rejects delivery modes before a session is running", async () => {
  const commands = [];
  const driver = makeDriver(commands);
  const workspace = { workspaceId: "workspace-1", path: fs.mkdtempSync(path.join(os.tmpdir(), "pi-rpc-workspace-")) };
  const snapshot = await driver.createSession(workspace);

  await assert.rejects(
    driver.sendUserMessage(snapshot.ref, { text: "too early", deliverAs: "steer" }),
    /require a running session/,
  );
  assert.deepEqual(commands.map((command) => command.type), ["get_state"]);
});

function makeDriver(commands) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rpc-driver-"));
  const agentDir = path.join(root, "agent");
  const sessionDir = path.join(root, "sessions");
  const userDataDir = path.join(root, "user-data");
  const labWorkspace = path.join(root, "workspace");
  for (const dir of [agentDir, sessionDir, userDataDir, labWorkspace]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return createPiRpcDriver({
    piBin: "pi",
    agentDir,
    sessionDir,
    userDataDir,
    labWorkspace,
    allowRealPiState: true,
    allowProductionUserData: true,
    allowRealWorkspace: true,
    rpcClientFactory: () => new FakeRpcClient(commands),
  });
}
