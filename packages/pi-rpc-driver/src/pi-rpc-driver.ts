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
  SessionMessageDeliveryMode,
  SessionMessageInput,
  SessionModelSelection,
  SessionQueuedMessage,
  SessionRef,
  SessionSnapshot,
  SessionTreeSnapshot,
  SessionTreeNodeSnapshot,
  SessionTranscriptItem,
  SessionTranscriptToolCall,
  Unsubscribe,
  WorkspaceRef,
} from "@alamelu-pi/session-driver";
import type { RuntimeCommandRecord } from "@alamelu-pi/session-driver/runtime-types";
import { mapRpcEventToSessionDriverEvents } from "./event-mapper.js";
import type { RpcClient, RpcEvent, RpcResponse } from "./rpc-client.js";
import { NO_RPC_DEADLINE, spawnPiRpcClient } from "./rpc-client.js";
import { canonicalizePath, pathContains, validateLabPaths, type LabPathInput, type ValidatedLabPaths } from "./path-guards.js";

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

/** A message the user sent during work; `handedToPi` once Pi's own queue holds it. */
interface QueuedEntry {
  readonly message: SessionQueuedMessage;
  handedToPi: boolean;
}

interface SessionRecord {
  readonly ref: SessionRef;
  readonly workspace: WorkspaceRef;
  client: RpcClientLike;
  unsubscribeClient: Unsubscribe;
  clientGeneration: number;
  snapshot: SessionSnapshot;
  transcriptText: string;
  /** Accepted queue entries in order: held locally (manual compaction) or handed to Pi. */
  queue: QueuedEntry[];
  /** Last per-mode queue sizes reported by Pi's queue_update; decreases mean consumption. */
  piQueueCounts: Record<SessionMessageDeliveryMode, number>;
  /** Set from manual /compact acceptance until its terminal event, so failures before compaction_start still end it. */
  manualOperation?: { readonly token: string };
  /**
   * Frees the manual compaction's wait for Pi's response on a terminal failure, even after
   * compaction_end already cleared the marker (a fatal parse error can hit the response line
   * itself); cleared once that wait completes.
   */
  releaseManualWait?: () => void;
  drainScheduled?: boolean;
  childNeedsRotation?: boolean;
  restartingClient?: Promise<void>;
  idleOperationTail?: Promise<void>;
  closed?: boolean;
  cancellingRunId?: string;
  pendingAssistantError?: string;
  suppressRunEvents?: boolean;
}

function emptyQueueCounts(): Record<SessionMessageDeliveryMode, number> {
  return { steer: 0, followUp: 0 };
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
      const compacting = compactingFromState(state.data, this.now());
      const snapshot = this.makeSnapshot(ref, workspace, {
        title: options?.title ?? sessionNameFromState(state.data) ?? "RPC Session",
        status: compacting ? "running" : "idle",
        ...(compacting ? { compacting } : {}),
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
        queue: [],
        piQueueCounts: emptyQueueCounts(),
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

  async openSession(sessionRef: SessionRef, storedUpdatedAt?: string): Promise<SessionSnapshot> {
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
      const compacting = compactingFromState(state.data, this.now());

      const snapshot = this.makeSnapshot(sessionRef, workspace, {
        title: sessionNameFromState(state.data) ?? "RPC Session",
        status: compacting ? "running" : "idle",
        ...(compacting ? { compacting } : {}),
        // Opening a stored conversation is a read, not a new update.
        ...(storedUpdatedAt ? { updatedAt: storedUpdatedAt } : {}),
        ...(stateConfig ? { config: stateConfig } : {}),
      });
      const record: SessionRecord = {
        ref: sessionRef,
        workspace,
        client,
        snapshot,
        transcriptText: "",
        queue: [],
        piQueueCounts: emptyQueueCounts(),
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
    const record = this.requireSession(sessionRef);
    if (input.deliverAs) {
      const message = queuedMessageFromInput(input, input.deliverAs, this.now());
      if (record.snapshot.runningRunId) {
        return this.handOffToPi(record, message);
      }
      if (record.snapshot.status === "running") {
        // Accepted manual work (a /compact) is in progress. Pi's follow_up queue would park the
        // message forever after a manual compaction, so hold it here and start it afterwards.
        record.queue.push({ message, handedToPi: false });
        this.publishQueue(record);
        this.scheduleDrain(record);
        return;
      }
      throw new Error("RPC steering and follow-up messages require a running session");
    }
    return this.enqueueIdleOperation(record, () => this.startPrompt(sessionRef, input));
  }

  /**
   * Normal prompt path. Resolves once the command is dispatched (app-level acceptance);
   * Pi acknowledges only after preflight, which may wait behind automatic compaction, so
   * that acknowledgement has no deadline and its failure surfaces as a runFailed event.
   */
  private async startPrompt(sessionRef: SessionRef, input: SessionMessageInput): Promise<void> {
    let record = this.requireSession(sessionRef);
    if (record.snapshot.status === "running" || record.snapshot.runningRunId) {
      throw new Error("RPC session is already running; re-entrant prompts are not supported by the prototype");
    }
    await this.rotateChildBeforePrompt(record);
    record = this.requireSession(sessionRef);
    if (record.snapshot.status === "running" || record.snapshot.runningRunId) {
      throw new Error("RPC session became active while preparing a prompt");
    }
    const runId = randomUUID();
    // Stale-run suppression stays until Pi's agent_start for this run: a late agent_settled of a
    // failed run must not complete this one. Compaction and queue events bypass that gate.
    record.snapshot = { ...record.snapshot, status: "running", runningRunId: runId, updatedAt: this.now() };
    record.transcriptText += `${record.transcriptText ? "\n" : ""}User: ${input.text}\nAssistant: `;
    this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), runId, snapshot: record.snapshot });

    record.client
      .sendCommand({ type: "prompt", message: input.text, images: imageAttachments(input) }, `prompt-${runId}`, NO_RPC_DEADLINE)
      .then(
        (response) => {
          if (!response.success) this.failAcceptedRun(record, runId, response.error ?? "RPC prompt failed");
        },
        (error) => this.failAcceptedRun(record, runId, error instanceof Error ? error.message : String(error)),
      );
  }

  /** Fails a run only while it is still the active one; a run ended by events is left alone. */
  private failAcceptedRun(record: SessionRecord, runId: string, message: string): void {
    if (record.snapshot.runningRunId !== runId) return;
    this.failRun(record, runId, message);
  }

  /** Registers the entry before Pi's insertion event can arrive, then hands it to Pi's queue. */
  private async handOffToPi(record: SessionRecord, message: SessionQueuedMessage): Promise<void> {
    const entry: QueuedEntry = { message, handedToPi: true };
    record.queue.push(entry);
    this.publishQueue(record);
    const commandType = message.mode === "steer" ? "steer" : "follow_up";
    let failure: string | undefined;
    try {
      const response = await record.client.sendCommand(
        { type: commandType, message: message.text, images: imageAttachments(message) },
        `${commandType}-${message.id}`,
      );
      if (!response.success) failure = response.error ?? `RPC ${commandType} failed`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure !== undefined) {
      this.dropQueueEntry(record, entry);
      throw new Error(failure);
    }
  }

  /** Drain hand-off: written without awaiting so several entries keep their stdin order. */
  private writeQueueCommand(record: SessionRecord, entry: QueuedEntry): void {
    const commandType = entry.message.mode === "steer" ? "steer" : "follow_up";
    void record.client
      .sendCommand(
        { type: commandType, message: entry.message.text, images: imageAttachments(entry.message) },
        `${commandType}-${entry.message.id}`,
      )
      .then(
        (response) => {
          if (!response.success) this.rejectHandOff(record, entry, response.error ?? `RPC ${commandType} failed`);
        },
        (error) => this.rejectHandOff(record, entry, error instanceof Error ? error.message : String(error)),
      );
  }

  private rejectHandOff(record: SessionRecord, entry: QueuedEntry, message: string): void {
    // Already cleared by a terminal outcome: that failure was reported once.
    if (!record.queue.includes(entry)) return;
    this.dropQueueEntry(record, entry);
    this.emit(record.ref, {
      type: "hostUiRequest",
      sessionRef: record.ref,
      timestamp: this.now(),
      ...(record.snapshot.runningRunId ? { runId: record.snapshot.runningRunId } : {}),
      request: { kind: "notify", requestId: randomUUID(), message: `Queued message was not accepted: ${message}`, level: "error" },
    });
  }

  private dropQueueEntry(record: SessionRecord, entry: QueuedEntry): void {
    const index = record.queue.indexOf(entry);
    if (index < 0) return;
    record.queue.splice(index, 1);
    this.publishQueue(record);
  }

  private publishQueue(record: SessionRecord): void {
    const { queuedMessages: _queuedMessages, ...rest } = record.snapshot;
    record.snapshot =
      record.queue.length > 0
        ? { ...rest, queuedMessages: record.queue.map((entry) => entry.message), updatedAt: this.now() }
        : { ...rest, updatedAt: this.now() };
    this.emitSnapshot(record);
  }

  private emitSnapshot(record: SessionRecord): void {
    this.emit(record.ref, {
      type: "sessionUpdated",
      sessionRef: record.ref,
      timestamp: this.now(),
      ...(record.snapshot.runningRunId ? { runId: record.snapshot.runningRunId } : {}),
      snapshot: record.snapshot,
    });
  }

  /** One drain per wait: runs behind the current idle operation (the manual compaction). */
  private scheduleDrain(record: SessionRecord): void {
    if (record.drainScheduled) return;
    record.drainScheduled = true;
    void this.enqueueIdleOperation(record, async () => {
      record.drainScheduled = false;
      await this.drainHeldMessages(record);
    }).catch(() => undefined);
  }

  /**
   * Starts the first held message as a normal prompt and hands the rest to Pi's queue in
   * order. Held entries are left alone while compaction is still running (compaction_end
   * schedules the next drain) or when a terminal outcome already cleared them.
   */
  private async drainHeldMessages(record: SessionRecord): Promise<void> {
    if (record.closed || this.sessions.get(this.key(record.ref)) !== record) return;
    if (record.snapshot.runningRunId || record.snapshot.compacting || record.manualOperation) return;
    const held = record.queue.filter((entry) => !entry.handedToPi);
    if (held.length === 0) return;
    const [first, ...rest] = held as [QueuedEntry, ...QueuedEntry[]];
    this.dropQueueEntry(record, first);
    this.emit(record.ref, { type: "queuedMessageStarted", sessionRef: record.ref, timestamp: this.now(), message: first.message });
    try {
      await this.startPrompt(record.ref, {
        id: first.message.id,
        text: first.message.text,
        ...(first.message.attachments ? { attachments: first.message.attachments } : {}),
      });
    } catch (error) {
      // The prompt never reached Pi (guard or child replacement failure): one terminal failure.
      this.failRun(record, randomUUID(), error instanceof Error ? error.message : String(error));
      return;
    }
    for (const entry of rest) {
      entry.handedToPi = true;
      this.writeQueueCommand(record, entry);
    }
    this.publishQueue(record);
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
      const current = await this.prepareIdleClientForMutation(record);
      const response = await current.client.sendCommand({ type: "set_model", provider: selection.provider, modelId: selection.modelId }, `set-model-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC set_model failed");
      current.snapshot = { ...current.snapshot, config: { ...current.snapshot.config, provider: selection.provider, modelId: selection.modelId }, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleClientForMutation(record);
      const response = await current.client.sendCommand({ type: "set_thinking_level", level: thinkingLevel }, `set-thinking-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC set_thinking_level failed");
      current.snapshot = { ...current.snapshot, config: { ...current.snapshot.config, thinkingLevel }, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  async renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleClientForMutation(record);
      const response = await current.client.sendCommand({ type: "set_session_name", name: title }, `set-name-${randomUUID()}`);
      if (!response.success) throw new Error(response.error ?? "RPC set_session_name failed");
      current.snapshot = { ...current.snapshot, title, updatedAt: this.now() };
      this.emit(sessionRef, { type: "sessionUpdated", sessionRef, timestamp: this.now(), snapshot: current.snapshot });
    });
  }

  /**
   * Manual compaction. Resolves at app-level acceptance; the session stays busy (no run id)
   * and the idle-operation tail stays occupied until Pi's response so a sequenced prompt
   * cannot reach Pi mid-compaction. Outcome, tokens and errors arrive via compaction_end.
   */
  compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void> {
    const record = this.requireSession(sessionRef);
    return new Promise<void>((resolveAccepted, rejectAccepted) => {
      void this.enqueueIdleOperation(record, async () => {
        const token = randomUUID();
        let current: SessionRecord;
        let pending: Promise<RpcResponse>;
        let release: () => void = () => undefined;
        const terminated = new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          current = await this.prepareIdleClientForMutation(record);
          current.manualOperation = { token };
          current.releaseManualWait = release;
          current.snapshot = { ...current.snapshot, status: "running", updatedAt: this.now() };
          this.emitSnapshot(current);
          pending = current.client.sendCommand(
            { type: "compact", ...(customInstructions ? { customInstructions } : {}) },
            `compact-${token}`,
            NO_RPC_DEADLINE,
          );
        } catch (error) {
          rejectAccepted(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolveAccepted();
        let failure: string | undefined;
        try {
          // A terminal failure (transport closed, fatal parse error) releases this wait even
          // when the command promise can never settle, so later operations are not stuck.
          pending.catch(() => undefined);
          const response = await Promise.race([pending, terminated.then(() => undefined)]);
          if (response && !response.success) failure = response.error ?? "RPC compact failed";
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        } finally {
          if (current.releaseManualWait === release) delete current.releaseManualWait;
        }
        if (current.manualOperation?.token === token) {
          // No compaction_end (or transport failure) reported this operation: fail it exactly once.
          this.failRun(current, randomUUID(), failure ?? "RPC compact finished without a compaction_end event");
        }
      });
    });
  }

  async reloadSession(sessionRef: SessionRef): Promise<void> {
    const record = this.requireSession(sessionRef);
    return this.enqueueIdleOperation(record, async () => {
      const current = await this.prepareIdleClientForMutation(record);
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
      const current = await this.prepareIdleClientForMutation(record);
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

  async getSessionContextMessages(sessionRef: SessionRef): Promise<readonly unknown[] | undefined> {
    try {
      const record = await this.waitForClientRestart(this.requireSession(sessionRef));
      const response = await record.client.sendCommand({ type: "get_messages" }, `context-${randomUUID()}`);
      const data = response.data as { messages?: unknown } | undefined;
      return response.success && Array.isArray(data?.messages) ? data.messages : undefined;
    } catch {
      // Missing context must not turn a speculative size check into a failed switch.
      return undefined;
    }
  }

  async getTranscript(sessionRef: SessionRef): Promise<readonly SessionTranscriptItem[]> {
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
    return assistantText
      ? [{ kind: "message", role: "assistant", text: assistantText, createdAt: new Date(0).toISOString(), id: randomUUID() }]
      : [];
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

  private async prepareIdleClientForMutation(record: SessionRecord): Promise<SessionRecord> {
    if (!record.snapshot.runningRunId && record.snapshot.status !== "running") {
      await this.rotateChildBeforePrompt(record);
    }
    const current = await this.waitForClientRestart(record);
    if (current.snapshot.runningRunId || current.snapshot.status === "running") {
      throw new Error("RPC session is running; session configuration changes must wait for it to finish");
    }
    return current;
  }

  private async rotateChildBeforePrompt(record: SessionRecord): Promise<void> {
    if (!record.childNeedsRotation) return;
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
      record.piQueueCounts = emptyQueueCounts();
      delete record.childNeedsRotation;
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
    // Session-level state that outlives any single run is handled ahead of the stale-run gate:
    // a /compact after a stopped run, or preflight compaction of the next prompt, must be visible.
    if (event.type === "compaction_start") {
      this.handleCompactionStart(record, event);
      return;
    }
    if (event.type === "compaction_end") {
      this.handleCompactionEnd(record, event);
      return;
    }
    if (event.type === "queue_update") {
      this.handleQueueUpdate(record, event);
      return;
    }
    const streamFailure = streamFailureMessage(event);
    if (streamFailure && (record.manualOperation || record.releaseManualWait) && !record.snapshot.runningRunId) {
      // Accepted manual work — including a compact still waiting for Pi's acknowledgement after
      // compaction_end — must terminate on a transport/parse failure while the stale-run gate
      // of a previous Stop/failure is active.
      this.failRun(record, randomUUID(), streamFailure);
      return;
    }
    if (record.suppressRunEvents) return;

    if (record.cancellingRunId && record.snapshot.runningRunId === record.cancellingRunId) {
      // A stream failure arriving mid-cancel is the user's own stop landing, not an error.
      if (streamFailure) this.endRun(record, record.cancellingRunId, { cancelled: true });
      return;
    }

    const activeRunId = record.snapshot.runningRunId;
    if (streamFailure) {
      // Accepted manual work counts as active: a dead child can never send its compaction_end.
      if (!activeRunId && !record.manualOperation && isBenignInactiveStreamFailure(streamFailure)) {
        record.childNeedsRotation = true;
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

    if (event.type === "agent_settled") {
      // agent_end may be followed by retry, compaction retry or queued continuations; only
      // Pi's session-level agent_settled ends the run.
      if (!activeRunId) return;
      if (record.pendingAssistantError) {
        this.failRun(record, activeRunId, record.pendingAssistantError);
        return;
      }
      const { runningRunId: _runningRunId, ...snapshotWithoutRunId } = record.snapshot;
      record.snapshot = { ...snapshotWithoutRunId, status: "idle", updatedAt: this.now() };
      record.childNeedsRotation = true;
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

  private handleCompactionStart(record: SessionRecord, event: RpcEvent): void {
    const startedAt = this.now();
    const reason = typeof event.reason === "string" ? event.reason : "unknown";
    record.snapshot = { ...record.snapshot, status: "running", compacting: { reason, startedAt }, updatedAt: startedAt };
    this.emitSnapshot(record);
    this.emit(record.ref, {
      type: "compactionStarted",
      sessionRef: record.ref,
      timestamp: startedAt,
      ...(record.snapshot.runningRunId ? { runId: record.snapshot.runningRunId } : {}),
      reason,
      startedAt,
    });
  }

  private handleCompactionEnd(record: SessionRecord, event: RpcEvent): void {
    const endedAt = this.now();
    const compacting = record.snapshot.compacting;
    const reason = typeof event.reason === "string" ? event.reason : compacting?.reason ?? "unknown";
    const startedAt = compacting?.startedAt ?? endedAt;
    const errorMessage = typeof event.errorMessage === "string" ? event.errorMessage : undefined;
    const outcome = event.aborted === true ? "cancelled" : errorMessage ? "failed" : "completed";
    const result = typeof event.result === "object" && event.result !== null ? (event.result as Record<string, unknown>) : undefined;
    const tokensBefore = typeof result?.tokensBefore === "number" ? result.tokensBefore : undefined;
    const estimatedTokensAfter = typeof result?.estimatedTokensAfter === "number" ? result.estimatedTokensAfter : undefined;
    delete record.manualOperation;
    const { compacting: _compacting, ...rest } = record.snapshot;
    record.snapshot = { ...rest, status: rest.runningRunId ? "running" : "idle", updatedAt: endedAt };
    this.emit(record.ref, {
      type: "compactionEnded",
      sessionRef: record.ref,
      timestamp: endedAt,
      ...(record.snapshot.runningRunId ? { runId: record.snapshot.runningRunId } : {}),
      reason,
      startedAt,
      endedAt,
      outcome,
      ...(errorMessage ? { error: errorMessage } : {}),
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(estimatedTokensAfter !== undefined ? { estimatedTokensAfter } : {}),
    });
    this.emitSnapshot(record);
    if (!record.snapshot.runningRunId && record.queue.some((entry) => !entry.handedToPi)) {
      this.scheduleDrain(record);
    }
  }

  /** Consumption is a decrease in Pi's per-mode count; insertions (increases) remove nothing. */
  private handleQueueUpdate(record: SessionRecord, event: RpcEvent): void {
    const counts: Record<SessionMessageDeliveryMode, number> = {
      steer: Array.isArray(event.steering) ? event.steering.length : 0,
      followUp: Array.isArray(event.followUp) ? event.followUp.length : 0,
    };
    const consumed: SessionQueuedMessage[] = [];
    for (const mode of ["steer", "followUp"] as const) {
      let decrease = record.piQueueCounts[mode] - counts[mode];
      record.piQueueCounts[mode] = counts[mode];
      while (decrease > 0) {
        const index = record.queue.findIndex((entry) => entry.handedToPi && entry.message.mode === mode);
        if (index < 0) break;
        const [entry] = record.queue.splice(index, 1);
        if (entry) consumed.push(entry.message);
        decrease -= 1;
      }
    }
    if (consumed.length === 0) return;
    for (const message of consumed) {
      this.emit(record.ref, {
        type: "queuedMessageStarted",
        sessionRef: record.ref,
        timestamp: this.now(),
        ...(record.snapshot.runningRunId ? { runId: record.snapshot.runningRunId } : {}),
        message,
      });
    }
    this.publishQueue(record);
  }

  private failRun(record: SessionRecord, runId: string, message: string): void {
    this.endRun(record, runId, { message });
  }

  /**
   * Terminates a run. `cancelled` runs are the user's own stop: same teardown, but
   * reported as `runCancelled` so the UI never paints them as an error.
   */
  private endRun(record: SessionRecord, runId: string, outcome: { message: string } | { cancelled: true }): void {
    // Stale events after a terminated run are ignored, but accepted manual work (marker, or a
    // compact still awaiting its acknowledgement) is live and must end.
    if (record.suppressRunEvents && !record.snapshot.runningRunId && !record.manualOperation && !record.releaseManualWait) return;
    const { runningRunId: _runningRunId, compacting: _compacting, queuedMessages: _queuedMessages, ...snapshotWithoutRunId } = record.snapshot;
    delete record.cancellingRunId;
    delete record.pendingAssistantError;
    delete record.manualOperation;
    record.releaseManualWait?.();
    delete record.releaseManualWait;
    record.queue = [];
    record.piQueueCounts = emptyQueueCounts();
    record.suppressRunEvents = true;
    record.snapshot = { ...snapshotWithoutRunId, status: "idle", updatedAt: this.now() };
    record.childNeedsRotation = true;
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
    values: Pick<SessionSnapshot, "title" | "status"> & Partial<Pick<SessionSnapshot, "config" | "runningRunId" | "updatedAt" | "compacting">>,
  ): SessionSnapshot {
    return {
      ref,
      workspace,
      title: values.title,
      status: values.status,
      updatedAt: values.updatedAt ?? this.now(),
      ...(values.config ? { config: values.config } : {}),
      ...(values.runningRunId ? { runningRunId: values.runningRunId } : {}),
      ...(values.compacting ? { compacting: values.compacting } : {}),
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

/**
 * Rebuilds a stored session into timeline items. pi records an assistant turn's tool
 * calls as `toolCall` content parts and their results as separate `toolResult`
 * messages keyed by `toolCallId`, so the two are paired here — otherwise a resumed
 * thread shows bare text where the live view showed tool cards and diffs.
 */
function transcriptFromLocalSessionFile(sessionDir: string, sessionId: string): SessionTranscriptItem[] {
  try {
    const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
    const match = entries.find((entry) => entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`));
    if (!match) return [];
    const filePath = path.join(sessionDir, match.name);
    const resolved = fs.realpathSync.native(filePath);
    if (!resolved.startsWith(`${sessionDir}${path.sep}`)) return [];

    const items: SessionTranscriptItem[] = [];
    const toolIndexByCallId = new Map<string, number>();
    // Calls whose result was never recorded: their turn's stopReason decides whether
    // they finished or were interrupted. Defaulting them to success would present
    // aborted and failed calls as if they had worked.
    const unresolvedByCallId = new Map<string, string | undefined>();

    for (const line of fs.readFileSync(resolved, "utf8").split(/\n/)) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof event !== "object" || event === null) continue;
      const record = event as Record<string, unknown>;
      if (record.type !== "message" || typeof record.message !== "object" || record.message === null) continue;

      const message = record.message as Record<string, unknown>;
      const entryId = typeof record.id === "string" ? record.id : randomUUID();
      const timestamp = typeof record.timestamp === "string" ? record.timestamp : new Date(0).toISOString();

      if (message.role === "toolResult") {
        const callId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
        if (!callId) continue;
        const index = toolIndexByCallId.get(callId);
        if (index === undefined) continue;
        unresolvedByCallId.delete(callId);
        const existing = items[index] as SessionTranscriptToolCall;
        // Keep the whole result object, exactly as the live tool_execution_end path
        // does: edit diffs live in `details.diff`, not in the text content, and the
        // renderer reads them from there.
        const output: Record<string, unknown> = {};
        if (message.content !== undefined) output.content = message.content;
        if (message.details !== undefined) output.details = message.details;
        const failed = message.isError === true;
        items[index] = {
          ...existing,
          status: failed ? "error" : "success",
          ...(Object.keys(output).length > 0 ? { output } : {}),
        };
        continue;
      }

      if (message.role === "bashExecution") {
        const command = typeof message.command === "string" ? message.command : "";
        const cancelled = message.cancelled === true;
        const exitCode = typeof message.exitCode === "number" ? message.exitCode : undefined;
        // Namespaced so a pi entry id can never collide with a model-provided
        // tool-call id and produce two rows sharing a key.
        const bashCallId = `bash-exec:${entryId}`;
        const truncated = message.truncated === true;
        items.push({
          kind: "tool",
          id: bashCallId,
          callId: bashCallId,
          toolName: "bash",
          status: cancelled || (exitCode !== undefined && exitCode !== 0) ? "error" : "success",
          label: command ? `bash ${command}`.slice(0, 120) : "bash",
          createdAt: timestamp,
          ...(cancelled
            ? { detail: truncated ? "Cancelled · output truncated" : "Cancelled" }
            : exitCode
              ? { detail: truncated ? `exit ${exitCode} · output truncated` : `exit ${exitCode}` }
              : truncated
                ? { detail: "Output truncated" }
                : {}),
          ...(command ? { input: { command } } : {}),
          ...(message.output !== undefined
            ? {
                output: {
                  content: message.output,
                  ...(truncated ? { truncated: true } : {}),
                  ...(typeof message.fullOutputPath === "string" ? { fullOutputPath: message.fullOutputPath } : {}),
                },
              }
            : {}),
        });
        continue;
      }

      const role = normalizeTranscriptRole(message.role);
      if (!role) continue;

      const text = textFromJsonlContent(message.content).trim();
      if (text) {
        items.push({ kind: "message", role, text, createdAt: timestamp, id: entryId });
      }

      if (role === "assistant" && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (typeof part !== "object" || part === null) continue;
          const partRecord = part as Record<string, unknown>;
          if (partRecord.type !== "toolCall") continue;
          const callId = typeof partRecord.id === "string" ? partRecord.id : randomUUID();
          const toolName = typeof partRecord.name === "string" ? partRecord.name : "tool";
          toolIndexByCallId.set(callId, items.length);
          unresolvedByCallId.set(callId, typeof message.stopReason === "string" ? message.stopReason : undefined);
          items.push({
            kind: "tool",
            id: callId,
            callId,
            toolName,
            // A call with no stored result never reported one; "running" would imply
            // it is still in flight, which it is not on a resumed thread.
            status: "success",
            label: toolName,
            createdAt: timestamp,
            ...(partRecord.arguments !== undefined ? { input: partRecord.arguments } : {}),
          });
        }
      }
    }

    for (const [callId, stopReason] of unresolvedByCallId) {
      const index = toolIndexByCallId.get(callId);
      if (index === undefined) continue;
      const existing = items[index] as SessionTranscriptToolCall;
      const interrupted = stopReason === "aborted" || stopReason === "error";
      items[index] = {
        ...existing,
        status: interrupted ? "error" : existing.status,
        ...(interrupted ? { detail: stopReason === "aborted" ? "Interrupted" : "Failed" } : {}),
      };
    }

    return items;
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

function transcriptFromRpcMessages(data: unknown): SessionTranscriptItem[] {
  const messages = typeof data === "object" && data !== null && Array.isArray((data as { messages?: unknown }).messages)
    ? (data as { messages: unknown[] }).messages
    : [];
  return messages
    .map((message) => transcriptRowFromRpcMessage(message))
    .filter((row): row is SessionTranscriptItem => Boolean(row));
}

function transcriptRowFromRpcMessage(message: unknown): SessionTranscriptItem | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const record = message as Record<string, unknown>;
  const role = normalizeTranscriptRole(record.role ?? record.type);
  if (!role) return undefined;
  const text = textFromRpcMessage(record).trim();
  return text
    ? { kind: "message", role, text, createdAt: new Date(0).toISOString(), id: randomUUID() }
    : undefined;
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

function compactingFromState(data: unknown, startedAt: string): SessionSnapshot["compacting"] | undefined {
  return typeof data === "object" && data !== null && (data as { isCompacting?: unknown }).isCompacting === true
    ? { reason: "unknown", startedAt }
    : undefined;
}

function queuedMessageFromInput(input: SessionMessageInput, mode: SessionMessageDeliveryMode, timestamp: string): SessionQueuedMessage {
  return {
    id: input.id ?? randomUUID(),
    mode,
    text: input.text,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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

type SessionImageLike = Extract<SessionAttachment, { kind: "image" }>;

function imageAttachments(input: { readonly attachments?: readonly SessionAttachment[] }): unknown[] | undefined {
  const images = input.attachments?.filter((attachment): attachment is SessionImageLike => attachment.kind === "image");
  if (!images || images.length === 0) return undefined;
  return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}
