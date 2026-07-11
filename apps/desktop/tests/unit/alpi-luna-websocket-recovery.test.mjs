import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const resourcePath = path.resolve('apps/desktop/resources/alpi-luna-websocket-recovery.ts');

async function loadRecoveryModule() {
  return existsSync(resourcePath) ? import(pathToFileURL(resourcePath).href) : {};
}

test('Alamelu Luna recovery resets Pi fallback only for a finalized Luna WebSocket error', async () => {
  const recovery = await loadRecoveryModule();
  assert.equal(typeof recovery.registerLunaWebSocketRecovery, 'function');

  let messageEndHandler;
  const resetSessions = [];
  recovery.registerLunaWebSocketRecovery(
    {
      on(eventName, handler) {
        assert.equal(eventName, 'message_end');
        messageEndHandler = handler;
      },
    },
    (sessionId) => resetSessions.push(sessionId),
  );

  await messageEndHandler({
    message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'WebSocket error' },
  }, { sessionManager: { getSessionId: () => 'pi-session-for-recovery' } });
  await messageEndHandler({
    message: {
      role: 'assistant',
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      stopReason: 'stop',
      diagnostics: [{ type: 'provider_transport_failure', details: { fallbackTransport: 'sse', eventsEmitted: false } }],
    },
  }, { sessionManager: { getSessionId: () => 'pi-session-for-recovery' } });
  await messageEndHandler({
    message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'Model not found gpt-5.6-luna' },
  }, { sessionManager: { getSessionId: () => 'pi-session-for-recovery' } });
  await messageEndHandler({
    message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-sol', stopReason: 'error', errorMessage: 'WebSocket error' },
  }, { sessionManager: { getSessionId: () => 'pi-session-for-recovery' } });
  await messageEndHandler({
    message: {
      role: 'assistant',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      stopReason: 'stop',
      diagnostics: [{ type: 'provider_transport_failure', details: { fallbackTransport: 'sse', eventsEmitted: false } }],
    },
  }, { sessionManager: { getSessionId: () => 'pi-session-for-recovery' } });

  assert.deepEqual(resetSessions, ['pi-session-for-recovery', 'pi-session-for-recovery']);
});
