import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@earendil-works/pi-ai/compat';
import { prepareCursorProviderTurn, resolveCursorProviderTurnConfig } from '../src/cursor-provider-turn-prepare.js';
import { resetSessionCursorAgent, invalidateSessionAgent } from '../src/cursor-session-agent.js';
import { prepareCursorSessionForCompaction } from '../src/cursor-session-compaction-prep.js';
import { releaseAllPendingCursorLiveRunsForTests } from '../src/cursor-provider-live-run-drain.js';
import { makeModel, makePartial, makeStream } from './auth-recreate-fixtures.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), createRun: vi.fn(), dispose: vi.fn() }));
vi.mock('../src/cursor-sdk-runtime.js', () => ({ loadCursorSdk: async () => ({ Agent: { create: mocks.create } }) }));
vi.mock('../src/cursor-sdk-output-filter.js', () => ({ installCursorSdkOutputFilter: () => () => {}, suppressCursorSdkOutput: (fn: () => unknown) => fn() }));
vi.mock('../src/cursor-mcp-timeout-override.js', () => ({ installCursorMcpToolTimeoutOverride: () => {} }));
vi.mock('../src/cursor-pi-tool-bridge.js', async (original) => ({ ...await original<object>(), getRegisteredCursorPiToolBridge: () => ({ createRun: mocks.createRun, getToolSurfaceSignature: () => 'fixture-tools' }) }));

const summary = (text: string, tools?: Context['tools']): Context => ({ systemPrompt: 'Summarize only.', messages: [{ role: 'user', content: text, timestamp: 1 }], ...(tools ? { tools } : {}) });
const normal: Context = { systemPrompt: 'Normal assistant.', messages: [{ role: 'user', content: 'Read fixture.txt', timestamp: 2 }], tools: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: {} } } as never] };
async function prepare(context: Context) {
  const config = resolveCursorProviderTurnConfig('/tmp');
  config.runtime.value = 'local'; config.local.resume.value = false;
  return prepareCursorProviderTurn({ params: { model: makeModel(), context, options: { apiKey: 'fixture-key' }, partial: makePartial(), stream: makeStream().stream, sdkEventDebugRef: {} }, cwd: '/tmp', resolvedApiKey: 'fixture-key', sdkEventDebug: undefined, throwIfAborted: () => {}, resolvedConfig: config });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockImplementation(async () => ({ agentId: `fixture-${mocks.create.mock.calls.length}`, [Symbol.asyncDispose]: mocks.dispose }));
  mocks.createRun.mockImplementation(async () => ({ id: 'bridge-fixture', enabled: true, mcpServers: { pi: { url: 'http://127.0.0.1:1' } }, snapshot: { tools: [{ mcpToolName: 'pi__fixture', piToolName: 'fixture', description: 'Fixture', inputSchema: { type: 'object', properties: {} } }], mcpToolNameToPiToolName: new Map(), piToolNameToMcpToolName: new Map() }, dispose: async () => {}, cancel: () => {}, setOnToolRequest: () => {}, setDebugRecorder: () => {} }));
});
afterEach(async () => { await releaseAllPendingCursorLiveRunsForTests(); await resetSessionCursorAgent(); });
describe('summary acquire suppresses Pi bridge', () => {
  for (const tools of [undefined, []]) it(`omitted/empty tools (${String(tools)}) omit MCP server`, async () => {
    const p = await prepare(summary('Main history', tools));
    expect(p.meta.bridgeEnabled).toBe(false);
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls.at(-1)?.[0].mcpServers).toBeUndefined();
  });
  it('normal explicit tools still attach the bridge', async () => {
    const p = await prepare(normal);
    expect(p.meta.bridgeEnabled).toBe(true);
    expect(mocks.createRun).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls.at(-1)?.[0].mcpServers).toBeDefined();
  });
  for (const result of ['success', 'failure', 'cancel']) it(`main + split-prefix summaries then ordinary prompt after ${result}`, async () => {
    await prepareCursorSessionForCompaction();
    for (const text of ['Main history', 'Split turn prefix']) {
      const ctx = summary(text); const p = await prepare(ctx);
      expect(p.meta.bridgeEnabled).toBe(false);
      p.lifecycle.commitSend(ctx, true);
    }
    if (result === 'success') invalidateSessionAgent();
    const p = await prepare(normal);
    expect(p.meta.bridgeEnabled).toBe(true);
    expect(p.meta.sendPlan.mode).toBe('bootstrap');
    expect(mocks.create.mock.calls.at(-1)?.[0].mcpServers).toBeDefined();
  });
});
