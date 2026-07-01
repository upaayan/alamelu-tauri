import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  JsonlDecoder,
  RpcClient,
  spawnPiRpcClient,
  expandHomePath,
  validateLabPaths,
  mapRpcEventToSessionDriverEvents,
  buildPiRpcPathEnv,
  resolvePiRpcSpawnCommand,
  buildPiRpcSpawnSpec,
} from '../dist/index.js';

test('JsonlDecoder splits only on LF and preserves U+2028 inside JSON strings', () => {
  const decoder = new JsonlDecoder();
  const first = JSON.stringify({ type: 'event', text: 'hello\u2028world' });
  const second = JSON.stringify({ type: 'response', id: 'one', success: true });

  const records = [
    ...decoder.push(first.slice(0, 10)),
    ...decoder.push(first.slice(10) + '\r\n' + second + '\n'),
  ];

  assert.deepEqual(records.map((record) => JSON.parse(record)), [
    { type: 'event', text: 'hello world' },
    { type: 'response', id: 'one', success: true },
  ]);
});

test('JsonlDecoder preserves multi-byte UTF-8 characters split across Buffer chunks', () => {
  const decoder = new JsonlDecoder();
  const line = Buffer.from(JSON.stringify({ type: 'event', text: 'hello 😀' }) + '\n', 'utf8');
  const emojiStart = line.indexOf(Buffer.from('😀'));
  const records = [
    ...decoder.push(line.subarray(0, emojiStart + 1)),
    ...decoder.push(line.subarray(emojiStart + 1)),
  ];
  assert.deepEqual(records.map((record) => JSON.parse(record)), [{ type: 'event', text: 'hello 😀' }]);
});

test('RpcClient writes JSONL commands, resolves matching response, and emits events', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written = [];
  stdin.on('data', (chunk) => written.push(chunk.toString('utf8')));

  const client = new RpcClient({ stdin, stdout, stderr, kill: () => undefined }, { defaultTimeoutMs: 1000 });
  const events = [];
  client.onEvent((event) => events.push(event));

  const pending = client.sendCommand({ type: 'get_state' }, 'state-1');
  assert.equal(written.join(''), '{"type":"get_state","id":"state-1"}\n');

  stdout.write(JSON.stringify({ type: 'agent_start' }) + '\n');
  stdout.write(JSON.stringify({ type: 'response', id: 'state-1', command: 'get_state', success: true, data: { sessionId: 'abc' } }) + '\n');

  const response = await pending;
  assert.equal(response.success, true);
  assert.equal(response.data.sessionId, 'abc');
  assert.deepEqual(events, [{ type: 'agent_start' }]);

  client.close();
});

test('RpcClient emits rpc_transport_closed on stdout end and close still cleans up transport', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const signals = [];
  const client = new RpcClient({ stdin, stdout, stderr, kill: (signal) => signals.push(signal) }, { defaultTimeoutMs: 1000, closeKillDelayMs: 5 });
  const events = [];
  client.onEvent((event) => events.push(event));
  stdout.end();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events.some((event) => event.type === 'rpc_transport_closed'), true);
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('validateLabPaths expands home and rejects production state paths', () => {
  const home = '/Users/example';
  assert.equal(expandHomePath('~/tmp/pi-gui-rpc-agent', home), '/Users/example/tmp/pi-gui-rpc-agent');

  const safe = validateLabPaths(
    {
      agentDir: '~/tmp/pi-gui-rpc-agent',
      sessionDir: '~/tmp/pi-gui-rpc-sessions',
      userDataDir: '~/tmp/pi-gui-rpc-user-data',
      labWorkspace: '~/tmp/pi-gui-rpc-workspace',
      productionAgentDir: '~/.pi/agent',
      productionUserDataDir: '~/Library/Application Support/pi-gui',
    },
    { homeDir: home },
  );
  assert.equal(safe.agentDir, '/Users/example/tmp/pi-gui-rpc-agent');
  assert.equal(safe.sessionDir, '/Users/example/tmp/pi-gui-rpc-sessions');

  assert.throws(
    () => validateLabPaths(
      {
        agentDir: '~/.pi/agent/lab',
        sessionDir: '~/tmp/pi-gui-rpc-sessions',
        userDataDir: '~/tmp/pi-gui-rpc-user-data',
        labWorkspace: '~/tmp/pi-gui-rpc-workspace',
        productionAgentDir: '~/.pi/agent',
        productionUserDataDir: '~/Library/Application Support/pi-gui',
      },
      { homeDir: home },
    ),
    /production Pi agent directory/,
  );
});

test('validateLabPaths rejects non-lab workspaces unless explicitly allowed', () => {
  assert.throws(
    () => validateLabPaths(
      {
        agentDir: '~/tmp/pi-gui-rpc-agent',
        sessionDir: '~/tmp/pi-gui-rpc-sessions',
        userDataDir: '~/tmp/pi-gui-rpc-user-data',
        labWorkspace: '~/playground/alamelu',
        productionAgentDir: '~/.pi/agent',
        productionUserDataDir: '~/Library/Application Support/pi-gui',
        expectedLabWorkspaceRoot: '~/tmp/pi-gui-rpc-workspace',
      },
      { homeDir: '/Users/example' },
    ),
    /throwaway RPC lab workspace/,
  );
});

test('validateLabPaths uses a production userData default when omitted', () => {
  assert.throws(
    () => validateLabPaths(
      {
        agentDir: '~/tmp/pi-gui-rpc-agent',
        sessionDir: '~/tmp/pi-gui-rpc-sessions',
        userDataDir: '~/Library/Application Support/pi-gui/lab',
        labWorkspace: '~/tmp/pi-gui-rpc-workspace',
        productionAgentDir: '~/.pi/agent',
      },
      { homeDir: '/Users/example' },
    ),
    /production pi-gui userData directory/,
  );
});

test('resolvePiRpcSpawnCommand uses Node explicitly for globally installed Pi CLI scripts', () => {
  const resolvedPiBin = '/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';
  const command = resolvePiRpcSpawnCommand('/Users/sudhirjha/.pi/agent/bin/pi', resolvedPiBin);
  if (process.env.HOME === '/Users/sudhirjha') {
    assert.equal(command.command, '/Users/sudhirjha/.nvm/versions/node/v24.16.0/bin/node');
    assert.deepEqual(command.args, [resolvedPiBin]);
  } else {
    assert.equal(typeof command.command, 'string');
    assert.equal(Array.isArray(command.args), true);
  }
});

test('buildPiRpcPathEnv includes Node bin for globally installed Pi CLI scripts', () => {
  const envPath = buildPiRpcPathEnv(
    '/Users/example/.pi/agent/bin/pi',
    '/Users/example/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
    '/usr/bin:/bin',
  );
  assert.equal(envPath.split(path.delimiter).includes('/Users/example/.nvm/versions/node/v24.16.0/bin'), true);
  assert.equal(envPath.split(path.delimiter).includes('/usr/bin'), true);
});

test('buildPiRpcSpawnSpec omits suppression and forced model flags in parity mode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-spawn-'));
  const piBin = path.join(tmp, 'pi');
  fs.writeFileSync(piBin, '#!/bin/sh\n', { mode: 0o755 });
  const spec = buildPiRpcSpawnSpec({
    piBin,
    cwd: '/tmp/alpi-workspace',
    agentDir: path.join(os.homedir(), '.pi', 'agent'),
    sessionDir: '/tmp/alpi-sessions',
    noTools: false,
    noExtensions: false,
    noSkills: false,
    noPromptTemplates: false,
    noThemes: false,
    noContextFiles: true,
    env: { PATH: '/usr/bin:/bin' },
  });
  assert.equal(spec.args.includes('--no-tools'), false);
  assert.equal(spec.args.includes('--no-extensions'), false);
  assert.equal(spec.args.includes('--no-skills'), false);
  assert.equal(spec.args.includes('--no-prompt-templates'), false);
  assert.equal(spec.args.includes('--no-themes'), false);
  assert.equal(spec.args.includes('--provider'), false);
  assert.equal(spec.args.includes('--model'), false);
  assert.equal(spec.env.PI_CODING_AGENT_DIR, path.join(os.homedir(), '.pi', 'agent'));
  assert.equal(spec.env.PI_CODING_AGENT_SESSION_DIR, '/tmp/alpi-sessions');
});

test('spawnPiRpcClient rejects PATH-relative pi binaries', () => {
  assert.throws(
    () => spawnPiRpcClient({
      piBin: 'pi',
      cwd: '/tmp/pi-gui-rpc-workspace',
      agentDir: '/tmp/pi-gui-rpc-agent',
      sessionDir: '/tmp/pi-gui-rpc-sessions',
    }),
    /resolved absolute pi binary/,
  );
});

test('validateLabPaths rejects production userData even when real Pi state is allowed', () => {
  assert.throws(
    () => validateLabPaths(
      {
        agentDir: '~/.pi/agent',
        sessionDir: '~/.pi/agent/sessions',
        userDataDir: '~/Library/Application Support/pi-gui/lab',
        labWorkspace: '~/tmp/pi-gui-rpc-workspace',
        productionAgentDir: '~/.pi/agent',
        productionUserDataDir: '~/Library/Application Support/pi-gui',
        allowRealPiState: true,
      },
      { homeDir: '/Users/example' },
    ),
    /production pi-gui userData directory/,
  );
});

test('validateLabPaths resolves symlinked existing ancestors before containment checks', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-path-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, 'home');
  const prod = path.join(home, '.pi', 'agent');
  const link = path.join(home, 'agent-link');
  fs.mkdirSync(prod, { recursive: true });
  fs.symlinkSync(prod, link, 'dir');

  assert.throws(
    () => validateLabPaths(
      {
        agentDir: path.join(link, 'future-leaf'),
        sessionDir: path.join(home, 'tmp', 'sessions'),
        userDataDir: path.join(home, 'tmp', 'user-data'),
        labWorkspace: path.join(home, 'tmp', 'workspace'),
        productionAgentDir: prod,
      },
      { homeDir: home },
    ),
    /production Pi agent directory/,
  );
});

test('RpcClient close sends SIGTERM and SIGKILL fallback through transport', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const signals = [];
  const client = new RpcClient({ stdin, stdout, stderr, kill: (signal) => signals.push(signal) }, { closeKillDelayMs: 5 });
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('mapRpcEventToSessionDriverEvents maps text, tool, completion, and failure events', () => {
  const sessionRef = { workspaceId: 'ws', sessionId: 's1' };
  const snapshot = {
    ref: sessionRef,
    workspace: { workspaceId: 'ws', path: '/tmp/ws' },
    title: 'Session',
    status: 'running',
    updatedAt: '2026-01-01T00:00:00.000Z',
    runningRunId: 'run-1',
  };
  const base = { sessionRef, snapshot, runId: 'run-1', now: () => '2026-01-01T00:00:00.000Z' };

  assert.deepEqual(mapRpcEventToSessionDriverEvents({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hi' } }, base), [
    { type: 'assistantDelta', sessionRef, timestamp: '2026-01-01T00:00:00.000Z', runId: 'run-1', text: 'Hi' },
  ]);

  assert.deepEqual(mapRpcEventToSessionDriverEvents({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read', args: { path: 'x' } }, base), [
    { type: 'toolStarted', sessionRef, timestamp: '2026-01-01T00:00:00.000Z', runId: 'run-1', callId: 'call-1', toolName: 'read', input: { path: 'x' } },
  ]);

  const completed = mapRpcEventToSessionDriverEvents({ type: 'agent_end' }, { ...base, snapshot: { ...snapshot, status: 'idle', runningRunId: undefined } });
  assert.equal(completed[0].type, 'runCompleted');
  assert.equal(completed[0].snapshot.status, 'idle');

  const failed = mapRpcEventToSessionDriverEvents({ type: 'message_update', assistantMessageEvent: { type: 'error', error: 'bad' } }, base);
  assert.equal(failed[0].type, 'runFailed');
});

test('PiRpcDriver rejects createSession workspace paths outside the lab workspace', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => { throw new Error('should not spawn'); },
  });
  await assert.rejects(
    () => driver.createSession({ workspaceId: 'ws', path: '/Users/example/playground/real-project' }),
    /outside the RPC lab workspace/,
  );
});

test('PiRpcDriver cold-opens an existing isolated lab session id', async (t) => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-open-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sessionDir = path.join(tmp, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, '2026-01-01T00-00-00-000Z_existing-session.jsonl'), '');

  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'existing-session', sessionName: 'Cold Open' } };
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: path.join(tmp, 'agent'),
    sessionDir,
    userDataDir: path.join(tmp, 'user-data'),
    labWorkspace: path.join(tmp, 'workspace'),
    expectedLabWorkspaceRoot: path.join(tmp, 'workspace'),
    productionAgentDir: path.join(tmp, 'prod-agent'),
    productionUserDataDir: path.join(tmp, 'prod-user-data'),
    rpcClientFactory: ({ sessionId }) => {
      assert.equal(sessionId, 'existing-session');
      return new FakeClient();
    },
  });

  const snapshot = await driver.openSession({ workspaceId: 'ws', sessionId: 'existing-session' });
  assert.equal(snapshot.title, 'Cold Open');
  assert.equal(snapshot.ref.sessionId, 'existing-session');
});

test('PiRpcDriver emits runFailed and returns to idle when prompt command fails', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  let promptTimeoutMs;
  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id, timeoutMs) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-fail', sessionName: 'RPC Fail' } };
      if (command.type === 'prompt') {
        promptTimeoutMs = timeoutMs;
        return { type: 'response', id, command: 'prompt', success: false, error: 'nope' };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await assert.rejects(() => driver.sendUserMessage(snapshot.ref, { text: 'fail' }), /nope/);
  assert.equal(promptTimeoutMs, 120_000);
  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'nope'), true);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
  assert.equal('runningRunId' in lastUpdate.snapshot, false);
});

test('PiRpcDriver rejects unsupported Phase-2 methods explicitly', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient { onEvent() { return () => undefined; } close() {} async sendCommand(command, id) { if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-unsupported', sessionName: 'RPC Unsupported' } }; return { type: 'response', id, command: command.type, success: true }; } }
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/pi-gui-rpc-agent', sessionDir: '/tmp/pi-gui-rpc-sessions', userDataDir: '/tmp/pi-gui-rpc-user-data', labWorkspace: '/tmp/pi-gui-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => new FakeClient() });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  await assert.rejects(() => driver.getSessionTree(snapshot.ref), /not supported/);
  await assert.rejects(() => driver.navigateSessionTree(snapshot.ref, 'x'), /not supported/);
  await assert.rejects(() => driver.compactSession(snapshot.ref), /not supported/);
});

test('PiRpcDriver maps steer and followUp delivery modes while a session is running', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const commands = [];
  class FakeClient { onEvent() { return () => undefined; } close() {} async sendCommand(command, id) { commands.push(command); if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-delivery-mode', sessionName: 'RPC Delivery Mode' } }; return { type: 'response', id, command: command.type, success: true }; } }
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/pi-gui-rpc-agent', sessionDir: '/tmp/pi-gui-rpc-sessions', userDataDir: '/tmp/pi-gui-rpc-user-data', labWorkspace: '/tmp/pi-gui-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => new FakeClient() });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  await assert.rejects(() => driver.sendUserMessage(snapshot.ref, { text: 'too early', deliverAs: 'steer' }), /require a running session/);
  await driver.sendUserMessage(snapshot.ref, { text: 'first' });
  await driver.sendUserMessage(snapshot.ref, { text: 'steer', deliverAs: 'steer' });
  await driver.sendUserMessage(snapshot.ref, { text: 'follow', deliverAs: 'followUp' });
  assert.deepEqual(commands.map((command) => command.type), ['get_state', 'prompt', 'steer', 'follow_up']);
});

test('PiRpcDriver rejects a second user message while a run is active', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient { onEvent() { return () => undefined; } close() {} async sendCommand(command, id) { if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-reentrant', sessionName: 'RPC Reentrant' } }; if (command.type === 'prompt') return { type: 'response', id, command: 'prompt', success: true }; return { type: 'response', id, command: command.type, success: true }; } }
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/pi-gui-rpc-agent', sessionDir: '/tmp/pi-gui-rpc-sessions', userDataDir: '/tmp/pi-gui-rpc-user-data', labWorkspace: '/tmp/pi-gui-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => new FakeClient() });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  await driver.sendUserMessage(snapshot.ref, { text: 'first' });
  await assert.rejects(() => driver.sendUserMessage(snapshot.ref, { text: 'second' }), /already running/);
});

test('PiRpcDriver cancel success returns running session to idle and emits runFailed', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-cancel', sessionName: 'RPC Cancel' } };
      if (command.type === 'prompt') return { type: 'response', id, command: 'prompt', success: true };
      if (command.type === 'abort') return { type: 'response', id, command: 'abort', success: true };
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'hang' });
  await driver.cancelCurrentRun(snapshot.ref);
  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'Run cancelled'), true);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
  assert.equal('runningRunId' in lastUpdate.snapshot, false);
});

test('PiRpcDriver cancel failure closes client and returns session to idle', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const fake = new class {
    closed = false;
    onEvent() { return () => undefined; }
    close() { this.closed = true; }
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-cancel-fail', sessionName: 'RPC Cancel Fail' } };
      if (command.type === 'prompt') return { type: 'response', id, command: 'prompt', success: true };
      if (command.type === 'abort') return { type: 'response', id, command: 'abort', success: false, error: 'abort failed' };
      return { type: 'response', id, command: command.type, success: true };
    }
  }();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'hang' });
  await assert.rejects(() => driver.cancelCurrentRun(snapshot.ref), /abort failed/);
  assert.equal(fake.closed, true);
  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'abort failed'), true);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
});

test('PiRpcDriver marks transport close during active run as failed and idle', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-close-fail', sessionName: 'RPC Close Fail' } };
      if (command.type === 'prompt') {
        for (const listener of this.listeners) listener({ type: 'rpc_transport_closed', reason: 'stdout_end' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'crash' });
  assert.equal(events.some((event) => event.type === 'runFailed' && /RPC transport closed/.test(event.error.message)), true);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
});

test('PiRpcDriver suppresses stale deltas after cancellation', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-stale', sessionName: 'RPC Stale' } };
      if (command.type === 'prompt') return { type: 'response', id, command: 'prompt', success: true };
      if (command.type === 'abort') return { type: 'response', id, command: 'abort', success: true };
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const fake = new FakeClient();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'hang' });
  await driver.cancelCurrentRun(snapshot.ref);
  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'STALE' } });
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'STALE'), false);
});

test('PiRpcDriver suppresses stale deltas after stream failure', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-stale-fail', sessionName: 'RPC Stale Fail' } };
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({ type: 'message_update', assistantMessageEvent: { type: 'error', error: 'boom' } });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const fake = new FakeClient();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'fail' });
  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'STALE_AFTER_FAIL' } });
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'STALE_AFTER_FAIL'), false);
});

test('PiRpcDriver suppresses stale agent_start after cancellation', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-stale-start', sessionName: 'RPC Stale Start' } };
      if (command.type === 'prompt') return { type: 'response', id, command: 'prompt', success: true };
      if (command.type === 'abort') return { type: 'response', id, command: 'abort', success: true };
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const fake = new FakeClient();
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/pi-gui-rpc-agent', sessionDir: '/tmp/pi-gui-rpc-sessions', userDataDir: '/tmp/pi-gui-rpc-user-data', labWorkspace: '/tmp/pi-gui-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', now: () => '2026-01-01T00:00:00.000Z', rpcClientFactory: () => fake });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'hang' });
  await driver.cancelCurrentRun(snapshot.ref);
  fake.emit({ type: 'agent_start' });
  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'STALE_AFTER_START' } });
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'STALE_AFTER_START'), false);
  assert.equal(events.filter((event) => event.type === 'sessionUpdated').at(-1).snapshot.status, 'idle');
});

test('PiRpcDriver closes client if createSession setup get_state fails', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const fake = new class { closed = false; onEvent() { return () => undefined; } close() { this.closed = true; } async sendCommand(command, id) { return { type: 'response', id, command: command.type, success: false, error: 'setup failed' }; } }();
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/pi-gui-rpc-agent', sessionDir: '/tmp/pi-gui-rpc-sessions', userDataDir: '/tmp/pi-gui-rpc-user-data', labWorkspace: '/tmp/pi-gui-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => fake });
  await assert.rejects(() => driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' }), /setup failed/);
  assert.equal(fake.closed, true);
});

test('PiRpcDriver closes client if createSession initial model setup fails', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const fake = new class { closed = false; onEvent() { return () => undefined; } close() { this.closed = true; } async sendCommand(command, id) { if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'setup-model' } }; return { type: 'response', id, command: command.type, success: false, error: 'model failed' }; } }();
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/pi-gui-rpc-agent', sessionDir: '/tmp/pi-gui-rpc-sessions', userDataDir: '/tmp/pi-gui-rpc-user-data', labWorkspace: '/tmp/pi-gui-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => fake });
  await assert.rejects(() => driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' }, { initialModel: { provider: 'xai', modelId: 'bad' } }), /model failed/);
  assert.equal(fake.closed, true);
});

test('PiRpcDriver closes client if cold open get_state fails', async (t) => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-open-fail-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sessionDir = path.join(tmp, 'sessions'); fs.mkdirSync(sessionDir, { recursive: true }); fs.writeFileSync(path.join(sessionDir, 'x_existing.jsonl'), '');
  const fake = new class { closed = false; onEvent() { return () => undefined; } close() { this.closed = true; } async sendCommand(command, id) { return { type: 'response', id, command: command.type, success: false, error: 'open failed' }; } }();
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: path.join(tmp, 'agent'), sessionDir, userDataDir: path.join(tmp, 'user-data'), labWorkspace: path.join(tmp, 'workspace'), expectedLabWorkspaceRoot: path.join(tmp, 'workspace'), productionAgentDir: path.join(tmp, 'prod-agent'), productionUserDataDir: path.join(tmp, 'prod-user-data'), rpcClientFactory: () => fake });
  await assert.rejects(() => driver.openSession({ workspaceId: 'ws', sessionId: 'existing' }), /open failed/);
  assert.equal(fake.closed, true);
});

test('PiRpcDriver marks stream errors failed and suppresses later completion', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-stream-fail', sessionName: 'RPC Stream Fail' } };
      if (command.type === 'prompt') {
        for (const listener of this.listeners) {
          listener({ type: 'agent_start' });
          listener({ type: 'message_update', assistantMessageEvent: { type: 'error', error: 'stream exploded' } });
          listener({ type: 'agent_end' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'explode' });
  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'stream exploded'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted'), false);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
  assert.equal('runningRunId' in lastUpdate.snapshot, false);
});

test('PiRpcDriver creates a chat session and maps fake RPC stream into driver events', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');

  class FakeClient {
    commands = [];
    listeners = new Set();
    closed = false;

    onEvent(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    close() {
      this.closed = true;
    }

    async sendCommand(command, id) {
      this.commands.push({ command, id });
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-s1', sessionName: 'RPC Test' } };
      if (command.type === 'prompt') {
        for (const listener of this.listeners) {
          listener({ type: 'agent_start' });
          listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'RPC_OK' } });
          listener({ type: 'agent_end' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }

  const fake = new FakeClient();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });

  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  assert.equal(snapshot.ref.sessionId, 'rpc-s1');
  assert.equal(snapshot.title, 'RPC Test');

  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'Reply exactly: RPC_OK' });

  assert.equal(fake.commands.some((entry) => entry.command.type === 'prompt' && entry.command.message === 'Reply exactly: RPC_OK'), true);
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'RPC_OK'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted' && event.snapshot.status === 'idle'), true);

  await driver.closeSession(snapshot.ref);
  assert.equal(fake.closed, true);
});

test('PiRpcDriver getTranscript loads user and assistant messages from RPC get_messages', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'transcript-session', sessionName: 'Transcript Session' } };
      if (command.type === 'get_messages') return {
        type: 'response',
        id,
        command: 'get_messages',
        success: true,
        data: {
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Hello RPC' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Hello human' }] },
          ],
        },
      };
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const transcript = await driver.getTranscript(snapshot.ref);
  assert.deepEqual(transcript, [
    { role: 'user', text: 'Hello RPC' },
    { role: 'assistant', text: 'Hello human' },
  ]);
});

test('PiRpcDriver getTranscript falls back to last assistant text when RPC messages are unavailable', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'fallback-session' } };
      if (command.type === 'get_messages') return { type: 'response', id, command: 'get_messages', success: false, error: 'not available' };
      if (command.type === 'get_last_assistant_text') return { type: 'response', id, command: 'get_last_assistant_text', success: true, data: { text: 'Fallback assistant text' } };
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  assert.deepEqual(await driver.getTranscript(snapshot.ref), [{ role: 'assistant', text: 'Fallback assistant text' }]);
});

test('PiRpcDriver cold-opened sessions load transcript from RPC get_messages', async (t) => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-open-transcript-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sessionDir = path.join(tmp, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'x_existing.jsonl'), '');
  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'existing', sessionName: 'Existing Session' } };
      if (command.type === 'get_messages') return {
        type: 'response', id, command: 'get_messages', success: true,
        data: { messages: [
          { role: 'user', content: 'Reopened hello' },
          { role: 'assistant', content: [{ type: 'text', text: 'Reopened hi' }] },
        ] },
      };
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: path.join(tmp, 'agent'),
    sessionDir,
    userDataDir: path.join(tmp, 'user-data'),
    labWorkspace: path.join(tmp, 'workspace'),
    expectedLabWorkspaceRoot: path.join(tmp, 'workspace'),
    productionAgentDir: path.join(tmp, 'prod-agent'),
    productionUserDataDir: path.join(tmp, 'prod-user-data'),
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.openSession({ workspaceId: 'ws', sessionId: 'existing' });
  assert.equal(snapshot.title, 'Existing Session');
  assert.deepEqual(await driver.getTranscript(snapshot.ref), [
    { role: 'user', text: 'Reopened hello' },
    { role: 'assistant', text: 'Reopened hi' },
  ]);
});

test('PiRpcDriver ignores benign closed-pipe stream failures after a run is already idle', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'idle-epipe' } };
      if (command.type === 'prompt') {
        for (const listener of this.listeners) {
          listener({ type: 'agent_start' });
          listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'RPC_OK' } });
          listener({ type: 'agent_end' });
          listener({ type: 'rpc_transport_closed', reason: 'stdout_error', error: 'write EPIPE' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'ok' });
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'RPC_OK'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted'), true);
  assert.equal(events.some((event) => event.type === 'runFailed'), false);
});

test('PiRpcDriver treats prompt EPIPE after run completion as benign', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'prompt-epipe' } };
      if (command.type === 'prompt') {
        for (const listener of this.listeners) {
          listener({ type: 'agent_start' });
          listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'RPC_OK' } });
          listener({ type: 'agent_end' });
        }
        throw new Error('write EPIPE');
      }
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/pi-gui-rpc-agent',
    sessionDir: '/tmp/pi-gui-rpc-sessions',
    userDataDir: '/tmp/pi-gui-rpc-user-data',
    labWorkspace: '/tmp/pi-gui-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/pi-gui-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/pi-gui-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'ok' });
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'RPC_OK'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted'), true);
  assert.equal(events.some((event) => event.type === 'runFailed'), false);
});
