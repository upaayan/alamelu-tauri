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
  buildWslPathEnvironment,
  buildWslPiRpcSpawnSpec,
  isWslPiExecutable,
  resolveRpcSpawnMode,
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
  assert.equal(expandHomePath('~/tmp/alamelu-pi-rpc-agent', home), '/Users/example/tmp/alamelu-pi-rpc-agent');

  const safe = validateLabPaths(
    {
      agentDir: '~/tmp/alamelu-pi-rpc-agent',
      sessionDir: '~/tmp/alamelu-pi-rpc-sessions',
      userDataDir: '~/tmp/alamelu-pi-rpc-user-data',
      labWorkspace: '~/tmp/alamelu-pi-rpc-workspace',
      productionAgentDir: '~/.pi/agent',
      productionUserDataDir: '~/Library/Application Support/pi-gui',
    },
    { homeDir: home },
  );
  assert.equal(safe.agentDir, '/Users/example/tmp/alamelu-pi-rpc-agent');
  assert.equal(safe.sessionDir, '/Users/example/tmp/alamelu-pi-rpc-sessions');

  assert.throws(
    () => validateLabPaths(
      {
        agentDir: '~/.pi/agent/lab',
        sessionDir: '~/tmp/alamelu-pi-rpc-sessions',
        userDataDir: '~/tmp/alamelu-pi-rpc-user-data',
        labWorkspace: '~/tmp/alamelu-pi-rpc-workspace',
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
        agentDir: '~/tmp/alamelu-pi-rpc-agent',
        sessionDir: '~/tmp/alamelu-pi-rpc-sessions',
        userDataDir: '~/tmp/alamelu-pi-rpc-user-data',
        labWorkspace: '~/playground/alamelu',
        productionAgentDir: '~/.pi/agent',
        productionUserDataDir: '~/Library/Application Support/pi-gui',
        expectedLabWorkspaceRoot: '~/tmp/alamelu-pi-rpc-workspace',
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
        agentDir: '~/tmp/alamelu-pi-rpc-agent',
        sessionDir: '~/tmp/alamelu-pi-rpc-sessions',
        userDataDir: '~/Library/Application Support/pi-gui/lab',
        labWorkspace: '~/tmp/alamelu-pi-rpc-workspace',
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

test('WSL launch wraps Pi RPC and translates session and extension paths', () => {
  const translated = new Map([
    ['C:\\Users\\Asus\\AppData\\Local\\Alamelu\\sessions', '/mnt/c/Users/Asus/AppData/Local/Alamelu/sessions'],
    ['C:\\Program Files\\Alamelu\\recovery.ts', '/mnt/c/Program Files/Alamelu/recovery.ts'],
  ]);
  const spec = buildWslPiRpcSpawnSpec(
    {
      piBin: 'C:\\Windows\\System32\\wsl.exe',
      cwd: '\\\\wsl.localhost\\Ubuntu\\home\\ubuntu\\playground\\alamelu',
      agentDir: '\\\\wsl.localhost\\Ubuntu\\home\\ubuntu\\.pi\\agent',
      sessionDir: 'C:\\Users\\Asus\\AppData\\Local\\Alamelu\\sessions',
      extensionPaths: ['C:\\Program Files\\Alamelu\\recovery.ts'],
      noTools: false,
      noExtensions: false,
      noSkills: false,
      env: { WSLENV: 'EXISTING/u' },
    },
    'C:\\Windows\\System32\\wsl.exe',
    (value) => translated.get(value) ?? value,
  );

  assert.equal(spec.command, 'C:\\Windows\\System32\\wsl.exe');
  assert.deepEqual(spec.args.slice(0, 11), [
    '--cd',
    '\\\\wsl.localhost\\Ubuntu\\home\\ubuntu\\playground\\alamelu',
    '--exec',
    'bash',
    '-lic',
    'exec pi "$@"',
    'alamelu-pi',
    '--mode',
    'rpc',
    '--session-dir',
    '/mnt/c/Users/Asus/AppData/Local/Alamelu/sessions',
  ]);
  assert.deepEqual(spec.args.slice(-2), ['--extension', '/mnt/c/Program Files/Alamelu/recovery.ts']);
  assert.equal(spec.env.PI_CODING_AGENT_DIR, '\\\\wsl.localhost\\Ubuntu\\home\\ubuntu\\.pi\\agent');
  assert.equal(spec.env.WSLENV, 'EXISTING/u:PI_CODING_AGENT_DIR/p:PI_CODING_AGENT_SESSION_DIR/p');
});

test('WSL command detection is Windows-path aware and preserves existing WSLENV entries', () => {
  assert.equal(isWslPiExecutable('C:\\Windows\\System32\\wsl.exe'), true);
  assert.equal(isWslPiExecutable('/usr/local/bin/pi'), false);
  assert.deepEqual(resolvePiRpcSpawnCommand('C:\\Windows\\System32\\wsl.exe', 'C:\\Windows\\System32\\wsl.exe'), {
    command: 'C:\\Windows\\System32\\wsl.exe',
    args: ['--exec', 'bash', '-lic', 'exec pi "$@"', 'alamelu-pi'],
  });
  assert.equal(
    buildWslPathEnvironment(
      { WSLENV: 'PI_CODING_AGENT_DIR/p' },
      ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR'],
    ).WSLENV,
    'PI_CODING_AGENT_DIR/p:PI_CODING_AGENT_SESSION_DIR/p',
  );
});

test('Windows RPC children stay headless without a detached console', () => {
  assert.deepEqual(resolveRpcSpawnMode('win32'), {
    detached: false,
    windowsHide: true,
  });
  assert.deepEqual(resolveRpcSpawnMode('darwin'), {
    detached: true,
    windowsHide: false,
  });
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

test('buildPiRpcSpawnSpec loads explicit app-owned recovery extensions without disabling user extensions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-extension-spawn-'));
  const piBin = path.join(tmp, 'pi');
  fs.writeFileSync(piBin, '#!/bin/sh\n', { mode: 0o755 });
  const extensionPath = '/tmp/alpi-luna-websocket-recovery.mjs';
  const spec = buildPiRpcSpawnSpec({
    piBin,
    cwd: '/tmp/alpi-workspace',
    agentDir: path.join(os.homedir(), '.pi', 'agent'),
    sessionDir: '/tmp/alpi-sessions',
    noExtensions: false,
    extensionPaths: [extensionPath],
  });

  const extensionIndex = spec.args.indexOf('--extension');
  assert.equal(extensionIndex >= 0, true);
  assert.equal(spec.args[extensionIndex + 1], extensionPath);
  assert.equal(spec.args.includes('--no-extensions'), false);
});

test('spawnPiRpcClient rejects PATH-relative pi binaries', () => {
  assert.throws(
    () => spawnPiRpcClient({
      piBin: 'pi',
      cwd: '/tmp/alamelu-pi-rpc-workspace',
      agentDir: '/tmp/alamelu-pi-rpc-agent',
      sessionDir: '/tmp/alamelu-pi-rpc-sessions',
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
        labWorkspace: '~/tmp/alamelu-pi-rpc-workspace',
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

  for (const stopReason of ['stop', 'toolUse', 'length']) {
    const events = mapRpcEventToSessionDriverEvents({ type: 'message_end', message: { role: 'assistant', stopReason } }, base);
    assert.deepEqual(events, [{ type: 'assistantMessageCompleted', sessionRef, timestamp: '2026-01-01T00:00:00.000Z', runId: 'run-1' }]);
  }
  for (const message of [{ role: 'user' }, { role: 'toolResult' }, { role: 'assistant', stopReason: 'error' }]) {
    assert.deepEqual(mapRpcEventToSessionDriverEvents({ type: 'message_end', message }, base), []);
  }

  assert.deepEqual(mapRpcEventToSessionDriverEvents({ type: 'agent_end', willRetry: false }, base), [], 'agent_end may still be followed by retry/compaction/queued work');
  const completed = mapRpcEventToSessionDriverEvents({ type: 'agent_settled' }, { ...base, snapshot: { ...snapshot, status: 'idle', runningRunId: undefined } });
  assert.equal(completed[0].type, 'runCompleted');
  assert.equal(completed[0].snapshot.status, 'idle');

  const failed = mapRpcEventToSessionDriverEvents({ type: 'message_update', assistantMessageEvent: { type: 'error', error: 'bad' } }, base);
  assert.equal(failed[0].type, 'runFailed');
});

test('PiRpcDriver rejects createSession workspace paths outside the lab workspace', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
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
  let now = '2026-09-12T12:00:00.000Z';
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    now: () => now,
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

  const ref = { workspaceId: 'ws', sessionId: 'existing-session' };
  const storedUpdatedAt = '2026-01-01T00:00:00.000Z';
  const events = [];
  const unsubscribe = driver.subscribe(ref, (event) => events.push(event));
  const snapshot = await driver.openSession(ref, storedUpdatedAt);
  assert.equal(snapshot.title, 'Cold Open');
  assert.equal(snapshot.ref.sessionId, 'existing-session');
  assert.equal(snapshot.updatedAt, storedUpdatedAt);
  assert.equal(events.find((event) => event.type === 'sessionOpened').snapshot.updatedAt, storedUpdatedAt);
  now = '2026-09-12T12:01:00.000Z';
  assert.equal((await driver.openSession(ref, storedUpdatedAt)).updatedAt, storedUpdatedAt);
  await driver.sendUserMessage(ref, { text: 'A real update' });
  assert.equal(events.findLast((event) => event.type === 'sessionUpdated').snapshot.updatedAt, now);
  // A subsequent warm read must not replace newer in-memory activity with an older catalog value.
  assert.equal((await driver.openSession(ref, storedUpdatedAt)).updatedAt, now);
  unsubscribe();
  await driver.closeSession(ref);
});

test('PiRpcDriver lets Pi generate a new session ID and adopts the returned ID', async (t) => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-new-session-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const requestedSessionIds = [];

  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') {
        return {
          type: 'response',
          id,
          command: 'get_state',
          success: true,
          data: { sessionId: '019f4ffe-4979-775a-ad74-b0d99a56bee8', sessionName: 'Pi Generated' },
        };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }

  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: path.join(tmp, 'agent'),
    sessionDir: path.join(tmp, 'sessions'),
    userDataDir: path.join(tmp, 'user-data'),
    labWorkspace: path.join(tmp, 'workspace'),
    expectedLabWorkspaceRoot: path.join(tmp, 'workspace'),
    productionAgentDir: path.join(tmp, 'prod-agent'),
    productionUserDataDir: path.join(tmp, 'prod-user-data'),
    rpcClientFactory: ({ sessionId }) => {
      requestedSessionIds.push(sessionId);
      return new FakeClient();
    },
  });

  const snapshot = await driver.createSession({ workspaceId: 'ws', path: path.join(tmp, 'workspace') });

  assert.deepEqual(requestedSessionIds, [undefined]);
  assert.equal(snapshot.ref.sessionId, '019f4ffe-4979-775a-ad74-b0d99a56bee8');
  assert.equal(snapshot.title, 'Pi Generated');
});

test('PiRpcDriver rejects a new session when Pi does not return its generated session ID', async (t) => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-missing-session-id-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fake = new class {
    closed = false;
    onEvent() { return () => undefined; }
    close() { this.closed = true; }
    async sendCommand(command, id) {
      if (command.type === 'get_state') {
        return { type: 'response', id, command: 'get_state', success: true, data: { sessionName: 'Missing ID' } };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }();

  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: path.join(tmp, 'agent'),
    sessionDir: path.join(tmp, 'sessions'),
    userDataDir: path.join(tmp, 'user-data'),
    labWorkspace: path.join(tmp, 'workspace'),
    expectedLabWorkspaceRoot: path.join(tmp, 'workspace'),
    productionAgentDir: path.join(tmp, 'prod-agent'),
    productionUserDataDir: path.join(tmp, 'prod-user-data'),
    rpcClientFactory: () => fake,
  });

  await assert.rejects(
    () => driver.createSession({ workspaceId: 'ws', path: path.join(tmp, 'workspace') }),
    /did not return a Pi session ID/,
  );
  assert.equal(fake.closed, true);
});

test('PiRpcDriver emits runFailed and returns to idle when prompt command fails', async () => {
  const { createPiRpcDriver, NO_RPC_DEADLINE } = await import('../dist/index.js');
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  // Send resolves at app-level acceptance; Pi's rejection arrives as a runFailed event.
  await driver.sendUserMessage(snapshot.ref, { text: 'fail' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(promptTimeoutMs, NO_RPC_DEADLINE);
  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'nope'), true);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
  assert.equal('runningRunId' in lastUpdate.snapshot, false);
});

test('PiRpcDriver still rejects the methods it does not implement', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient { onEvent() { return () => undefined; } close() {} async sendCommand(command, id) { if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-unsupported', sessionName: 'RPC Unsupported' } }; return { type: 'response', id, command: command.type, success: true }; } }
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data', labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => new FakeClient() });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  // getSessionTree / navigateSessionTree / compactSession are implemented against pi's
  // own RPC commands (see tree-compact.test.mjs); these three remain unimplemented.
  await assert.rejects(() => driver.archiveSession(snapshot.ref), /not supported/);
  await assert.rejects(() => driver.unarchiveSession(snapshot.ref), /not supported/);
  await assert.rejects(() => driver.replaceQueuedMessages(snapshot.ref, []), /not supported/);
});

test('PiRpcDriver maps steer and followUp delivery modes while a session is running', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const commands = [];
  class FakeClient { onEvent() { return () => undefined; } close() {} async sendCommand(command, id) { commands.push(command); if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-delivery-mode', sessionName: 'RPC Delivery Mode' } }; return { type: 'response', id, command: command.type, success: true }; } }
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data', labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => new FakeClient() });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  await assert.rejects(() => driver.sendUserMessage(snapshot.ref, { text: 'too early', deliverAs: 'steer' }), /require a running session/);
  await driver.sendUserMessage(snapshot.ref, { text: 'first' });
  await driver.sendUserMessage(snapshot.ref, { text: 'steer', deliverAs: 'steer' });
  await driver.sendUserMessage(snapshot.ref, { text: 'follow', deliverAs: 'followUp' });
  assert.deepEqual(commands.map((command) => command.type), ['get_state', 'prompt', 'steer', 'follow_up']);
});

test('PiRpcDriver rejects a second user message while a run is active', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient { onEvent() { return () => undefined; } close() {} async sendCommand(command, id) { if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-reentrant', sessionName: 'RPC Reentrant' } }; if (command.type === 'prompt') return { type: 'response', id, command: 'prompt', success: true }; return { type: 'response', id, command: command.type, success: true }; } }
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data', labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => new FakeClient() });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  await driver.sendUserMessage(snapshot.ref, { text: 'first' });
  await assert.rejects(() => driver.sendUserMessage(snapshot.ref, { text: 'second' }), /already running/);
});

test('PiRpcDriver cancel success returns running session to idle and emits runCancelled', async () => {
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'hang' });
  await driver.cancelCurrentRun(snapshot.ref);
  // A user-initiated stop is reported as a cancellation, never as a failure.
  assert.equal(events.some((event) => event.type === 'runCancelled'), true);
  assert.equal(events.some((event) => event.type === 'runFailed'), false);
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data', labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', now: () => '2026-01-01T00:00:00.000Z', rpcClientFactory: () => fake });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data', labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => fake });
  await assert.rejects(() => driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' }), /setup failed/);
  assert.equal(fake.closed, true);
});

test('PiRpcDriver closes client if createSession initial model setup fails', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const fake = new class { closed = false; onEvent() { return () => undefined; } close() { this.closed = true; } async sendCommand(command, id) { if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'setup-model' } }; return { type: 'response', id, command: command.type, success: false, error: 'model failed' }; } }();
  const driver = createPiRpcDriver({ piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data', labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace', productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui', rpcClientFactory: () => fake });
  await assert.rejects(() => driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' }, { initialModel: { provider: 'xai', modelId: 'bad' } }), /model failed/);
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
          listener({ type: 'agent_settled' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'explode' });
  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'stream exploded'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted'), false);
  const lastUpdate = events.filter((event) => event.type === 'sessionUpdated').at(-1);
  assert.equal(lastUpdate.snapshot.status, 'idle');
  assert.equal('runningRunId' in lastUpdate.snapshot, false);
});

test('PiRpcDriver keeps the run active across Pi retry after a finalized assistant transport error', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-message-end-retry', sessionName: 'RPC Message End Retry' } };
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({
          type: 'message_end',
          message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'WebSocket error' },
        });
        this.emit({ type: 'agent_end', willRetry: true });
        this.emit({ type: 'agent_start' });
        this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'RECOVERED_AFTER_RETRY' } });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const fake = new FakeClient();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));

  await driver.sendUserMessage(snapshot.ref, { text: 'retry after transport failure' });

  const recoveredDeltaIndex = events.findIndex((event) => event.type === 'assistantDelta' && event.text === 'RECOVERED_AFTER_RETRY');
  const completedIndex = events.findIndex((event) => event.type === 'runCompleted');
  assert.equal(events.some((event) => event.type === 'runFailed'), false);
  assert.equal(recoveredDeltaIndex >= 0, true);
  assert.equal(completedIndex > recoveredDeltaIndex, true);
  assert.equal(events.filter((event) => event.type === 'runCompleted').length, 1);
});

test('PiRpcDriver reports a finalized assistant error only after Pi declines to retry', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    listeners = new Set();
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      if (command.type === 'get_state') return { type: 'response', id, command: 'get_state', success: true, data: { sessionId: 'rpc-message-end-final', sessionName: 'RPC Message End Final' } };
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({
          type: 'message_end',
          message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'WebSocket error' },
        });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const fake = new FakeClient();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));

  await driver.sendUserMessage(snapshot.ref, { text: 'report final transport failure' });

  assert.equal(events.some((event) => event.type === 'runFailed' && event.error.message === 'WebSocket error'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted'), false);
  assert.equal(events.filter((event) => event.type === 'sessionUpdated').at(-1).snapshot.status, 'idle');
});

test('PiRpcDriver internally reopens a successful Luna thread before its next prompt', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    commands = [];
    listeners = new Set();
    closed = false;
    constructor(name) { this.name = name; }
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() { this.closed = true; }
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') return {
        type: 'response', id, command: 'get_state', success: true,
        data: { sessionId: 'successful-luna-session', sessionName: 'Successful Luna', model: { provider: 'openai-codex', id: 'gpt-5.6-luna' }, thinkingLevel: 'xhigh' },
      };
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: `${this.name}_OK` } });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const first = new FakeClient('FIRST');
  const second = new FakeClient('SECOND');
  const contexts = [];
  const clients = [first, second];
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: (context) => { contexts.push(context); return clients.shift(); },
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, initialThinkingLevel: 'xhigh' },
  );

  await driver.sendUserMessage(snapshot.ref, { text: 'first successful turn' });
  await driver.sendUserMessage(snapshot.ref, { text: 'second successful turn' });

  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].sessionId, 'successful-luna-session');
  assert.equal(first.closed, true);
  assert.deepEqual(first.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['first successful turn']);
  assert.deepEqual(second.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['second successful turn']);
});

test('PiRpcDriver lets Pi finish a Luna retry, then rotates the recovered child before the following prompt', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    commands = [];
    listeners = new Set();
    closed = false;
    constructor(name) { this.name = name; }
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() { this.closed = true; }
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') return {
        type: 'response', id, command: 'get_state', success: true,
        data: { sessionId: 'retried-luna-session', sessionName: 'Retried Luna', model: { provider: 'openai-codex', id: 'gpt-5.6-luna' }, thinkingLevel: 'xhigh' },
      };
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        if (this.name === 'RETRY') {
          this.emit({ type: 'message_end', message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'WebSocket error' } });
          this.emit({ type: 'agent_end', willRetry: true });
          this.emit({ type: 'agent_start' });
        }
        this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: `${this.name}_OK` } });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const retrying = new FakeClient('RETRY');
  const replacement = new FakeClient('FRESH');
  const clients = [retrying, replacement];
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => clients.shift(),
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, initialThinkingLevel: 'xhigh' },
  );
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));

  await driver.sendUserMessage(snapshot.ref, { text: 'recover this exact turn' });
  await driver.sendUserMessage(snapshot.ref, { text: 'next turn uses fresh child' });

  assert.equal(events.some((event) => event.type === 'runFailed'), false);
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'RETRY_OK'), true);
  assert.equal(retrying.closed, true);
  assert.deepEqual(retrying.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['recover this exact turn']);
  assert.deepEqual(replacement.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['next turn uses fresh child']);
});

test('PiRpcDriver leaves Sol and Terra children running across successful idle prompts', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    commands = [];
    listeners = new Set();
    closed = false;
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() { this.closed = true; }
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') return {
        type: 'response', id, command: 'get_state', success: true,
        data: { sessionId: 'terra-session', sessionName: 'Terra', model: { provider: 'openai-codex', id: 'gpt-5.6-terra' }, thinkingLevel: 'xhigh' },
      };
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const client = new FakeClient();
  let factoryCalls = 0;
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => { factoryCalls += 1; return client; },
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-terra' }, initialThinkingLevel: 'xhigh' },
  );
  await driver.sendUserMessage(snapshot.ref, { text: 'Terra first' });
  await driver.sendUserMessage(snapshot.ref, { text: 'Terra second' });

  assert.equal(factoryCalls, 1);
  assert.equal(client.closed, false);
  assert.deepEqual(client.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['Terra first', 'Terra second']);
});

test('PiRpcDriver keeps the previous Luna child intact if its internal reopen fails', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  class FakeClient {
    commands = [];
    listeners = new Set();
    closed = false;
    constructor(name, openSucceeds = true) { this.name = name; this.openSucceeds = openSucceeds; }
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() { this.closed = true; }
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') {
        if (!this.openSucceeds) return { type: 'response', id, command: 'get_state', success: false, error: 'replacement unavailable' };
        return {
          type: 'response', id, command: 'get_state', success: true,
          data: { sessionId: 'replace-failure-luna', sessionName: 'Luna', model: { provider: 'openai-codex', id: 'gpt-5.6-luna' }, thinkingLevel: 'xhigh' },
        };
      }
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const original = new FakeClient('original');
  const failedReplacement = new FakeClient('failed-replacement', false);
  const laterReplacement = new FakeClient('later-replacement');
  const clients = [original, failedReplacement, laterReplacement];
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => clients.shift(),
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, initialThinkingLevel: 'xhigh' },
  );
  await driver.sendUserMessage(snapshot.ref, { text: 'first turn makes child recyclable' });

  await assert.rejects(() => driver.sendUserMessage(snapshot.ref, { text: 'must not reach old child' }), /replacement unavailable/);
  assert.equal(original.closed, false);
  assert.equal(failedReplacement.closed, true);
  assert.deepEqual(original.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['first turn makes child recyclable']);

  await driver.sendUserMessage(snapshot.ref, { text: 'later retry opens a fresh child' });
  assert.equal(original.closed, true);
  assert.deepEqual(laterReplacement.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['later retry opens a fresh child']);
});

test('PiRpcDriver waits for an internal Luna reopen before sending a concurrent model change', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  let releaseReplacementState;
  const replacementStateReady = new Promise((resolve) => { releaseReplacementState = resolve; });

  class FakeClient {
    commands = [];
    listeners = new Set();
    closed = false;
    constructor(name) { this.name = name; }
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() { this.closed = true; }
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') {
        if (this.name === 'replacement') await replacementStateReady;
        return {
          type: 'response', id, command: 'get_state', success: true,
          data: { sessionId: 'concurrent-luna-session', sessionName: 'Luna', model: { provider: 'openai-codex', id: 'gpt-5.6-luna' }, thinkingLevel: 'xhigh' },
        };
      }
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const original = new FakeClient('original');
  const replacement = new FakeClient('replacement');
  const clients = [original, replacement];
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => clients.shift(),
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, initialThinkingLevel: 'xhigh' },
  );
  await driver.sendUserMessage(snapshot.ref, { text: 'first turn' });
  const originalSetModelCalls = original.commands.filter((command) => command.type === 'set_model').length;

  const modelChange = driver.setSessionModel(snapshot.ref, { provider: 'openai-codex', modelId: 'gpt-5.6-sol' });
  const secondPrompt = driver.sendUserMessage(snapshot.ref, { text: 'second turn' });
  await Promise.resolve();
  assert.equal(original.commands.filter((command) => command.type === 'set_model').length, originalSetModelCalls);
  assert.equal(replacement.commands.some((command) => command.type === 'set_model'), false);

  releaseReplacementState();
  await Promise.all([secondPrompt, modelChange]);
  assert.equal(original.commands.filter((command) => command.type === 'set_model').length, originalSetModelCalls);
  assert.equal(replacement.commands.some((command) => command.type === 'set_model' && command.modelId === 'gpt-5.6-sol'), true);
});

test('PiRpcDriver rejects a model change queued after the replacement prompt has started', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  let releaseReplacementState;
  const replacementStateReady = new Promise((resolve) => { releaseReplacementState = resolve; });
  class FakeClient {
    commands = [];
    listeners = new Set();
    constructor(name) { this.name = name; }
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {}
    emit(event) { for (const listener of this.listeners) listener(event); }
    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') {
        if (this.name === 'replacement') await replacementStateReady;
        return {
          type: 'response', id, command: 'get_state', success: true,
          data: { sessionId: 'send-first-luna-session', sessionName: 'Luna', model: { provider: 'openai-codex', id: 'gpt-5.6-luna' }, thinkingLevel: 'xhigh' },
        };
      }
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        if (this.name === 'original') {
          this.emit({ type: 'agent_end', willRetry: false });
          this.emit({ type: 'agent_settled' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }
  const original = new FakeClient('original');
  const replacement = new FakeClient('replacement');
  const clients = [original, replacement];
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi', agentDir: '/tmp/alamelu-pi-rpc-agent', sessionDir: '/tmp/alamelu-pi-rpc-sessions', userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace', expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent', productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => clients.shift(),
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, initialThinkingLevel: 'xhigh' },
  );
  await driver.sendUserMessage(snapshot.ref, { text: 'first turn' });
  const originalSetModelCalls = original.commands.filter((command) => command.type === 'set_model').length;

  const secondPrompt = driver.sendUserMessage(snapshot.ref, { text: 'second turn starts first' });
  const modelChange = driver.setSessionModel(snapshot.ref, { provider: 'openai-codex', modelId: 'gpt-5.6-sol' });
  releaseReplacementState();
  await secondPrompt;
  await assert.rejects(modelChange, /session is running/);

  assert.equal(original.commands.filter((command) => command.type === 'set_model').length, originalSetModelCalls);
  assert.equal(replacement.commands.some((command) => command.type === 'set_model'), false);
  await driver.closeSession(snapshot.ref);
});

test('PiRpcDriver replaces only a tainted Luna child before the next prompt and ignores late old-child events', async () => {
  const { createPiRpcDriver } = await import('../dist/index.js');

  class FakeClient {
    commands = [];
    listeners = new Set();
    lastListener;
    closed = false;

    constructor(name, sessionId = 'luna-recovery-session') {
      this.name = name;
      this.sessionId = sessionId;
    }

    onEvent(listener) {
      this.lastListener = listener;
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    close() { this.closed = true; }

    emit(event) { for (const listener of this.listeners) listener(event); }

    emitLate(event) { this.lastListener?.(event); }

    async sendCommand(command, id) {
      this.commands.push(command);
      if (command.type === 'get_state') {
        return {
          type: 'response', id, command: 'get_state', success: true,
          data: {
            sessionId: this.sessionId,
            sessionName: 'Luna Recovery',
            model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
            thinkingLevel: 'xhigh',
          },
        };
      }
      if (command.type === 'prompt') {
        this.emit({ type: 'agent_start' });
        if (this.name === 'initial') {
          this.emit({
            type: 'message_end',
            message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'Model not found gpt-5.6-luna' },
          });
          this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        } else {
          this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'FRESH_CHILD_OK' } });
          this.emit({ type: 'agent_end', willRetry: false });
        this.emit({ type: 'agent_settled' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }

  const initial = new FakeClient('initial');
  const replacement = new FakeClient('replacement');
  const factoryContexts = [];
  const clients = [initial, replacement];
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: (context) => { factoryContexts.push(context); return clients.shift(); },
  });
  const snapshot = await driver.createSession(
    { workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' },
    { initialModel: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, initialThinkingLevel: 'xhigh' },
  );
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));

  await driver.sendUserMessage(snapshot.ref, { text: 'first Luna turn' });
  await driver.sendUserMessage(snapshot.ref, { text: 'second Luna turn' });

  assert.equal(factoryContexts.length, 2);
  assert.equal(factoryContexts[0].sessionId, undefined);
  assert.equal(factoryContexts[1].sessionId, 'luna-recovery-session');
  assert.equal(initial.closed, true);
  assert.deepEqual(initial.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['first Luna turn']);
  assert.deepEqual(replacement.commands.filter((command) => command.type === 'prompt').map((command) => command.message), ['second Luna turn']);
  assert.equal(events.some((event) => event.type === 'sessionClosed'), false);

  const eventCount = events.length;
  initial.emitLate({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'STALE_OLD_CHILD' } });
  initial.emitLate({ type: 'agent_end', willRetry: false });
  assert.equal(events.length, eventCount);
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'STALE_OLD_CHILD'), false);
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'FRESH_CHILD_OK'), true);
});

test('PiRpcDriver restores Luna model and thinking configuration from a reopened Pi session', async (t) => {
  const { createPiRpcDriver } = await import('../dist/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-reopen-state-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sessionDir = path.join(tmp, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'x_existing-luna.jsonl'), '');

  class FakeClient {
    onEvent() { return () => undefined; }
    close() {}
    async sendCommand(command, id) {
      if (command.type === 'get_state') {
        return {
          type: 'response', id, command: 'get_state', success: true,
          data: {
            sessionId: 'existing-luna',
            sessionName: 'Reopened Luna',
            model: { provider: 'openai-codex', id: 'gpt-5.6-luna' },
            thinkingLevel: 'xhigh',
          },
        };
      }
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
    rpcClientFactory: () => new FakeClient(),
  });

  const snapshot = await driver.openSession({ workspaceId: 'ws', sessionId: 'existing-luna' });
  assert.deepEqual(snapshot.config, { provider: 'openai-codex', modelId: 'gpt-5.6-luna', thinkingLevel: 'xhigh' });
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
          listener({ type: 'agent_settled' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true };
    }
  }

  const fake = new FakeClient();
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    now: () => '2026-01-01T00:00:00.000Z',
    rpcClientFactory: () => fake,
  });

  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const transcript = await driver.getTranscript(snapshot.ref);
  // Transcript items now carry kind/id/createdAt; ids are generated, so compare meaning.
  assert.deepEqual(
    transcript.map(({ kind, role, text }) => ({ kind, role, text })),
    [
      { kind: 'message', role: 'user', text: 'Hello RPC' },
      { kind: 'message', role: 'assistant', text: 'Hello human' },
    ],
  );
  assert.ok(transcript.every((item) => item.id && item.createdAt));
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
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  assert.deepEqual(
    (await driver.getTranscript(snapshot.ref)).map(({ kind, role, text }) => ({ kind, role, text })),
    [{ kind: 'message', role: 'assistant', text: 'Fallback assistant text' }],
  );
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
  assert.deepEqual(
    (await driver.getTranscript(snapshot.ref)).map(({ kind, role, text }) => ({ kind, role, text })),
    [
      { kind: 'message', role: 'user', text: 'Reopened hello' },
      { kind: 'message', role: 'assistant', text: 'Reopened hi' },
    ],
  );
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
          listener({ type: 'agent_settled' });
          listener({ type: 'rpc_transport_closed', reason: 'stdout_error', error: 'write EPIPE' });
        }
        return { type: 'response', id, command: 'prompt', success: true };
      }
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
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
          listener({ type: 'agent_settled' });
        }
        throw new Error('write EPIPE');
      }
      return { type: 'response', id, command: command.type, success: true, data: {} };
    }
  }
  const driver = createPiRpcDriver({
    piBin: '/usr/local/bin/pi',
    agentDir: '/tmp/alamelu-pi-rpc-agent',
    sessionDir: '/tmp/alamelu-pi-rpc-sessions',
    userDataDir: '/tmp/alamelu-pi-rpc-user-data',
    labWorkspace: '/tmp/alamelu-pi-rpc-workspace',
    expectedLabWorkspaceRoot: '/tmp/alamelu-pi-rpc-workspace',
    productionAgentDir: '/Users/example/.pi/agent',
    productionUserDataDir: '/Users/example/Library/Application Support/pi-gui',
    rpcClientFactory: () => new FakeClient(),
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: '/tmp/alamelu-pi-rpc-workspace' });
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.sendUserMessage(snapshot.ref, { text: 'ok' });
  assert.equal(events.some((event) => event.type === 'assistantDelta' && event.text === 'RPC_OK'), true);
  assert.equal(events.some((event) => event.type === 'runCompleted'), true);
  assert.equal(events.some((event) => event.type === 'runFailed'), false);
});
