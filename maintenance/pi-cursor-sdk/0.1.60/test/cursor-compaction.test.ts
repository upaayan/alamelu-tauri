import { afterEach, describe, expect, it } from 'vitest';
import type { Context } from '@earendil-works/pi-ai/compat';
import { getActiveContextToolNames } from '../src/cursor-context-tools.js';
import { resolveNativeReplayDisposition } from '../src/cursor-native-replay-routing.js';
import { __testUtils as display } from '../src/cursor-native-tool-display-state.js';
import { cursorLiveRuns, drainCursorLiveRunTurn, drainExistingCursorLiveRunBeforeSend, releaseAllPendingCursorLiveRunsForTests } from '../src/cursor-provider-live-run-drain.js';
import { makeFakeAgent, makeModel, makePartial, makeStream } from './auth-recreate-fixtures.js';

const tool = { id: 'cursor-replay-1-1-tool-1', toolName: 'read', args: { path: 'fixture.txt' }, result: { content: [{ type: 'text' as const, text: 'fixture' }], details: {} } };
const explicit: Context = { messages: [], tools: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: {} } } as never] };
function start() { return cursorLiveRuns.start({ id: tool.id, agent: makeFakeAgent() as never, promptInputTokens: 0 }); }

afterEach(async () => { await releaseAllPendingCursorLiveRunsForTests(); display.reset(); });
describe('Cursor summary tool contract', () => {
  for (const context of [{ messages: [] }, { messages: [], tools: [] }] as Context[]) {
    it(`routes native tools to trace when tools are ${context.tools ? 'empty' : 'omitted'}`, () => {
      display.registerNativeToolNameForTests('read');
      expect(resolveNativeReplayDisposition({ toolName: 'read', useNativeToolReplay: true, hasLiveRun: true, activeToolNames: getActiveContextToolNames(context) })).toBe('inactive_trace');
    });
    it(`drains tool then completed summary with tools ${context.tools ? 'empty' : 'omitted'}`, async () => {
      const run = start(); cursorLiveRuns.queueEvent(run, { type: 'tool', tool });
      cursorLiveRuns.markFinished(run, 'Complete summary with decisions and next steps.');
      const { stream, events } = makeStream(); const partial = makePartial();
      expect(await drainCursorLiveRunTurn(stream, partial, makeModel(), context, run, 0, { mode: 'emit' })).toBe('stop');
      expect(partial.content.some(p => p.type === 'toolCall')).toBe(false);
      expect(partial.content.filter(p => p.type === 'text').map(p => p.text).join('')).toBe('Complete summary with decisions and next steps.');
      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' });
      expect(run.disposed).toBe(true);
    });
  }
  it('preserves explicit-tool native replay for ordinary prompts', async () => {
    display.registerNativeToolNameForTests('read');
    const run = start(); cursorLiveRuns.queueEvent(run, { type: 'tool', tool }); cursorLiveRuns.markFinished(run, 'after tool');
    const { stream } = makeStream(); const partial = makePartial();
    expect(await drainCursorLiveRunTurn(stream, partial, makeModel(), explicit, run, 0, { mode: 'emit' })).toBe('tool_use');
    expect(partial.content.some(p => p.type === 'toolCall')).toBe(true);
  });
  for (const terminal of ['success', 'error', 'cancel'] as const) {
    it(`${terminal} releases summarizer drain before ordinary prompt`, async () => {
      const run = start();
      if (terminal === 'success') cursorLiveRuns.markFinished(run, 'Summary.');
      else if (terminal === 'error') cursorLiveRuns.markError(run, 'Fixture error');
      else cursorLiveRuns.markCancelled(run, 'Fixture cancelled');
      const { stream } = makeStream();
      expect(await drainCursorLiveRunTurn(stream, makePartial(), makeModel(), { messages: [] }, run, 0, { mode: 'emit' })).toBe(terminal === 'success' ? 'stop' : terminal === 'cancel' ? 'aborted' : 'error');
      expect(run.disposed).toBe(true);
      const next = makeStream();
      expect(await drainExistingCursorLiveRunBeforeSend(next.stream, makePartial(), makeModel(), explicit)).toBe('continue_send');
      expect(next.events).toEqual([]);
    });
  }
});
