import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const resourcePath = path.resolve('apps/desktop/resources/alpi-luna-websocket-recovery.ts');

async function loadRecoveryModule() {
  return existsSync(resourcePath) ? import(pathToFileURL(resourcePath).href) : {};
}

test('Alamelu Luna recovery clears stale fallback before each Luna request and converts immediate SSE fallback failures into Pi retries', async () => {
  const recovery = await loadRecoveryModule();
  assert.equal(typeof recovery.registerLunaWebSocketRecovery, 'function');

  const handlers = new Map();
  const resetSessions = [];
  recovery.registerLunaWebSocketRecovery(
    {
      on(eventName, handler) {
        handlers.set(eventName, handler);
      },
    },
    (sessionId) => resetSessions.push(sessionId),
  );

  const beforeProviderRequestHandler = handlers.get('before_provider_request');
  const messageEndHandler = handlers.get('message_end');
  assert.equal(typeof beforeProviderRequestHandler, 'function');
  assert.equal(typeof messageEndHandler, 'function');

  await beforeProviderRequestHandler(
    { payload: {} },
    { model: { provider: 'openai-codex', id: 'gpt-5.6-luna' }, sessionManager: { getSessionId: () => 'pi-session-for-recovery' } },
  );
  await beforeProviderRequestHandler(
    { payload: {} },
    { model: { provider: 'openai-codex', id: 'gpt-5.6-sol' }, sessionManager: { getSessionId: () => 'pi-session-for-recovery' } },
  );

  await messageEndHandler({
    message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', stopReason: 'error', errorMessage: 'WebSocket error' },
  }, { sessionManager: { getSessionId: () => 'pi-session-for-recovery' } });
  const fallbackResult = await messageEndHandler({
    message: {
      role: 'assistant',
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      stopReason: 'error',
      errorMessage: 'Model not found gpt-5.6-luna',
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

  assert.match(fallbackResult.message.errorMessage, /WebSocket error/i);
  assert.match(fallbackResult.message.errorMessage, /SSE fallback/i);
  assert.equal(fallbackResult.message.role, 'assistant');
  assert.deepEqual(resetSessions, ['pi-session-for-recovery', 'pi-session-for-recovery', 'pi-session-for-recovery']);
});
