import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPiRpcDriver } from '../dist/index.js';

/** Opens a session against a fake pi that answers with `responder`. */
async function openDriver(responder) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-tree-'));
  const agentDir = path.join(root, 'agent');
  const sessionDir = path.join(root, 'sessions');
  const userDataDir = path.join(root, 'user-data');
  const labWorkspace = path.join(root, 'workspace');
  for (const dir of [agentDir, sessionDir, userDataDir, labWorkspace]) fs.mkdirSync(dir, { recursive: true });

  const sent = [];
  const client = {
    sendCommand: async (command, _id, timeoutMs) => {
      sent.push({ command, timeoutMs });
      if (command.type === 'get_state') {
        return { type: 'response', success: true, data: { sessionId: 'sess-1', sessionName: 'Tree session' } };
      }
      return responder(command);
    },
    onEvent: () => () => undefined,
    close: () => undefined,
  };

  const driver = createPiRpcDriver({
    piBin: 'pi',
    agentDir,
    sessionDir,
    userDataDir,
    labWorkspace,
    allowRealPiState: true,
    allowProductionUserData: true,
    allowRealWorkspace: true,
    rpcClientFactory: () => client,
  });
  const snapshot = await driver.createSession({ workspaceId: 'ws', path: labWorkspace });
  return { driver, snapshot, sent };
}

test('compactSession sends compact with no acknowledgement deadline', async () => {
  const { NO_RPC_DEADLINE } = await import('../dist/index.js');
  const { driver, snapshot, sent } = await openDriver(() => ({ type: 'response', success: true }));
  await driver.compactSession(snapshot.ref, 'keep the API notes');

  const compact = sent.find((entry) => entry.command.type === 'compact');
  assert.ok(compact, 'a compact command must be sent');
  assert.equal(compact.command.customInstructions, 'keep the API notes');
  assert.equal(compact.timeoutMs, NO_RPC_DEADLINE, 'compaction legitimately outlives any fixed deadline');
});

test('compactSession surfaces a pi-side failure through events after acceptance', async () => {
  const { driver, snapshot } = await openDriver((command) =>
    command.type === 'compact'
      ? { type: 'response', success: false, error: 'nothing to compact' }
      : { type: 'response', success: true },
  );
  const events = [];
  driver.subscribe(snapshot.ref, (event) => events.push(event));
  await driver.compactSession(snapshot.ref);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const failed = events.find((event) => event.type === 'runFailed');
  assert.ok(failed, 'a rejected compact with no compaction_end is reported once');
  assert.match(failed.error.message, /nothing to compact/);
  assert.equal(events.filter((event) => event.type === 'runFailed').length, 1);
  assert.equal(events.filter((event) => 'snapshot' in event).at(-1).snapshot.status, 'idle');
});

test('getSessionTree maps pi entry kinds, labels and previews', async () => {
  const tree = [
    {
      entry: { type: 'session_info', id: 'e1', parentId: null, timestamp: '2026-07-26T10:00:00Z', name: 'Root' },
      children: [
        {
          entry: {
            type: 'message',
            id: 'e2',
            parentId: 'e1',
            timestamp: '2026-07-26T10:01:00Z',
            message: { role: 'user', content: 'hello there' },
          },
          children: [],
          label: 'first ask',
        },
        {
          entry: { type: 'model_change', id: 'e3', parentId: 'e1', timestamp: '2026-07-26T10:02:00Z', provider: 'xai', modelId: 'grok-4.5' },
          children: [],
        },
      ],
    },
  ];
  const { driver, snapshot } = await openDriver((command) =>
    command.type === 'get_tree'
      ? { type: 'response', success: true, data: { tree, leafId: 'e3' } }
      : { type: 'response', success: true },
  );

  const result = await driver.getSessionTree(snapshot.ref);
  assert.equal(result.leafId, 'e3');
  assert.equal(result.roots.length, 1);

  const root = result.roots[0];
  assert.equal(root.kind, 'session_info');
  assert.equal(root.title, 'Root');
  assert.equal(root.parentId, null);
  assert.equal(root.children.length, 2);

  const message = root.children[0];
  assert.equal(message.kind, 'message');
  assert.equal(message.role, 'user');
  assert.equal(message.label, 'first ask');
  assert.equal(message.title, 'first ask', 'an explicit label wins over the derived title');
  assert.equal(message.preview, 'hello there');

  assert.equal(root.children[1].title, 'Model: xai/grok-4.5');
});

test('getSessionTree hoists children of an unknown entry kind instead of losing them', async () => {
  const tree = [
    {
      entry: { type: 'some_future_kind', id: 'x1', parentId: null, timestamp: '2026-07-26T10:00:00Z' },
      children: [
        { entry: { type: 'compaction', id: 'x2', parentId: 'x1', timestamp: '2026-07-26T10:01:00Z' }, children: [] },
      ],
    },
  ];
  const { driver, snapshot } = await openDriver((command) =>
    command.type === 'get_tree'
      ? { type: 'response', success: true, data: { tree, leafId: null } }
      : { type: 'response', success: true },
  );

  const result = await driver.getSessionTree(snapshot.ref);
  assert.equal(result.roots.length, 1, 'the surviving child is hoisted to the root');
  assert.equal(result.roots[0].kind, 'compaction');
  assert.equal(result.roots[0].title, 'Compacted');
});

test('navigateSessionTree forks to the target entry and returns its editor text', async () => {
  const { driver, snapshot, sent } = await openDriver((command) =>
    command.type === 'fork'
      ? { type: 'response', success: true, data: { text: 'restored draft', cancelled: false } }
      : { type: 'response', success: true },
  );

  const result = await driver.navigateSessionTree(snapshot.ref, 'e2');
  const fork = sent.find((entry) => entry.command.type === 'fork');
  assert.equal(fork.command.entryId, 'e2');
  assert.equal(result.cancelled, false);
  assert.equal(result.editorText, 'restored draft');
});

test('navigateSessionTree reports a cancelled fork without claiming success', async () => {
  const { driver, snapshot } = await openDriver((command) =>
    command.type === 'fork'
      ? { type: 'response', success: true, data: { cancelled: true } }
      : { type: 'response', success: true },
  );
  const result = await driver.navigateSessionTree(snapshot.ref, 'e2');
  assert.equal(result.cancelled, true);
  assert.equal(result.editorText, undefined);
});

test('context preflight fetches current Pi messages again after each compaction', async () => {
  let generation = 0;
  const { driver, snapshot, sent } = await openDriver((command) => {
    if(command.type === 'compact') generation++;
    return {type:'response',success:true,data:{messages:[{role:'compactionSummary',summary:`Summary ${generation}`},{role:'user',content:'Recent turn'}]}};
  });
  for (let i=1;i<=2;i++) {
    await driver.compactSession(snapshot.ref);
    await new Promise(resolve=>setImmediate(resolve));
    const messages=await driver.getSessionContextMessages(snapshot.ref);
    assert.equal(messages[0].summary,`Summary ${i}`);
  }
  assert.equal(sent.filter(x=>x.command.type==='get_messages').length,2);
});

test('unavailable RPC context is unknown rather than archive-size fallback',async()=>{
  const {driver,snapshot}=await openDriver(()=>({type:'response',success:false,error:'unsupported'}));
  assert.equal(await driver.getSessionContextMessages(snapshot.ref),undefined);
});

test('context transport errors defer size enforcement to Pi',async()=>{
  const {driver,snapshot}=await openDriver(()=>{throw new Error('transport closed');});
  assert.equal(await driver.getSessionContextMessages(snapshot.ref),undefined);
});
