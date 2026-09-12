import type { HostUiRequest, SessionDriverEvent, SessionRef, SessionSnapshot } from "@alamelu-pi/session-driver";
import type { RpcEvent } from "./rpc-client.js";

export interface EventMappingContext {
  readonly sessionRef: SessionRef;
  readonly snapshot: SessionSnapshot;
  readonly runId?: string;
  readonly now?: () => string;
}

function timestamp(context: EventMappingContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function textFromToolResult(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((item) => (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

export function mapRpcEventToSessionDriverEvents(event: RpcEvent, context: EventMappingContext): SessionDriverEvent[] {
  const base = {
    sessionRef: context.sessionRef,
    timestamp: timestamp(context),
    ...(context.runId ? { runId: context.runId } : {}),
  };

  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
    if (assistantMessageEvent?.type === "text_delta") {
      return [{ ...base, type: "assistantDelta", text: String(assistantMessageEvent.delta ?? "") }];
    }
    if (assistantMessageEvent?.type === "error") {
      return [
        {
          ...base,
          type: "runFailed",
          error: { message: String(assistantMessageEvent.error ?? assistantMessageEvent.reason ?? "Assistant message failed") },
        },
      ];
    }
  }

  if (event.type === "message_end") {
    const message = event.message as Record<string, unknown> | undefined;
    if (message?.role === "assistant" && message.stopReason !== "error") {
      return [{ ...base, type: "assistantMessageCompleted" }];
    }
  }

  if (event.type === "tool_execution_start") {
    return [
      {
        ...base,
        type: "toolStarted",
        callId: String(event.toolCallId ?? ""),
        toolName: String(event.toolName ?? "unknown"),
        input: event.args,
      },
    ];
  }

  if (event.type === "tool_execution_update") {
    const text = textFromToolResult(event.partialResult);
    return [
      {
        ...base,
        type: "toolUpdated",
        callId: String(event.toolCallId ?? ""),
        ...(text ? { text } : {}),
      },
    ];
  }

  if (event.type === "tool_execution_end") {
    return [
      {
        ...base,
        type: "toolFinished",
        callId: String(event.toolCallId ?? ""),
        success: event.isError !== true,
        output: event.result,
      },
    ];
  }

  if (event.type === "extension_ui_request") {
    return [
      {
        ...base,
        type: "hostUiRequest",
        request: mapHostUiRequest(event),
      },
    ];
  }

  // agent_end may still be followed by retry, compaction retry or queued continuations;
  // only Pi's session-level agent_settled means the run is really over.
  if (event.type === "agent_settled") {
    return [{ ...base, type: "runCompleted", snapshot: context.snapshot }];
  }

  if (event.type === "rpc_parse_error") {
    return [{ ...base, type: "runFailed", error: { message: String(event.error ?? "RPC parse error"), details: event } }];
  }

  return [];
}

function mapHostUiRequest(event: RpcEvent): HostUiRequest {
  const id = String(event.id ?? "");
  const method = String(event.method ?? "notify");
  if (method === "confirm") {
    return withoutUndefined({ kind: "confirm", requestId: id, title: String(event.title ?? "Confirm"), message: String(event.message ?? ""), timeoutMs: numberOrUndefined(event.timeout) }) as HostUiRequest;
  }
  if (method === "input") {
    return withoutUndefined({ kind: "input", requestId: id, title: String(event.title ?? "Input"), placeholder: stringOrUndefined(event.placeholder), initialValue: stringOrUndefined(event.value), timeoutMs: numberOrUndefined(event.timeout) }) as HostUiRequest;
  }
  if (method === "select") {
    return withoutUndefined({ kind: "select", requestId: id, title: String(event.title ?? "Select"), options: Array.isArray(event.options) ? event.options.map(String) : [], timeoutMs: numberOrUndefined(event.timeout) }) as HostUiRequest;
  }
  if (method === "editor") {
    return withoutUndefined({ kind: "editor", requestId: id, title: String(event.title ?? "Editor"), initialValue: stringOrUndefined(event.prefill) }) as HostUiRequest;
  }
  if (method === "setStatus") {
    return withoutUndefined({ kind: "status", requestId: id, key: String(event.statusKey ?? id), text: stringOrUndefined(event.statusText) }) as HostUiRequest;
  }
  if (method === "setWidget") {
    return withoutUndefined({ kind: "widget", requestId: id, key: String(event.widgetKey ?? id), lines: Array.isArray(event.widgetLines) ? event.widgetLines.map(String) : undefined, placement: event.widgetPlacement === "belowEditor" ? "belowComposer" : "aboveComposer" }) as HostUiRequest;
  }
  if (method === "setTitle") {
    return { kind: "title", requestId: id, title: String(event.title ?? "") };
  }
  if (method === "set_editor_text") {
    return { kind: "editorText", requestId: id, text: String(event.text ?? "") };
  }
  return { kind: "notify", requestId: id, message: String(event.message ?? event.title ?? ""), level: event.notifyType === "warning" || event.notifyType === "error" ? event.notifyType : "info" };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
