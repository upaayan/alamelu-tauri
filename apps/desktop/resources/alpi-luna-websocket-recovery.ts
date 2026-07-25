import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LUNA_PROVIDER = "openai-codex";
const LUNA_MODEL = "gpt-5.6-luna";

export function registerLunaWebSocketRecovery(pi, resetWebSocketState) {
  // Pi evaluates this immediately before its Codex provider chooses WebSocket
  // versus SSE. Clearing a stale fallback here means a later Luna request gets
  // another WebSocket attempt instead of inheriting an invisible SSE-only
  // state from an earlier transport failure.
  pi.on("before_provider_request", (_event, context) => {
    if (!isLunaModel(context.model)) return;
    resetWebSocketState(context.sessionManager.getSessionId());
  });

  pi.on("message_end", (event, context) => {
    if (!isLunaWebSocketFailure(event)) return;
    resetWebSocketState(context.sessionManager.getSessionId());

    // When a WebSocket connection fails before it streams, Pi falls back to
    // SSE in the same provider call. Luna's SSE endpoint rejects that route
    // with a non-retryable 404. Replacing only this diagnosed fallback error
    // lets Pi use its existing auto-retry/continue path on the original turn.
    if (isLunaSseFallbackError(event)) {
      return {
        message: {
          ...event.message,
          errorMessage: "WebSocket error: Luna SSE fallback was rejected",
        },
      };
    }
  });
}

export default async function installLunaWebSocketRecovery(pi) {
  const resetWebSocketState = await loadPiWebSocketReset();
  registerLunaWebSocketRecovery(pi, resetWebSocketState);
}

function isLunaWebSocketFailure(event) {
  const message = event?.message;
  if (!message || typeof message !== "object") return false;
  if (!isLunaMessage(message)) return false;
  if (hasSseFallbackDiagnostic(message.diagnostics)) return true;
  if (message.stopReason !== "error") return false;
  const errorText = [message.errorMessage, message.error].filter((value) => typeof value === "string").join(" ");
  return /websocket/i.test(errorText);
}

function isLunaSseFallbackError(event) {
  const message = event?.message;
  return Boolean(
    message &&
    typeof message === "object" &&
    isLunaMessage(message) &&
    message.stopReason === "error" &&
    hasSseFallbackDiagnostic(message.diagnostics),
  );
}

function isLunaModel(model) {
  return model?.provider === LUNA_PROVIDER && model?.id === LUNA_MODEL;
}

function isLunaMessage(message) {
  return message.role === "assistant" && message.provider === LUNA_PROVIDER && message.model === LUNA_MODEL;
}

function hasSseFallbackDiagnostic(diagnostics) {
  return Array.isArray(diagnostics) && diagnostics.some((diagnostic) =>
    diagnostic &&
    typeof diagnostic === "object" &&
    diagnostic.type === "provider_transport_failure" &&
    diagnostic.details &&
    typeof diagnostic.details === "object" &&
    diagnostic.details.fallbackTransport === "sse",
  );
}

async function loadPiWebSocketReset() {
  // Pi evaluates explicit .ts extensions through Jiti, whose require resolves
  // this alias to the active external Pi package. The provider subpath itself
  // is intentionally not an extension import alias, so derive its real file.
  const piEntryPath = require.resolve("@earendil-works/pi-coding-agent");
  const piPackageRoot = path.resolve(path.dirname(piEntryPath), "..");
  // Pi 0.80.10 moved the Codex transport module from `dist/providers` to
  // `dist/api`. Keep the old path as a fallback for older Pi installations.
  const providerModulePath = [
    path.join(
      piPackageRoot,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "api",
      "openai-codex-responses.js",
    ),
    path.join(
      piPackageRoot,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "providers",
      "openai-codex-responses.js",
    ),
  ].find((candidate) => existsSync(candidate));
  if (!existsSync(providerModulePath)) {
    throw new Error("Alamelu Luna recovery could not locate Pi's Codex provider module");
  }

  const providerModule = await import(pathToFileURL(providerModulePath).href);
  if (typeof providerModule.resetOpenAICodexWebSocketDebugStats !== "function") {
    throw new Error("Alamelu Luna recovery requires Pi's WebSocket reset helper");
  }
  return providerModule.resetOpenAICodexWebSocketDebugStats;
}
