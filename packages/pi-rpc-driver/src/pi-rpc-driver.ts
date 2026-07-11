import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CreateSessionOptions,
  HostUiResponse,
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionDriver,
  SessionDriverEvent,
  SessionEventListener,
  SessionAttachment,
  SessionMessageInput,
  SessionModelSelection,
  SessionQueuedMessage,
  SessionRef,
  SessionSnapshot,
  SessionTreeSnapshot,
  Unsubscribe,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import { mapRpcEventToSessionDriverEvents } from "./event-mapper.js";
import type { RpcClient, RpcEvent, RpcResponse } from "./rpc-client.js";
import { spawnPiRpcClient } from "./rpc-client.js";
import { canonicalizePath, pathContains, validateLabPaths, type LabPathInput, type ValidatedLabPaths } from "./path-guards.js";

const PROMPT_COMMAND_TIMEOUT_MS = 120_000;

export interface RpcClientLike {
  sendCommand<T extends RpcResponse = RpcResponse>(command: Record<string, unknown>, id?: string, timeoutMs?: number): Promise<T>;
  onEvent(listener: (event: RpcEvent) => void): Unsubscribe;
  close(): void;
}

export interface PiRpcDriverOptions extends LabPathInput {
  readonly piBin: string;
  readonly provider?: string;
  readonly model?: string;
  readonly noTools?: boolean;
  readonly noContextFiles?: boolean;
  readonly noExtensions?: boolean;
  readonly noSkills?: boolean;
  readonly noPromptTemplates?: boolean;
  readonly noThemes?: boolean;
  readonly now?: () => string;
  readonly rpcClientFactory?: (context: { workspace: WorkspaceRef; paths: ValidatedLabPaths; sessionId?: string }) => RpcClientLike;
  readonly onStderr?: (line: string) => void;
}

interface SessionRecord {
  readonly ref: SessionRef;
  readonly workspace: WorkspaceRef;
  readonly client: RpcClientLike;
  readonly unsubscribeClient: Unsubscribe;
  snapshot: SessionSnapshot;
  transcriptText: string;
  cancellingRunId?: string;
  suppressRunEvents?: boolean;
}

export class PiRpcDriver implements SessionDriver {
  private readonly paths: ValidatedLabPaths;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Map<string, Set<SessionEventListener>>();

  constructor(private readonly options: PiRpcDriverOptions) {
    this.paths = validateLabPaths(options);
  }

  async createSession(workspace: WorkspaceRef, options?: CreateSessionOptions): Promise<SessionSnapshot> {
    this.assertWorkspacePathAllowed(workspace.path);
    const client = this.createClient(workspace);
    try {
      const state = await client.sendCommand({ type: "get_state" }, `get-state-${randomUUID()}`);
      if (!state.success) throw new Error(state.error ?? "RPC get_state failed");
      const sessionId = sessionIdFromState(state.data);
      if (!sessionId) throw new Error("RPC get_state did not return a Pi session ID");

      if (options?.initialModel) {
        const modelResponse = await client.sendCommand({ type: "set_model", provider: options.initialModel.provider, modelId: options.initialModel.modelId }, `set-model-${randomUUID()}`);
        if (!modelResponse.success) throw new Error(modelResponse.error ?? "RPC set_model failed");
      }
      if (options?.initialThinkingLevel) {
        const thinkingResponse = await client.sendCommand({ type: "set_thinking_level", level: options.initialThinkingLevel }, `set-thinking-${randomUUID()}`);
        if (!thinkingResponse.success) throw new Error(thinkingResponse.error ?? "RPC set_thinking_level failed");
      }

      const ref = { workspaceId: workspace.workspaceId, sessionId };
      const snapshot = this.makeSnapshot(ref, workspace, {
        title: options?.title ?? sessionNameFromState(state.data) ?? "RPC Session",
        status: "idle",
        config: {
          ...(options?.initialModel ? { provider: options.initialModel.provider, modelId: options.initialModel.modelId } : {}),
          ...(options?.initialThinkingLevel ? { thinkingLevel: options.initialThinkingLevel } : {}),
        },
      });
      const record: SessionRecord = {
        ref,
        workspace,
        client,
        snapshot,
        transcriptText: "",
        unsubscribeClient: client.onEvent((event) => this.handleRpcEvent(ref, event)),
      };
      this.sessions.set(this.key(ref), record);
      this.emit(ref, { type: "sessionOpened", sessionRef: ref, timestamp: this.now(), snapshot });
      return snapshot;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async openSession(sessionRef: SessionRef): Promise<SessionSnapshot> {
    const existing = this.sessions.get(this.key(sessionRef));
    if (existing) {
      this.emit(sessionRef, { type: "sessionOpened", sessionRef, timestamp: this.now(), snapshot: existing.snapshot });
      return existing.snapshot;
    }

    this.assertExistingLabSessionId(sessionRef.sessionId);
    const workspacePath = this.options.allowRealWorkspace && path.isAbsolute(sessionRef.workspaceId)
      ? sessionRef.workspaceId
      : this.paths.labWorkspace;
    const workspace: WorkspaceRef = { workspaceId: sessionRef.workspaceId, path: workspacePath, displayName: path.basename(workspacePath) || "RPC Workspace" };
    const client = this.createClient(workspace, sessionRef.sessionId, { ensureSessionId: true });
    try {
      const state = await client.sendCommand({ type: "get_state" }, `open-state-${sessionRef.sessionId}`);
      if (!state.success) throw new Error(state.error ?? "RPC get_state failed");

      const snapshot = this.makeSnapshot(sessionRef, workspace, {
        title: sessionNameFromState(state.data) ?? "RPC Session",
        status: "idle",
      });
      const record: SessionRecord = {
        ref: sessionRef,
        workspace,
        client,
        snapshot,
        transcriptText: "",
        unsubscribeClient: client.onEvent((event) => this.handleRpcEvent(sessionRef, event)),
      };
      this.sessions.set(this.key(sessionRef), record);
      this.emit(sessionRef, { type: "sessionOpened", sessionRef, timestamp: this.now(), snapshot });
      return snapshot;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  archiveSession(_sessionRef: SessionRef): Promise<void> {
    return Promise.reject(new Error("archiveSession is not supported by the RPC prototype"));
  }

  unarchiveSession(_sessionRef: SessionRef): Promise<void> {
    return Promise.reject(new Error("unarchiveSession is not supported by the RPC prototype"));
  }

  async sendUserMessage(sessionRef: SessionRef, input: SessionMessageInput): Promise<void> {
    const record = this.requireSession(sessionRef);
    if (input.deliverAs) {
      if (record.snapshot.status !== "running" && !record.snapshot.runningRunId) {
        throw new Error("RPC steering and follow-up messages require a running session");
      }
      const commandType = input.deliverAs === "steer" ? "steer" : "follow_up";
      const response = await record.client.sendCommand(
        { type: commandType, message: input.text, images: imageAttachments(input) },
        `${commandType}-${randomUUID()}`,
      );
      if (!response.success) throw new Error(response.error ?? `RPC ${commandType} failed`);
      return;
    }
    if (record.snapshot.status === "running" || record.snapshot.runningRunId) {
      throw new Error("RPC session is already running; re-entrant prompts are not supported by the prototype");
    }
    const runId = randomUUID();
    record.snapshot = { ...record.snapshot, status: "running", runningRunId: runId, updatedAt: this.now() };
    record.transcriptText += `${record.transcriptText ? "\n" : ""}User: ${input.text}\nAssistant: `;
    this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), runId, snapshot: record.snapshot });

    const commandType = "prompt";
    try {
      const response = await record.client.sendCommand(
        { type: commandType, message: input.text, images: imageAttachments(input) },
        `${commandType}-${runId}`,
        PROMPT_COMMAND_TIMEOUT_MS,
      );
      if (!response.success) throw new Error(response.error ?? `RPC ${commandType} failed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!record.snapshot.runningRunId && isBenignInactiveStreamFailure(message)) {
        return;
      }
      this.failRun(record, runId, message);
      throw error;
    }
  }

  replaceQueuedMessages(_sessionRef: SessionRef, _messages: readonly SessionQueuedMessage[]): Promise<void> {
    return Promise.reject(new Error("replaceQueuedMessages is not supported by the RPC prototype"));
  }

  async cancelCurrentRun(sessionRef: SessionRef): Promise<void> {
    const record = this.requireSession(sessionRef);
    const runId = record.snapshot.runningRunId;
    if (runId) record.cancellingRunId = runId;
    try {
      const response = await record.client.sendCommand({ type: "abort" }, `abort-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC abort failed");
      if (runId) this.failRun(record, runId, "Run cancelled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (runId) this.failRun(record, runId, message);
      record.client.close();
      throw error;
    }
  }

  async setSessionModel(sessionRef: SessionRef, selection: SessionModelSelection): Promise<void> {
    const record = this.requireSession(sessionRef);
    const response = await record.client.sendCommand({ type: "set_model", provider: selection.provider, modelId: selection.modelId }, `set-model-${randomUUID()}`);
    if (!response.success) throw new Error(response.error ?? "RPC set_model failed");
    record.snapshot = { ...record.snapshot, config: { ...record.snapshot.config, provider: selection.provider, modelId: selection.modelId }, updatedAt: this.now() };
    this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: record.snapshot });
  }

  async setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    const response = await record.client.sendCommand({ type: "set_thinking_level", level: thinkingLevel }, `set-thinking-${randomUUID()}`);
    if (!response.success) throw new Error(response.error ?? "RPC set_thinking_level failed");
    record.snapshot = { ...record.snapshot, config: { ...record.snapshot.config, thinkingLevel }, updatedAt: this.now() };
    this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: record.snapshot });
  }

  async renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    const response = await record.client.sendCommand({ type: "set_session_name", name: title }, `set-name-${randomUUID()}`);
    if (!response.success) throw new Error(response.error ?? "RPC set_session_name failed");
    record.snapshot = { ...record.snapshot, title, updatedAt: this.now() };
    this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: record.snapshot });
  }

  compactSession(_sessionRef: SessionRef, _customInstructions?: string): Promise<void> {
    return Promise.reject(new Error("compactSession is not supported by the RPC prototype"));
  }

  async reloadSession(sessionRef: SessionRef): Promise<void> {
    const record = this.requireSession(sessionRef);
    const state = await record.client.sendCommand({ type: "get_state" }, `reload-${randomUUID()}`);
    if (!state.success) throw new Error(state.error ?? "RPC get_state failed");
    record.snapshot = { ...record.snapshot, updatedAt: this.now(), title: sessionNameFromState(state.data) ?? record.snapshot.title };
    this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: record.snapshot });
  }

  getSessionTree(_sessionRef: SessionRef): Promise<SessionTreeSnapshot> {
    return Promise.reject(new Error("getSessionTree is not supported by the RPC prototype"));
  }

  navigateSessionTree(_sessionRef: SessionRef, _targetId: string, _options?: NavigateSessionTreeOptions): Promise<NavigateSessionTreeResult> {
    return Promise.reject(new Error("navigateSessionTree is not supported by the RPC prototype"));
  }

  async getSessionCommands(sessionRef: SessionRef): Promise<readonly RuntimeCommandRecord[]> {
    const record = this.requireSession(sessionRef);
    const response = await record.client.sendCommand({ type: "get_commands" }, `commands-${randomUUID()}`);
    if (!response.success) throw new Error(response.error ?? "RPC get_commands failed");
    const commands = (response.data as { commands?: RuntimeCommandRecord[] } | undefined)?.commands;
    return Array.isArray(commands) ? commands : [];
  }

  async respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void> {
    const record = this.requireSession(sessionRef);
    const rpcResponse = await record.client.sendCommand({ type: "extension_ui_response", id: response.requestId, ...response }, response.requestId);
    if (!rpcResponse.success) throw new Error(rpcResponse.error ?? "RPC extension_ui_response failed");
  }

  subscribe(sessionRef: SessionRef, listener: SessionEventListener): Unsubscribe {
    const key = this.key(sessionRef);
    let listeners = this.listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }

  async closeSession(sessionRef: SessionRef): Promise<void> {
    const key = this.key(sessionRef);
    const record = this.sessions.get(key);
    if (!record) return;
    record.unsubscribeClient();
    record.client.close();
    this.sessions.delete(key);
    this.emit(sessionRef, { type: "sessionClosed", sessionRef, timestamp: this.now(), reason: "manual" });
  }

  async getTranscript(sessionRef: SessionRef): Promise<readonly { role: "user" | "assistant"; text: string }[]> {
    const localTranscript = transcriptFromLocalSessionFile(this.paths.sessionDir, sessionRef.sessionId);
    if (localTranscript.length > 0) return localTranscript;

    let record = this.sessions.get(this.key(sessionRef));
    if (!record) {
      await this.openSession(sessionRef);
      record = this.requireSession(sessionRef);
    }
    const messagesResponse = await record.client.sendCommand({ type: "get_messages" }, `messages-${randomUUID()}`);
    if (messagesResponse.success) {
      const transcript = transcriptFromRpcMessages(messagesResponse.data);
      if (transcript.length > 0) return transcript;
    }

    const response = await record.client.sendCommand({ type: "get_last_assistant_text" }, `last-${randomUUID()}`);
    const assistantText = response.success ? String((response.data as { text?: unknown } | undefined)?.text ?? "") : "";
    return assistantText ? [{ role: "assistant", text: assistantText }] : [];
  }

  private createClient(workspace: WorkspaceRef, sessionId?: string, options: { ensureSessionId?: boolean } = {}): RpcClientLike {
    if (this.options.rpcClientFactory) {
      return this.options.rpcClientFactory({ workspace, paths: this.paths, ...(sessionId ? { sessionId } : {}) });
    }
    return spawnPiRpcClient({
      piBin: this.options.piBin,
      cwd: this.options.allowRealWorkspace ? workspace.path : this.paths.labWorkspace,
      agentDir: this.paths.agentDir,
      sessionDir: this.paths.sessionDir,
      ...(this.options.provider ? { provider: this.options.provider } : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      noTools: this.options.noTools ?? true,
      noContextFiles: this.options.noContextFiles ?? true,
      noExtensions: this.options.noExtensions ?? true,
      noSkills: this.options.noSkills ?? true,
      noPromptTemplates: this.options.noPromptTemplates ?? true,
      noThemes: this.options.noThemes ?? true,
      ...(options.ensureSessionId && sessionId ? { sessionId } : {}),
      ...(this.options.onStderr ? { onStderr: this.options.onStderr } : {}),
    }) as RpcClient;
  }

  private handleRpcEvent(sessionRef: SessionRef, event: RpcEvent): void {
    const record = this.requireSession(sessionRef);
    if (event.type === "agent_start") {
      if (record.suppressRunEvents && !record.snapshot.runningRunId) return;
      delete record.suppressRunEvents;
      const runId = record.snapshot.runningRunId;
      if (!runId) return;
      record.snapshot = { ...record.snapshot, status: "running", runningRunId: runId, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), runId, snapshot: record.snapshot });
      return;
    }
    if (record.suppressRunEvents) return;

    if (record.cancellingRunId && record.snapshot.runningRunId === record.cancellingRunId) {
      const cancellingFailure = streamFailureMessage(event);
      if (cancellingFailure) this.failRun(record, record.cancellingRunId, cancellingFailure);
      return;
    }

    const activeRunId = record.snapshot.runningRunId;
    const streamFailure = streamFailureMessage(event);
    if (streamFailure) {
      if (!activeRunId && isBenignInactiveStreamFailure(streamFailure)) {
        return;
      }
      this.failRun(record, activeRunId ?? randomUUID(), streamFailure);
      return;
    }

    if (event.type === "agent_end") {
      if (!activeRunId) return;
      const { runningRunId: _runningRunId, ...snapshotWithoutRunId } = record.snapshot;
      record.snapshot = { ...snapshotWithoutRunId, status: "idle", updatedAt: this.now() };
    }
    const events = mapRpcEventToSessionDriverEvents(event, {
      sessionRef,
      snapshot: record.snapshot,
      ...(activeRunId ? { runId: activeRunId } : {}),
      now: () => this.now(),
    });
    for (const mapped of events) {
      if (mapped.type === "assistantDelta") record.transcriptText += mapped.text;
      this.emit(sessionRef, mapped);
    }
  }

  private failRun(record: SessionRecord, runId: string, message: string): void {
    if (record.suppressRunEvents && !record.snapshot.runningRunId) return;
    const { runningRunId: _runningRunId, ...snapshotWithoutRunId } = record.snapshot;
    delete record.cancellingRunId;
    record.suppressRunEvents = true;
    record.snapshot = { ...snapshotWithoutRunId, status: "idle", updatedAt: this.now() };
    this.emit(record.ref, { type: "sessionUpdated", sessionRef: record.ref, timestamp: this.now(), snapshot: record.snapshot });
    this.emit(record.ref, { type: "runFailed", sessionRef: record.ref, timestamp: this.now(), runId, error: { message } });
  }

  private emit(sessionRef: SessionRef, event: SessionDriverEvent): void {
    const listeners = this.listeners.get(this.key(sessionRef));
    if (!listeners) return;
    for (const listener of listeners) void listener(event);
  }

  private requireSession(sessionRef: SessionRef): SessionRecord {
    const record = this.sessions.get(this.key(sessionRef));
    if (!record) throw new Error(`RPC session is not open: ${this.key(sessionRef)}`);
    return record;
  }

  private assertWorkspacePathAllowed(workspacePath: string): void {
    if (this.options.allowRealWorkspace) return;
    const resolvedWorkspacePath = canonicalizePath(workspacePath);
    if (!pathContains(this.paths.labWorkspace, resolvedWorkspacePath)) {
      throw new Error(`Workspace path is outside the RPC lab workspace: ${resolvedWorkspacePath}`);
    }
  }

  private assertExistingLabSessionId(sessionId: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId.includes("..")) {
      throw new Error(`Invalid RPC lab session id: ${sessionId}`);
    }
    const files = fs.readdirSync(this.paths.sessionDir, { withFileTypes: true });
    const expectedSuffix = `_${sessionId}.jsonl`;
    const match = files.find((entry) => entry.isFile() && entry.name.endsWith(expectedSuffix));
    if (!match) {
      throw new Error(`RPC lab session not found in isolated session dir: ${sessionId}`);
    }
    const resolved = fs.realpathSync.native(path.join(this.paths.sessionDir, match.name));
    if (!resolved.startsWith(`${this.paths.sessionDir}${path.sep}`)) {
      throw new Error(`RPC lab session resolves outside isolated session dir: ${resolved}`);
    }
  }

  private makeSnapshot(
    ref: SessionRef,
    workspace: WorkspaceRef,
    values: Pick<SessionSnapshot, "title" | "status"> & Partial<Pick<SessionSnapshot, "config" | "runningRunId">>,
  ): SessionSnapshot {
    return {
      ref,
      workspace,
      title: values.title,
      status: values.status,
      updatedAt: this.now(),
      ...(values.config ? { config: values.config } : {}),
      ...(values.runningRunId ? { runningRunId: values.runningRunId } : {}),
    };
  }

  private key(sessionRef: SessionRef): string {
    return `${sessionRef.workspaceId}:${sessionRef.sessionId}`;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

export function createPiRpcDriver(options: PiRpcDriverOptions): PiRpcDriver {
  return new PiRpcDriver(options);
}

function transcriptFromLocalSessionFile(sessionDir: string, sessionId: string): { role: "user" | "assistant"; text: string }[] {
  try {
    const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
    const match = entries.find((entry) => entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`));
    if (!match) return [];
    const filePath = path.join(sessionDir, match.name);
    const resolved = fs.realpathSync.native(filePath);
    if (!resolved.startsWith(`${sessionDir}${path.sep}`)) return [];
    const rows: { role: "user" | "assistant"; text: string }[] = [];
    for (const line of fs.readFileSync(resolved, "utf8").split(/\n/)) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const row = transcriptRowFromJsonlEvent(event);
      if (row) rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

function transcriptRowFromJsonlEvent(event: unknown): { role: "user" | "assistant"; text: string } | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const record = event as Record<string, unknown>;
  if (record.type !== "message" || typeof record.message !== "object" || record.message === null) return undefined;
  const message = record.message as Record<string, unknown>;
  const role = normalizeTranscriptRole(message.role);
  if (!role) return undefined;
  const text = textFromJsonlContent(message.content).trim();
  return text ? { role, text } : undefined;
}

function textFromJsonlContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part !== "object" || part === null) return "";
    const record = part as Record<string, unknown>;
    if (record.type === "thinking" || record.type === "reasoning") return "";
    if (record.type === "toolCall") return "";
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    return "";
  }).filter(Boolean).join("\n");
}

function transcriptFromRpcMessages(data: unknown): { role: "user" | "assistant"; text: string }[] {
  const messages = typeof data === "object" && data !== null && Array.isArray((data as { messages?: unknown }).messages)
    ? (data as { messages: unknown[] }).messages
    : [];
  return messages
    .map((message) => transcriptRowFromRpcMessage(message))
    .filter((row): row is { role: "user" | "assistant"; text: string } => Boolean(row));
}

function transcriptRowFromRpcMessage(message: unknown): { role: "user" | "assistant"; text: string } | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const record = message as Record<string, unknown>;
  const role = normalizeTranscriptRole(record.role ?? record.type);
  if (!role) return undefined;
  const text = textFromRpcMessage(record).trim();
  return text ? { role, text } : undefined;
}

function normalizeTranscriptRole(value: unknown): "user" | "assistant" | undefined {
  if (value === "user" || value === "assistant") return value;
  if (value === "user_message") return "user";
  if (value === "assistant_message") return "assistant";
  return undefined;
}

function textFromRpcMessage(record: Record<string, unknown>): string {
  for (const key of ["text", "message", "contentText"] as const) {
    if (typeof record[key] === "string") return record[key];
  }
  return textFromRpcContent(record.content);
}

function textFromRpcContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part !== "object" || part === null) return "";
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    return "";
  }).filter(Boolean).join("\n");
}

function isBenignInactiveStreamFailure(message: string): boolean {
  return /EPIPE|RPC transport closed|RPC stdout ended|RPC client closed|stdout_error/i.test(message);
}

function streamFailureMessage(event: RpcEvent): string | undefined {
  if (event.type === "rpc_transport_closed") return `RPC transport closed: ${String(event.reason ?? "unknown")}`;
  if (event.type === "rpc_parse_error") return String(event.error ?? "RPC parse error");
  if (event.type !== "message_update") return undefined;
  const assistantMessageEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
  if (assistantMessageEvent?.type !== "error") return undefined;
  return String(assistantMessageEvent.error ?? assistantMessageEvent.reason ?? "Assistant message failed");
}

function sessionIdFromState(data: unknown): string | undefined {
  return typeof data === "object" && data !== null && typeof (data as { sessionId?: unknown }).sessionId === "string"
    ? (data as { sessionId: string }).sessionId
    : undefined;
}

function sessionNameFromState(data: unknown): string | undefined {
  return typeof data === "object" && data !== null && typeof (data as { sessionName?: unknown }).sessionName === "string"
    ? (data as { sessionName: string }).sessionName
    : undefined;
}

type SessionImageLike = Extract<SessionAttachment, { kind: "image" }>;

function imageAttachments(input: SessionMessageInput): unknown[] | undefined {
  const images = input.attachments?.filter((attachment): attachment is SessionImageLike => attachment.kind === "image");
  if (!images || images.length === 0) return undefined;
  return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}
