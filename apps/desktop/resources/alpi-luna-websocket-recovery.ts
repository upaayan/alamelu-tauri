import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LUNA_PROVIDER = "openai-codex";
const LUNA_MODEL = "gpt-5.6-luna";

export function registerLunaWebSocketRecovery(pi, resetWebSocketState) {
  pi.on("message_end", (event, context) => {
    if (!isLunaWebSocketFailure(event)) return;
    resetWebSocketState(context.sessionManager.getSessionId());
  });
}

export default async function installLunaWebSocketRecovery(pi) {
  const resetWebSocketState = await loadPiWebSocketReset();
  registerLunaWebSocketRecovery(pi, resetWebSocketState);
}

function isLunaWebSocketFailure(event) {
  const message = event?.message;
  if (!message || typeof message !== "object") return false;
  if (message.role !== "assistant" || message.provider !== LUNA_PROVIDER || message.model !== LUNA_MODEL) return false;
  if (hasSseFallbackDiagnostic(message.diagnostics)) return true;
  if (message.stopReason !== "error") return false;
  const errorText = [message.errorMessage, message.error].filter((value) => typeof value === "string").join(" ");
  return /websocket/i.test(errorText);
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
  const providerModulePath = path.join(
    piPackageRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
    "dist",
    "providers",
    "openai-codex-responses.js",
  );
  if (!existsSync(providerModulePath)) {
    throw new Error("Alamelu Luna recovery could not locate Pi's Codex provider module");
  }

  const providerModule = await import(pathToFileURL(providerModulePath).href);
  if (typeof providerModule.resetOpenAICodexWebSocketDebugStats !== "function") {
    throw new Error("Alamelu Luna recovery requires Pi's WebSocket reset helper");
  }
  return providerModule.resetOpenAICodexWebSocketDebugStats;
}
