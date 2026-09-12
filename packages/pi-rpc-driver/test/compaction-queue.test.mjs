import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test, { mock } from "node:test";
import { createPiRpcDriver, NO_RPC_DEADLINE, RpcClient } from "../dist/index.js";

/**
 * Fake Pi child: commands are recorded and stay pending until the test acknowledges them, and
 * events are pushed synchronously in the order a real stdout chunk would deliver them.
 */
class ScriptedClient {
  commands = [];
  listeners = new Set();
  pending = new Map();
  closed = false;
  autoAck = new Set(["abort", "set_model", "set_thinking_level", "set_session_name"]);

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(event) {
    for (const listener of [...this.listeners]) listener(event);
  }

  sendCommand(command, id, timeoutMs) {
    this.commands.push({ command, id, timeoutMs });
    if (command.type === "get_state") {
      return Promise.resolve({ type: "response", id, command: "get_state", success: true, data: { sessionId: "scripted-1", sessionName: "Scripted" } });
    }
    if (this.autoAck.has(command.type)) {
      return Promise.resolve({ type: "response", id, command: command.type, success: true });
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { command, resolve, reject });
    });
  }

  of(type) {
    return this.commands.filter((entry) => entry.command.type === type);
  }

  findPending(type) {
    for (const [id, entry] of this.pending) {
      if (entry.command.type === type) return [id, entry];
    }
    throw new Error(`no pending ${type} command`);
  }

  ack(type, extra = {}) {
    const [id, entry] = this.findPending(type);
    this.pending.delete(id);
    entry.resolve({ type: "response", id, command: type, success: true, ...extra });
  }

  fail(type, error) {
    const [id, entry] = this.findPending(type);
    this.pending.delete(id);
    entry.resolve({ type: "response", id, command: type, success: false, error });
  }

  reject(type, error) {
    const [id, entry] = this.findPending(type);
    this.pending.delete(id);
    entry.reject(new Error(error));
  }
}

async function openDriver(client = new ScriptedClient()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rpc-compaction-"));
  const dirs = { agentDir: path.join(root, "agent"), sessionDir: path.join(root, "sessions"), userDataDir: path.join(root, "user-data"), labWorkspace: path.join(root, "workspace") };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  const driver = createPiRpcDriver({
    piBin: "pi",
    ...dirs,
    allowRealPiState: true,
    allowProductionUserData: true,
    allowRealWorkspace: true,
    rpcClientFactory: () => client,
  });
  const snapshot = await driver.createSession({ workspaceId: "ws", path: dirs.labWorkspace });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  return { driver, ref: snapshot.ref, client, events, root };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const lastSnapshot = (events) => events.filter((event) => "snapshot" in event).at(-1)?.snapshot;
const queuedTexts = (events) => (lastSnapshot(events)?.queuedMessages ?? []).map((message) => message.text);
const count = (events, type) => events.filter((event) => event.type === type).length;

test("V1 prompt acknowledgement waits behind preflight compaction with no deadline and the run ends at agent_settled", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.sendUserMessage(ref, { text: "hello" });
  const prompt = client.of("prompt");
  assert.equal(prompt.length, 1);
  assert.equal(prompt[0].timeoutMs, NO_RPC_DEADLINE, "prompt acknowledgement must not expire");
  assert.equal(lastSnapshot(events).status, "running");

  client.emit({ type: "compaction_start", reason: "threshold" });
  const started = events.find((event) => event.type === "compactionStarted");
  assert.ok(started, "compactionStarted is surfaced");
  assert.equal(started.reason, "threshold");
  assert.equal(lastSnapshot(events).compacting?.reason, "threshold");
  assert.equal(lastSnapshot(events).status, "running");

  client.emit({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false, result: { tokensBefore: 514440, estimatedTokensAfter: 32000 } });
  const ended = events.find((event) => event.type === "compactionEnded");
  assert.equal(ended.outcome, "completed");
  assert.equal(ended.tokensBefore, 514440);
  assert.equal(ended.estimatedTokensAfter, 32000);
  assert.equal(ended.startedAt, started.startedAt);
  assert.equal("compacting" in lastSnapshot(events), false);
  assert.equal(lastSnapshot(events).status, "running", "the original prompt is still running after preflight compaction");

  client.ack("prompt");
  await flush();
  assert.equal(count(events, "runFailed"), 0);

  client.emit({ type: "agent_start" });
  client.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } });
  client.emit({ type: "agent_end", willRetry: false });
  assert.equal(count(events, "runCompleted"), 0, "agent_end alone must not complete the run");
  assert.equal(lastSnapshot(events).status, "running");
  client.emit({ type: "agent_settled" });
  assert.equal(count(events, "runCompleted"), 1);
  assert.equal(lastSnapshot(events).status, "idle");
  assert.equal(client.of("prompt").length, 1, "the original prompt is sent exactly once");
});

test("V2 RpcClient: NO_RPC_DEADLINE never times out while finite deadlines still do", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.resume();
    const client = new RpcClient({ stdin, stdout, kill: () => undefined }, { defaultTimeoutMs: 1000 });
    let longState = "pending";
    const long = client.sendCommand({ type: "prompt" }, "p1", NO_RPC_DEADLINE).then(() => { longState = "resolved"; }, () => { longState = "rejected"; });
    let finiteState = "pending";
    const finite = client.sendCommand({ type: "get_state" }, "s1", 120_000).then(() => { finiteState = "resolved"; }, () => { finiteState = "rejected"; });
    mock.timers.tick(601_000);
    await finite;
    assert.equal(finiteState, "rejected", "a finite deadline still expires");
    assert.equal(longState, "pending", "no-deadline command is still waiting after 601 s");
    stdout.write(`${JSON.stringify({ type: "response", id: "p1", command: "prompt", success: true })}\n`);
    await long;
    assert.equal(longState, "resolved");
    client.close();
  } finally {
    mock.timers.reset();
  }
});

test("V3 follow-ups while running stay visible from dispatch and leave on Pi's consumption", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.sendUserMessage(ref, { text: "work" });

  const a = driver.sendUserMessage(ref, { id: "qa", text: "A", deliverAs: "followUp" });
  assert.deepEqual(queuedTexts(events), ["A"], "registered before the follow_up acknowledgement");
  client.emit({ type: "queue_update", steering: [], followUp: ["A"] });
  assert.deepEqual(queuedTexts(events), ["A"], "Pi's insertion update removes nothing");
  assert.equal(count(events, "queuedMessageStarted"), 0);
  client.ack("follow_up");
  await a;

  const b = driver.sendUserMessage(ref, { id: "qb", text: "B", deliverAs: "followUp" });
  client.emit({ type: "queue_update", steering: [], followUp: ["A", "B"] });
  client.ack("follow_up");
  await b;
  assert.deepEqual(queuedTexts(events), ["A", "B"]);

  client.emit({ type: "queue_update", steering: [], followUp: ["B"] });
  const startedA = events.filter((event) => event.type === "queuedMessageStarted");
  assert.equal(startedA.length, 1);
  assert.equal(startedA[0].message.id, "qa", "the composer id is preserved");
  assert.deepEqual(queuedTexts(events), ["B"]);

  const c = driver.sendUserMessage(ref, { id: "qc", text: "/ext", deliverAs: "followUp" });
  assert.deepEqual(queuedTexts(events), ["B", "/ext"]);
  client.fail("follow_up", 'Extension command "/ext" cannot be queued.');
  await assert.rejects(c, /cannot be queued/);
  assert.deepEqual(queuedTexts(events), ["B"], "a rejected insertion removes only its entry");
  assert.equal(client.of("follow_up").length, 3, "no duplicate sends");
  assert.equal(client.of("prompt").length, 1);
});

test("V4 manual compaction: three Sends are held, then one prompt and two follow-ups start in order", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.compactSession(ref, "keep the API notes");
  const compact = client.of("compact");
  assert.equal(compact.length, 1, "compactSession resolves at acceptance");
  assert.equal(compact[0].timeoutMs, NO_RPC_DEADLINE);
  assert.equal(compact[0].command.customInstructions, "keep the API notes");
  assert.equal(lastSnapshot(events).status, "running");
  assert.equal("runningRunId" in lastSnapshot(events), false);

  await driver.sendUserMessage(ref, { id: "qa", text: "A", deliverAs: "followUp" });
  await driver.sendUserMessage(ref, { id: "qb", text: "B", deliverAs: "followUp" });
  await driver.sendUserMessage(ref, { id: "qc", text: "C", deliverAs: "steer" });
  assert.deepEqual(queuedTexts(events), ["A", "B", "C"], "all three accepted and visible during compaction");
  assert.equal(client.of("prompt").length, 0);
  assert.equal(client.of("follow_up").length + client.of("steer").length, 0, "nothing reaches Pi mid-compaction");

  client.emit({ type: "compaction_start", reason: "manual" });
  assert.equal(events.find((event) => event.type === "compactionStarted").reason, "manual");
  client.emit({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { tokensBefore: 90000, estimatedTokensAfter: 20000 } });
  assert.equal(events.find((event) => event.type === "compactionEnded").outcome, "completed");
  assert.equal(lastSnapshot(events).status, "idle");
  client.ack("compact", { data: { summary: "s", tokensBefore: 90000, estimatedTokensAfter: 20000 } });
  await flush();
  await flush();

  const prompt = client.of("prompt");
  assert.equal(prompt.length, 1);
  assert.equal(prompt[0].command.message, "A");
  assert.equal(prompt[0].timeoutMs, NO_RPC_DEADLINE);
  const promptIndex = client.commands.indexOf(prompt[0]);
  const followUps = client.commands.filter((entry) => entry.command.type === "follow_up" || entry.command.type === "steer");
  assert.deepEqual(followUps.map((entry) => [entry.command.type, entry.command.message]), [["follow_up", "B"], ["steer", "C"]]);
  assert.ok(client.commands.indexOf(followUps[0]) > promptIndex, "hand-offs are written after the prompt");
  const started = events.filter((event) => event.type === "queuedMessageStarted");
  assert.deepEqual(started.map((event) => event.message.id), ["qa"], "only the started message reports queuedMessageStarted");
  assert.deepEqual(queuedTexts(events), ["B", "C"]);
  assert.equal(lastSnapshot(events).status, "running");

  client.emit({ type: "queue_update", steering: [], followUp: ["B"] });
  client.emit({ type: "queue_update", steering: ["C"], followUp: ["B"] });
  assert.deepEqual(queuedTexts(events), ["B", "C"], "insertion updates keep both chips");
  client.ack("follow_up");
  client.ack("steer");
  client.ack("prompt");
  await flush();
  assert.equal(count(events, "runFailed"), 0);
  client.emit({ type: "agent_start" });
  client.emit({ type: "queue_update", steering: [], followUp: ["B"] });
  assert.deepEqual(queuedTexts(events), ["B"], "the steer consumption removes C only");
  client.emit({ type: "queue_update", steering: [], followUp: [] });
  assert.deepEqual(queuedTexts(events), []);
  assert.deepEqual(events.filter((event) => event.type === "queuedMessageStarted").map((event) => event.message.id), ["qa", "qc", "qb"]);
  client.emit({ type: "agent_end", willRetry: false });
  client.emit({ type: "agent_settled" });
  assert.equal(count(events, "runCompleted"), 1);
  assert.equal(lastSnapshot(events).status, "idle");
});

test("V5 intermediate agent_end with retry does not end the run; a finalized error fails it only at settle", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.sendUserMessage(ref, { text: "retry me" });
  client.ack("prompt");
  await flush();
  client.emit({ type: "agent_start" });
  client.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "overloaded" } });
  client.emit({ type: "agent_end", willRetry: true });
  assert.equal(count(events, "runFailed"), 0);
  assert.equal(count(events, "runCompleted"), 0);
  client.emit({ type: "agent_start" });
  client.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
  client.emit({ type: "agent_end", willRetry: false });
  assert.equal(count(events, "runCompleted"), 0);
  client.emit({ type: "agent_settled" });
  assert.equal(count(events, "runCompleted"), 1);
  assert.equal(count(events, "runFailed"), 0);

  await driver.sendUserMessage(ref, { text: "fail me" });
  client.ack("prompt");
  await flush();
  client.emit({ type: "agent_start" });
  client.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "final failure" } });
  client.emit({ type: "agent_end", willRetry: false });
  assert.equal(count(events, "runFailed"), 0, "not failed before Pi settles");
  client.emit({ type: "agent_settled" });
  assert.equal(events.filter((event) => event.type === "runFailed").at(-1).error.message, "final failure");
  assert.equal(count(events, "runCompleted"), 1);
});

test("V6a transport closure during manual compaction fails once, clears state and starts nothing", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.compactSession(ref);
  await driver.sendUserMessage(ref, { id: "held", text: "held", deliverAs: "followUp" });
  client.emit({ type: "compaction_start", reason: "manual" });
  client.emit({ type: "rpc_transport_closed", reason: "stdout_end" });
  assert.equal(count(events, "runFailed"), 1);
  assert.match(events.find((event) => event.type === "runFailed").error.message, /RPC transport closed/);
  const snapshot = lastSnapshot(events);
  assert.equal(snapshot.status, "idle");
  assert.equal("compacting" in snapshot, false);
  assert.deepEqual(snapshot.queuedMessages ?? [], []);
  client.reject("compact", "RPC stdout ended");
  await flush();
  await flush();
  assert.equal(count(events, "runFailed"), 1, "the rejected compact command adds no second failure");
  assert.equal(client.of("prompt").length, 0, "the held message is not started into a dead client");
});

test("V6b a compact command rejected right after acceptance fails once and clears busy state", async () => {
  const client = new ScriptedClient();
  const rejectingSend = client.sendCommand.bind(client);
  client.sendCommand = (command, id, timeoutMs) => {
    if (command.type === "compact") {
      client.commands.push({ command, id, timeoutMs });
      return Promise.reject(new Error("RPC client is closed"));
    }
    return rejectingSend(command, id, timeoutMs);
  };
  const { driver, ref, events } = await openDriver(client);
  await driver.compactSession(ref);
  await flush();
  await flush();
  assert.equal(count(events, "runFailed"), 1);
  assert.match(events.find((event) => event.type === "runFailed").error.message, /RPC client is closed/);
  assert.equal(lastSnapshot(events).status, "idle");
});

test("V6c a Pi-reported compaction failure is one compactionEnded and no runFailed; Stop still cancels", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.compactSession(ref);
  client.emit({ type: "compaction_start", reason: "manual" });
  client.emit({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, errorMessage: "Compaction failed: Nothing to compact (session too small)" });
  client.fail("compact", "Nothing to compact (session too small)");
  await flush();
  await flush();
  const ended = events.filter((event) => event.type === "compactionEnded");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].outcome, "failed");
  assert.match(ended[0].error, /Nothing to compact/);
  assert.equal(count(events, "runFailed"), 0);
  assert.equal(lastSnapshot(events).status, "idle");

  await driver.sendUserMessage(ref, { text: "stop me" });
  await driver.cancelCurrentRun(ref);
  assert.equal(count(events, "runCancelled"), 1);
  assert.equal(lastSnapshot(events).status, "idle");
});

test("V7 compaction events after a stopped run are visible while stale run events stay suppressed", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.sendUserMessage(ref, { text: "first" });
  await driver.cancelCurrentRun(ref);
  assert.equal(count(events, "runCancelled"), 1);
  client.emit({ type: "agent_settled" });
  assert.equal(count(events, "runCompleted"), 0, "stale settle of the stopped run is ignored");

  await driver.compactSession(ref);
  client.emit({ type: "compaction_start", reason: "manual" });
  assert.equal(count(events, "compactionStarted"), 1, "manual compaction after Stop is visible");
  client.emit({ type: "compaction_end", reason: "manual", aborted: true, willRetry: false });
  assert.equal(events.find((event) => event.type === "compactionEnded").outcome, "cancelled");
  client.ack("compact");
  await flush();
  await flush();

  await driver.sendUserMessage(ref, { text: "second" });
  client.emit({ type: "compaction_start", reason: "threshold" });
  assert.equal(count(events, "compactionStarted"), 2, "preflight compaction of the next prompt is visible");
  client.emit({ type: "agent_settled" });
  assert.equal(count(events, "runCompleted"), 0, "a stale settle before this run's agent_start does not complete it");
  client.emit({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false });
  client.ack("prompt");
  await flush();
  client.emit({ type: "agent_start" });
  client.emit({ type: "agent_end", willRetry: false });
  client.emit({ type: "agent_settled" });
  assert.equal(count(events, "runCompleted"), 1);
});

test("V8 after Stop, a manual compaction still terminates on transport loss or an immediate rejection (once)", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.sendUserMessage(ref, { text: "first" });
  await driver.cancelCurrentRun(ref);
  assert.equal(count(events, "runCancelled"), 1);

  await driver.compactSession(ref);
  await driver.sendUserMessage(ref, { id: "held", text: "held", deliverAs: "followUp" });
  assert.equal(lastSnapshot(events).status, "running");
  client.emit({ type: "rpc_transport_closed", reason: "stdout_end" });
  assert.equal(count(events, "runFailed"), 1, "transport loss ends the accepted compaction despite stale-run suppression");
  assert.equal(lastSnapshot(events).status, "idle");
  assert.deepEqual(lastSnapshot(events).queuedMessages ?? [], []);
  client.reject("compact", "RPC stdout ended");
  await flush();
  await flush();
  assert.equal(count(events, "runFailed"), 1, "the rejected command adds no second failure");
  assert.equal(client.of("prompt").length, 1, "the held message is not started into a dead client");

  // Immediate rejection before any compaction_start, still under suppression.
  const rejecting = new ScriptedClient();
  const send = rejecting.sendCommand.bind(rejecting);
  rejecting.sendCommand = (command, id, timeoutMs) => {
    if (command.type === "compact") {
      rejecting.commands.push({ command, id, timeoutMs });
      return Promise.reject(new Error("write EPIPE"));
    }
    return send(command, id, timeoutMs);
  };
  const second = await openDriver(rejecting);
  await second.driver.sendUserMessage(second.ref, { text: "run" });
  await second.driver.cancelCurrentRun(second.ref);
  await second.driver.compactSession(second.ref);
  await flush();
  await flush();
  assert.equal(count(second.events, "runFailed"), 1);
  assert.match(second.events.find((event) => event.type === "runFailed").error.message, /EPIPE/);
  assert.equal(lastSnapshot(second.events).status, "idle");
});

test("V9 a fatal parse error during manual compaction fails once and releases the idle tail", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.compactSession(ref);
  client.emit({ type: "compaction_start", reason: "manual" });
  client.emit({ type: "rpc_parse_error", line: "{not json", error: "Unexpected token" });
  assert.equal(count(events, "runFailed"), 1);
  assert.equal(lastSnapshot(events).status, "idle");
  assert.equal("compacting" in lastSnapshot(events), false);

  // The compact command never settles (no valid line follows); a later Send must not hang behind it.
  const next = driver.sendUserMessage(ref, { text: "after parse failure" });
  const outcome = await Promise.race([
    next.then(() => "sent", (error) => `rejected: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 1_000)),
  ]);
  assert.equal(outcome, "sent");
  assert.equal(client.of("prompt").length, 1);
  assert.equal(count(events, "runFailed"), 1, "no second failure was reported");
});

test("V10 a fatal parse error on the compact response line, after compaction_end, still releases the idle tail", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.compactSession(ref);
  client.emit({ type: "compaction_start", reason: "manual" });
  client.emit({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { tokensBefore: 1000, estimatedTokensAfter: 500 } });
  assert.equal(events.find((event) => event.type === "compactionEnded").outcome, "completed");
  // Pi's response line itself is malformed: the compact command never settles.
  client.emit({ type: "rpc_parse_error", line: '{"type":"response"', error: "Unexpected end of JSON input" });
  assert.equal(count(events, "runFailed"), 1);
  assert.equal(lastSnapshot(events).status, "idle");
  const next = driver.sendUserMessage(ref, { text: "after response parse failure" });
  const outcome = await Promise.race([
    next.then(() => "sent", (error) => `rejected: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 1_000)),
  ]);
  assert.equal(outcome, "sent");
  assert.equal(client.of("prompt").length, 1);
});

test("V11 after Stop, a malformed compact acknowledgement following compaction_end still fails once and releases the tail", async () => {
  const { driver, ref, client, events } = await openDriver();
  await driver.sendUserMessage(ref, { text: "first" });
  await driver.cancelCurrentRun(ref);
  assert.equal(count(events, "runCancelled"), 1);

  await driver.compactSession(ref);
  await driver.sendUserMessage(ref, { id: "held", text: "held", deliverAs: "followUp" });
  client.emit({ type: "compaction_start", reason: "manual" });
  client.emit({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { tokensBefore: 1000, estimatedTokensAfter: 500 } });
  assert.equal(events.find((event) => event.type === "compactionEnded").outcome, "completed");
  assert.equal(lastSnapshot(events).status, "idle");
  // Pi's acknowledgement line is malformed while stdout stays open: the command never settles.
  client.emit({ type: "rpc_parse_error", line: '{"type":"response"', error: "Unexpected end of JSON input" });
  assert.equal(count(events, "runFailed"), 1, "the failure is reported once despite stale-run suppression");
  assert.equal(lastSnapshot(events).status, "idle");
  assert.deepEqual(lastSnapshot(events).queuedMessages ?? [], []);

  const next = driver.sendUserMessage(ref, { text: "after malformed ack" });
  const outcome = await Promise.race([
    next.then(() => "sent", (error) => `rejected: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 1_000)),
  ]);
  assert.equal(outcome, "sent");
  assert.equal(client.of("prompt").filter((entry) => entry.command.message === "after malformed ack").length, 1);
  assert.equal(client.of("prompt").filter((entry) => entry.command.message === "held").length, 0, "the discarded held message is not started");
});
