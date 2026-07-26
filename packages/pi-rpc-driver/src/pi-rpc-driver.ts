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
  SessionTreeNodeSnapshot,
  Unsubscribe,
  WorkspaceRef,
} from "@alamelu-pi/session-driver";
import type { RuntimeCommandRecord } from "@alamelu-pi/session-driver/runtime-types";
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
  readonly extensionPaths?: readonly string[];
  readonly now?: () => string;
  readonly rpcClientFactory?: (context: { workspace: WorkspaceRef; paths: ValidatedLabPaths; sessionId?: string }) => RpcClientLike;
  readonly onStderr?: (line: string) => void;
}

interface SessionRecord {
  readonly ref: SessionRef;
  readonly workspace: WorkspaceRef;
  client: RpcClientLike;
  unsubscribeClient: Unsubscribe;
  clientGeneration: number;
  snapshot: SessionSnapshot;
  transcriptText: string;
  lunaChildNeedsRotation?: boolean;
  restartingClient?: Promise<void>;
  idleOperationTail?: Promise<void>;
  closed?: boolean;
  cancellingRunId?: string;
  pendingAssistantError?: string;
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
      const stateConfig = sessionConfigFromState(state.data);
      const snapshot = this.makeSnapshot(ref, workspace, {
        title: options?.title ?? sessionNameFromState(state.data) ?? "RPC Session",
        status: "idle",
        config: {
          ...(stateConfig ?? {}),
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
        clientGeneration: 0,
        unsubscribeClient: () => undefined,
      };
      this.sessions.set(this.key(ref), record);
      record.unsubscribeClient = this.subscribeToClient(record, client, record.clientGeneration);
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
      const stateConfig = sessionConfigFromState(state.data);

      const snapshot = this.makeSnapshot(sessionRef, workspace, {
        title: sessionNameFromState(state.data) ?? "RPC Session",
        status: "idle",
        ...(stateConfig ? { config: stateConfig } : {}),
      });
      const record: SessionRecord = {
        ref: sessionRef,
        workspace,
        client,
        snapshot,
        transcriptText: "",
        clientGeneration: 0,
        unsubscribeClient: () => undefined,
      };
      this.sessions.set(this.key(sessionRef), record);
      record.unsubscribeClient = this.subscribeToClient(record, client, record.clientGeneration);
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
    let record = this.requireSession(sessionRef);
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
    return this.enqueueIdleOperation(record, async () => {
      record = this.requireSession(sessionRef);
      if (record.snapshot.status === "running" || record.snapshot.runningRunId) {
        throw new Error("RPC session is already running; re-entrant prompts are not supported by the prototype");
      }
      await this.rotateLunaChildBeforePrompt(record);
      record = this.requireSession(sessionRef);
      if (record.snapshot.status === "running" || record.snapshot.runningRunId) {
        throw new Error("RPC session became active while preparing a prompt");
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
    });
  }

  replaceQueuedMessages(_sessionRef: SessionRef, _messages: readonly SessionQueuedMessage[]): Promise<void> {
    return Promise.reject(new Error("replaceQueuedMessages is not supported by the RPC prototype"));
  }

  async cancelCurrentRun(sessionRef: SessionRef): Promise<void> {
    let record = this.requireSession(sessionRef);
    record = await this.waitForClientRestart(record);
    const runId = record.snapshot.runningRunId;
    if (runId) record.cancellingRunId = runId;
    try {
      const response = await record.client.sendCommand({ type: "abort" }, `abort-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC abort failed");
      if (runId) this.endRun(record, runId, { cancelled: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (runId) this.failRun(record, runId, message);
      record.client.close();
      throw error;
    }
  }

  async setSessionModel(sessionRef: SessionRef, selection: SessionModelSelection): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleLunaClientForMutation(record);
      const response = await current.client.sendCommand({ type: "set_model", provider: selection.provider, modelId: selection.modelId }, `set-model-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC set_model failed");
      current.snapshot = { ...current.snapshot, config: { ...current.snapshot.config, provider: selection.provider, modelId: selection.modelId }, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleLunaClientForMutation(record);
      const response = await current.client.sendCommand({ type: "set_thinking_level", level: thinkingLevel }, `set-thinking-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC set_thinking_level failed");
      current.snapshot = { ...current.snapshot, config: { ...current.snapshot.config, thinkingLevel }, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleLunaClientForMutation(record);
      const response = await current.client.sendCommand({ type: "set_session_name", name: title }, `set-name-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC set_session_name failed");
      current.snapshot = { ...current.snapshot, title, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleLunaClientForMutation(record);
      // Pi answers only once compaction finishes, which outlives the 30s default.
      const response = await current.client.sendCommand(
        { type: "compact", ...(customInstructions ? { customInstructions } : {}) },
        `compact-${randomUUID()}`,
        PROMPT_COMMAND_TIMEOUT_MS,
      );
      if (!response.success) throw new Error(response.error ?? "RPC compact failed");
      current.snapshot = { ...current.snapshot, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async reloadSession(sessionRef: SessionRef): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleLunaClientForMutation(record);
      const state = await current.client.sendCommand({ type: "get_state" }, `reload-${randomUUID()}`);
      if (!state.success) throw new Error(state.error ?? "RPC get_state failed");
      current.snapshot = { ...current.snapshot, updatedAt: this.now(), title: sessionNameFromState(state.data) ?? current.snapshot.title };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot> {
    let record = this.requireSession(sessionRef);
    record = await this.waitForClientRestart(record);
    const response = await record.client.sendCommand({ type: "get_tree" }, `tree-${randomUUID()}`);
    if (!response.success) throw new Error(response.error ?? "RPC get_tree failed");
    const data = response.data as { tree?: unknown; leafId?: unknown } | undefined;
    return {
      roots: mapSessionTreeNodes(data?.tree),
      leafId: typeof data?.leafId === "string" ? data.leafId : null,
    };
  }

  async navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    _options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleLunaClientForMutation(record);
      const response = await current.client.sendCommand({ type: "fork", entryId: targetId }, `fork-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC fork failed");
      const data = response.data as { text?: unknown; cancelled?: unknown } | undefined;
      const cancelled = data?.cancelled === true;
      if (!cancelled) {
        current.snapshot = { ...current.snapshot, updatedAt: this.now() };
        this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
      }
      return {
        cancelled,
        ...(typeof data?.text === "string" ? { editorText: data.text } : {}),
      };
    });
  }

  async getSessionCommands(sessionRef: SessionRef): Promise<readonly RuntimeCommandRecord[]> {
    let record = this.requireSession(sessionRef);
    record = await this.waitForClientRestart(record);
    const response = await record.client.sendCommand({ type: "get_commands" }, `commands-${randomUUID()}`);
    if (!response.success) throw new Error(response.error ?? "RPC get_commands failed");
    const commands = (response.data as { commands?: RuntimeCommandRecord[] } | undefined)?.commands;
    return Array.isArray(commands) ? commands : [];
  }

  async respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void> {
    let record = this.requireSession(sessionRef);
    record = await this.waitForClientRestart(record);
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
    record.closed = true;
    record.clientGeneration += 1;
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
    record = await this.waitForClientRestart(record);
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
      // An exact session reopen must restore its own saved model/thinking
      // selection. Supplying launch-level defaults here can override that
      // state before Pi reads the session JSONL.
      ...(!options.ensureSessionId && this.options.provider ? { provider: this.options.provider } : {}),
      ...(!options.ensureSessionId && this.options.model ? { model: this.options.model } : {}),
      noTools: this.options.noTools ?? true,
      noContextFiles: this.options.noContextFiles ?? true,
      noExtensions: this.options.noExtensions ?? true,
      noSkills: this.options.noSkills ?? true,
      noPromptTemplates: this.options.noPromptTemplates ?? true,
      noThemes: this.options.noThemes ?? true,
      ...(this.options.noExtensions === false && this.options.extensionPaths?.length ? { extensionPaths: this.options.extensionPaths } : {}),
      ...(options.ensureSessionId && sessionId ? { sessionId } : {}),
      ...(this.options.onStderr ? { onStderr: this.options.onStderr } : {}),
    }) as RpcClient;
  }

  private subscribeToClient(record: SessionRecord, client: RpcClientLike, generation: number): Unsubscribe {
    return client.onEvent((event) => this.handleRpcEvent(record.ref, client, generation, event));
  }

  private enqueueIdleOperation<T>(record: SessionRecord, operation: () => Promise<T>): Promise<T> {
    const previous = record.idleOperationTail ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    record.idleOperationTail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async waitForClientRestart(record: SessionRecord): Promise<SessionRecord> {
    if (record.restartingClient) await record.restartingClient;
    return this.requireSession(record.ref);
  }

  private async prepareIdleLunaClientForMutation(record: SessionRecord): Promise<SessionRecord> {
    if (!record.snapshot.runningRunId && record.snapshot.status !== "running") {
      await this.rotateLunaChildBeforePrompt(record);
    }
    const current = await this.waitForClientRestart(record);
    if (current.snapshot.runningRunId || current.snapshot.status === "running") {
      throw new Error("RPC session is running; session configuration changes must wait for it to finish");
    }
    return current;
  }

  private async rotateLunaChildBeforePrompt(record: SessionRecord): Promise<void> {
    if (!record.lunaChildNeedsRotation || !isLunaSession(record.snapshot)) return;
    if (!record.restartingClient) {
      const restart = this.replaceIdleClient(record);
      record.restartingClient = restart;
      void restart.then(
        () => {
          if (record.restartingClient === restart) delete record.restartingClient;
        },
        () => {
          if (record.restartingClient === restart) delete record.restartingClient;
        },
      );
    }
    await record.restartingClient;
  }

  private async replaceIdleClient(record: SessionRecord): Promise<void> {
    if (record.snapshot.status === "running" || record.snapshot.runningRunId) {
      throw new Error("Cannot replace an active Pi RPC child");
    }

    const replacement = this.createClient(record.workspace, record.ref.sessionId, { ensureSessionId: true });
    try {
      const state = await replacement.sendCommand({ type: "get_state" }, `replace-state-${randomUUID()}`);
      if (!state.success) throw new Error(state.error ?? "Replacement Pi RPC get_state failed");
      const restoredSessionId = sessionIdFromState(state.data);
      if (restoredSessionId !== record.ref.sessionId) {
        throw new Error(`Replacement Pi RPC session mismatch: expected ${record.ref.sessionId}, got ${restoredSessionId ?? "none"}`);
      }
      const restoredConfig = sessionConfigFromState(state.data);
      assertRestoredSessionConfig(record.snapshot.config, restoredConfig);

      if (this.sessions.get(this.key(record.ref)) !== record || record.closed) {
        throw new Error("RPC session closed while replacing its Pi child");
      }
      if (record.snapshot.runningRunId) {
        throw new Error("RPC session became active while replacing its Pi child");
      }

      const previousClient = record.client;
      const previousUnsubscribe = record.unsubscribeClient;
      const replacementGeneration = record.clientGeneration + 1;
      const replacementUnsubscribe = this.subscribeToClient(record, replacement, replacementGeneration);
      record.client = replacement;
      record.unsubscribeClient = replacementUnsubscribe;
      record.clientGeneration = replacementGeneration;
      delete record.lunaChildNeedsRotation;
      if (restoredConfig) {
        record.snapshot = { ...record.snapshot, config: { ...record.snapshot.config, ...restoredConfig }, updatedAt: this.now() };
      }
      previousUnsubscribe();
      previousClient.close();
    } catch (error) {
      replacement.close();
      throw error;
    }
  }

  private handleRpcEvent(sessionRef: SessionRef, client: RpcClientLike, generation: number, event: RpcEvent): void {
    const record = this.sessions.get(this.key(sessionRef));
    if (!record || record.closed || record.client !== client || record.clientGeneration !== generation) return;
    if (event.type === "agent_start") {
      if (record.suppressRunEvents && !record.snapshot.runningRunId) return;
      delete record.suppressRunEvents;
      delete record.pendingAssistantError;
      const runId = record.snapshot.runningRunId;
      if (!runId) return;
      record.snapshot = { ...record.snapshot, status: "running", runningRunId: runId, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), runId, snapshot: record.snapshot });
      return;
    }
    if (record.suppressRunEvents) return;

    if (record.cancellingRunId && record.snapshot.runningRunId === record.cancellingRunId) {
      // A stream failure arriving mid-cancel is the user's own stop landing, not an error.
      if (streamFailureMessage(event)) this.endRun(record, record.cancellingRunId, { cancelled: true });
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

    const finalizedAssistantError = finalizedAssistantMessageFailure(event);
    if (finalizedAssistantError) {
      record.pendingAssistantError = finalizedAssistantError;
      return;
    }

    if (event.type === "agent_end") {
      if (event.willRetry === true) return;
      if (!activeRunId) return;
      if (record.pendingAssistantError) {
        this.failRun(record, activeRunId, record.pendingAssistantError);
        return;
      }
      const { runningRunId: _runningRunId, ...snapshotWithoutRunId } = record.snapshot;
      record.snapshot = { ...snapshotWithoutRunId, status: "idle", updatedAt: this.now() };
      if (isLunaSession(record.snapshot)) record.lunaChildNeedsRotation = true;
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
    this.endRun(record, runId, { message });
  }

  /**
   * Terminates a run. `cancelled` runs are the user's own stop: same teardown, but
   * reported as `runCancelled` so the UI never paints them as an error.
   */
  private endRun(record: SessionRecord, runId: string, outcome: { message: string } | { cancelled: true }): void {
    if (record.suppressRunEvents && !record.snapshot.runningRunId) return;
    const { runningRunId: _runningRunId, ...snapshotWithoutRunId } = record.snapshot;
    delete record.cancellingRunId;
    delete record.pendingAssistantError;
    record.suppressRunEvents = true;
    record.snapshot = { ...snapshotWithoutRunId, status: "idle", updatedAt: this.now() };
    if (isLunaSession(record.snapshot)) record.lunaChildNeedsRotation = true;
    this.emit(record.ref, { type: "sessionUpdated", sessionRef: record.ref, timestamp: this.now(), snapshot: record.snapshot });
    this.emit(
      record.ref,
      "cancelled" in outcome
        ? { type: "runCancelled", sessionRef: record.ref, timestamp: this.now(), runId }
        : { type: "runFailed", sessionRef: record.ref, timestamp: this.now(), runId, error: { message: outcome.message } },
    );
  }

  private emit(sessionRef: SessionRef, event: SessionDriverEvent): void {
    const listeners = this.listeners.get(this.key(sessionRef));
    if (!listeners) return;
    for (const listener of listeners) void listener(event);
  }

  private requireSession(sessionRef: SessionRef): SessionRecord {
    const record = this.sessions.get(this.key(sessionRef));
    if (!record || record.closed) throw new Error(`RPC session is not open: ${this.key(sessionRef)}`);
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

const SESSION_TREE_KINDS = new Set<SessionTreeNodeSnapshot["kind"]>([
  "message",
  "thinking_level_change",
  "model_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

/**
 * Maps pi's session tree to the desktop snapshot shape. Pi's entry `type` values are the
 * same nine literals the UI knows; a node of an unrecognised kind is skipped and its
 * children are hoisted to its parent, so a future pi entry type cannot hide a branch.
 */
function mapSessionTreeNodes(nodes: unknown): readonly SessionTreeNodeSnapshot[] {
  if (!Array.isArray(nodes)) return [];
  const mapped: SessionTreeNodeSnapshot[] = [];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const record = node as { entry?: unknown; children?: unknown; label?: unknown };
    const children = mapSessionTreeNodes(record.children);
    const entry = record.entry as Record<string, unknown> | undefined;
    const kind = typeof entry?.type === "string" ? entry.type : undefined;
    if (!entry || !kind || !SESSION_TREE_KINDS.has(kind as SessionTreeNodeSnapshot["kind"])) {
      mapped.push(...children);
      continue;
    }
    const role = typeof (entry.message as { role?: unknown } | undefined)?.role === "string"
      ? String((entry.message as { role?: unknown }).role)
      : undefined;
    const preview = sessionTreePreview(entry);
    mapped.push({
      id: String(entry.id ?? ""),
      parentId: typeof entry.parentId === "string" ? entry.parentId : null,
      kind: kind as SessionTreeNodeSnapshot["kind"],
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
      title: typeof record.label === "string" && record.label ? record.label : sessionTreeTitle(kind, entry),
      ...(typeof record.label === "string" && record.label ? { label: record.label } : {}),
      ...(role ? { role } : {}),
      ...(typeof entry.customType === "string" ? { customType: entry.customType } : {}),
      ...(preview ? { preview } : {}),
      children,
    });
  }
  return mapped;
}

function sessionTreeTitle(kind: string, entry: Record<string, unknown>): string {
  switch (kind) {
    case "model_change":
      return `Model: ${String(entry.provider ?? "")}/${String(entry.modelId ?? "")}`;
    case "thinking_level_change":
      return `Thinking: ${String(entry.thinkingLevel ?? "")}`;
    case "compaction":
      return "Compacted";
    case "branch_summary":
      return "Branch summary";
    case "session_info":
      return typeof entry.name === "string" && entry.name ? entry.name : "Session";
    case "label":
      return typeof entry.label === "string" ? entry.label : "Label";
    default:
      return kind.replace(/_/g, " ");
  }
}

function sessionTreePreview(entry: Record<string, unknown>): string | undefined {
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return undefined;
  const text = textFromJsonlContent(message.content).trim();
  return text ? text.slice(0, 160) : undefined;
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

function finalizedAssistantMessageFailure(event: RpcEvent): string | undefined {
  if (event.type !== "message_end") return undefined;
  const message = event.message as Record<string, unknown> | undefined;
  if (message?.role !== "assistant" || message.stopReason !== "error") return undefined;
  return String(message.errorMessage ?? message.error ?? "Assistant message failed");
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

function sessionConfigFromState(data: unknown): SessionSnapshot["config"] | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const state = data as { model?: { provider?: unknown; id?: unknown }; thinkingLevel?: unknown };
  const provider = typeof state.model?.provider === "string" ? state.model.provider : undefined;
  const modelId = typeof state.model?.id === "string" ? state.model.id : undefined;
  const thinkingLevel = typeof state.thinkingLevel === "string" ? state.thinkingLevel : undefined;
  if (!provider && !modelId && !thinkingLevel) return undefined;
  return {
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

function isLunaSession(snapshot: SessionSnapshot): boolean {
  return snapshot.config?.provider === "openai-codex" && snapshot.config.modelId === "gpt-5.6-luna";
}

function assertRestoredSessionConfig(expected: SessionSnapshot["config"], actual: SessionSnapshot["config"] | undefined): void {
  if (expected?.provider && actual?.provider !== expected.provider) {
    throw new Error(`Replacement Pi RPC provider mismatch: expected ${expected.provider}, got ${actual?.provider ?? "none"}`);
  }
  if (expected?.modelId && actual?.modelId !== expected.modelId) {
    throw new Error(`Replacement Pi RPC model mismatch: expected ${expected.modelId}, got ${actual?.modelId ?? "none"}`);
  }
  if (expected?.thinkingLevel && actual?.thinkingLevel !== expected.thinkingLevel) {
    throw new Error(`Replacement Pi RPC thinking mismatch: expected ${expected.thinkingLevel}, got ${actual?.thinkingLevel ?? "none"}`);
  }
}

type SessionImageLike = Extract<SessionAttachment, { kind: "image" }>;

function imageAttachments(input: SessionMessageInput): unknown[] | undefined {
  const images = input.attachments?.filter((attachment): attachment is SessionImageLike => attachment.kind === "image");
  if (!images || images.length === 0) return undefined;
  return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}
