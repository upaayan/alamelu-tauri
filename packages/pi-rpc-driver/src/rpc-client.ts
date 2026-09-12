import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { JsonlDecoder } from "./jsonl-decoder.js";

export type RpcJsonObject = Record<string, unknown>;

export interface RpcResponse extends RpcJsonObject {
  readonly type: "response";
  readonly id?: string;
  readonly command?: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export type RpcEvent = RpcJsonObject;
export type RpcEventListener = (event: RpcEvent) => void;

export interface RpcTransport {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr?: Readable;
  kill(signal?: NodeJS.Signals): void;
}

export interface RpcClientOptions {
  readonly defaultTimeoutMs?: number;
  readonly closeKillDelayMs?: number;
  readonly onStderr?: (line: string) => void;
}

/**
 * Explicit "no acknowledgement deadline" for commands whose response legitimately waits
 * behind long work (prompt preflight compaction, manual compact). Node timers cannot
 * express this, so sendCommand simply creates no timer for it.
 */
export const NO_RPC_DEADLINE = Number.POSITIVE_INFINITY;

interface PendingCommand {
  readonly resolve: (response: RpcResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer?: NodeJS.Timeout;
}

export class RpcClient {
  private readonly stdoutDecoder = new JsonlDecoder();
  private readonly stderrDecoder = new JsonlDecoder();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly listeners = new Set<RpcEventListener>();
  private closed = false;
  private cleanupStarted = false;
  private closeKillTimer: NodeJS.Timeout | undefined;
  private readonly defaultTimeoutMs: number;
  private readonly closeKillDelayMs: number;

  constructor(
    private readonly transport: RpcTransport,
    options: RpcClientOptions = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.closeKillDelayMs = options.closeKillDelayMs ?? 2_000;
    this.transport.stdout.on("data", (chunk: string | Buffer) => this.handleStdout(chunk));
    this.transport.stdout.on("end", () => {
      if (this.closeKillTimer) clearTimeout(this.closeKillTimer);
      this.closed = true;
      this.emitEvent({ type: "rpc_transport_closed", reason: "stdout_end" });
      this.rejectAll(new Error("RPC stdout ended"));
    });
    this.transport.stdout.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.closed = true;
      this.emitEvent({ type: "rpc_transport_closed", reason: "stdout_error", error: message });
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });

    if (this.transport.stderr && options.onStderr) {
      this.transport.stderr.on("data", (chunk: string | Buffer) => {
        for (const line of this.stderrDecoder.push(chunk)) options.onStderr?.(line);
      });
    }
  }

  onEvent(listener: RpcEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendCommand<T extends RpcResponse = RpcResponse>(
    command: RpcJsonObject,
    id = typeof command.id === "string" ? command.id : randomUUID(),
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("RPC client is closed"));
    const outgoing = { ...command, id };
    const line = JSON.stringify(outgoing) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timer = Number.isFinite(timeoutMs)
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`RPC command timed out: ${String(command.type ?? id)}`));
          }, timeoutMs)
        : undefined;
      this.pending.set(id, { resolve: resolve as (response: RpcResponse) => void, reject, ...(timer ? { timer } : {}) });
      this.transport.stdin.write(line, "utf8", (error) => {
        if (!error) return;
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  close(): void {
    if (this.cleanupStarted) return;
    this.cleanupStarted = true;
    this.closed = true;
    this.rejectAll(new Error("RPC client closed"));
    this.transport.kill("SIGTERM");
    this.closeKillTimer = setTimeout(() => this.transport.kill("SIGKILL"), this.closeKillDelayMs);
  }

  private handleStdout(chunk: string | Buffer): void {
    for (const line of this.stdoutDecoder.push(chunk)) {
      let message: RpcJsonObject;
      try {
        message = JSON.parse(line) as RpcJsonObject;
      } catch (error) {
        this.emitEvent({ type: "rpc_parse_error", line, error: error instanceof Error ? error.message : String(error) });
        continue;
      }

      if (message.type === "response") {
        const response = message as RpcResponse;
        const id = typeof response.id === "string" ? response.id : undefined;
        if (id) {
          const pending = this.pending.get(id);
          if (pending) {
            if (pending.timer) clearTimeout(pending.timer);
            this.pending.delete(id);
            pending.resolve(response);
            continue;
          }
        }
      }

      this.emitEvent(message);
    }
  }

  private emitEvent(event: RpcEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

export interface SpawnPiRpcOptions {
  readonly piBin: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly provider?: string;
  readonly model?: string;
  readonly noTools?: boolean;
  readonly noContextFiles?: boolean;
  readonly noExtensions?: boolean;
  readonly noSkills?: boolean;
  readonly noPromptTemplates?: boolean;
  readonly noThemes?: boolean;
  readonly extensionPaths?: readonly string[];
  readonly sessionId?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onStderr?: (line: string) => void;
}

export interface PiRpcSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

export function buildPiRpcSpawnSpec(options: SpawnPiRpcOptions): PiRpcSpawnSpec {
  if (!path.isAbsolute(options.piBin)) {
    throw new Error(`RPC driver requires a resolved absolute pi binary path, got: ${options.piBin}`);
  }
  const piBin = fs.realpathSync.native(options.piBin);
  if (isWslPiExecutable(piBin)) {
    return buildWslPiRpcSpawnSpec(options, piBin, (value) => translateWindowsPathForWsl(piBin, value));
  }
  const piCommand = resolvePiRpcSpawnCommand(options.piBin, piBin);
  const args = [...piCommand.args, "--mode", "rpc", "--session-dir", options.sessionDir];
  const pathEnv = buildPiRpcPathEnv(options.piBin, piBin, options.env?.PATH ?? process.env.PATH);
  if (options.provider) args.push("--provider", options.provider);
  if (options.model) args.push("--model", options.model);
  if (options.noTools ?? true) args.push("--no-tools");
  if (options.noContextFiles ?? true) args.push("--no-context-files");
  if (options.noExtensions ?? true) args.push("--no-extensions");
  if (options.noSkills ?? true) args.push("--no-skills");
  if (options.noPromptTemplates ?? true) args.push("--no-prompt-templates");
  if (options.noThemes ?? true) args.push("--no-themes");
  for (const extensionPath of options.extensionPaths ?? []) args.push("--extension", extensionPath);
  if (options.sessionId) args.push("--session-id", options.sessionId);

  return {
    command: piCommand.command,
    args,
    env: {
      ...process.env,
      ...options.env,
      PATH: pathEnv,
      PI_CODING_AGENT_DIR: options.agentDir,
      PI_CODING_AGENT_SESSION_DIR: options.sessionDir,
    },
  };
}

export function buildWslPiRpcSpawnSpec(
  options: SpawnPiRpcOptions,
  wslExecutable: string,
  translatePath: (value: string) => string,
): PiRpcSpawnSpec {
  const args = [
    "--cd",
    options.cwd,
    "--exec",
    "bash",
    "-lic",
    'exec pi "$@"',
    "alamelu-pi",
    "--mode",
    "rpc",
    "--session-dir",
    translatePath(options.sessionDir),
  ];
  if (options.provider) args.push("--provider", options.provider);
  if (options.model) args.push("--model", options.model);
  if (options.noTools ?? true) args.push("--no-tools");
  if (options.noContextFiles ?? true) args.push("--no-context-files");
  if (options.noExtensions ?? true) args.push("--no-extensions");
  if (options.noSkills ?? true) args.push("--no-skills");
  if (options.noPromptTemplates ?? true) args.push("--no-prompt-templates");
  if (options.noThemes ?? true) args.push("--no-themes");
  for (const extensionPath of options.extensionPaths ?? []) {
    args.push("--extension", translatePath(extensionPath));
  }
  if (options.sessionId) args.push("--session-id", options.sessionId);

  const baseEnv = {
    ...process.env,
    ...options.env,
    PATH: buildPiRpcPathEnv(options.piBin, wslExecutable, options.env?.PATH ?? process.env.PATH),
    PI_CODING_AGENT_DIR: options.agentDir,
    PI_CODING_AGENT_SESSION_DIR: options.sessionDir,
  };
  return {
    command: wslExecutable,
    args,
    env: buildWslPathEnvironment(baseEnv, ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR"]),
  };
}

export function spawnPiRpcClient(options: SpawnPiRpcOptions): RpcClient {
  const spec = buildPiRpcSpawnSpec(options);
  const spawnMode = resolveRpcSpawnMode();

  const child: ChildProcessWithoutNullStreams = spawn(spec.command, spec.args, {
    cwd: options.cwd,
    env: spec.env,
    shell: false,
    detached: spawnMode.detached,
    windowsHide: spawnMode.windowsHide,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const transport: RpcTransport = {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    kill: (signal) => killProcessGroup(child, signal),
  };

  return new RpcClient(transport, {
    ...(options.onStderr ? { onStderr: options.onStderr } : {}),
  });
}

export function resolveRpcSpawnMode(platform: NodeJS.Platform = process.platform): {
  readonly detached: boolean;
  readonly windowsHide: boolean;
} {
  const windows = platform === "win32";
  return {
    detached: !windows,
    windowsHide: windows,
  };
}

export interface PiRpcSpawnCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function resolvePiRpcSpawnCommand(requestedPiBin: string, resolvedPiBin: string): PiRpcSpawnCommand {
  if (isWslPiExecutable(resolvedPiBin)) {
    return {
      command: resolvedPiBin,
      args: ["--exec", "bash", "-lic", 'exec pi "$@"', "alamelu-pi"],
    };
  }
  const nodeBin = inferNodeBinForGlobalNpmScript(resolvedPiBin);
  if (nodeBin && fs.existsSync(nodeBin)) {
    return { command: nodeBin, args: [resolvedPiBin] };
  }
  return { command: resolvedPiBin, args: [] };
}

export function isWslPiExecutable(value: string): boolean {
  return path.win32.basename(value).toLowerCase() === "wsl.exe";
}

export function buildWslPathEnvironment(
  env: NodeJS.ProcessEnv,
  pathVariables: readonly string[],
): NodeJS.ProcessEnv {
  const entries = (env.WSLENV ?? "").split(":").filter(Boolean);
  const existingNames = new Set(entries.map((entry) => entry.split("/")[0]?.toUpperCase()));
  for (const variable of pathVariables) {
    if (!existingNames.has(variable.toUpperCase())) {
      entries.push(`${variable}/p`);
    }
  }
  return { ...env, WSLENV: entries.join(":") };
}

function translateWindowsPathForWsl(wslExecutable: string, value: string): string {
  try {
    return execFileSync(wslExecutable, ["--exec", "wslpath", "-a", "-u", value], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error(
      `Could not translate Windows path for WSL: ${value}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function inferNodeBinForGlobalNpmScript(resolvedPiBin: string): string | undefined {
  const nodeModulesMarker = `${path.sep}lib${path.sep}node_modules${path.sep}`;
  const markerIndex = resolvedPiBin.indexOf(nodeModulesMarker);
  if (markerIndex <= 0) return undefined;
  return path.join(resolvedPiBin.slice(0, markerIndex), "bin", "node");
}

export function buildPiRpcPathEnv(requestedPiBin: string, resolvedPiBin: string, currentPath: string | undefined): string {
  const candidates = [path.dirname(requestedPiBin), path.dirname(resolvedPiBin)];
  const nodeModulesMarker = `${path.sep}lib${path.sep}node_modules${path.sep}`;
  const markerIndex = resolvedPiBin.indexOf(nodeModulesMarker);
  if (markerIndex > 0) {
    candidates.push(path.join(resolvedPiBin.slice(0, markerIndex), "bin"));
  }

  const existing = (currentPath ?? "").split(path.delimiter).filter(Boolean);
  const combined = [...candidates, ...existing].filter(Boolean);
  return [...new Set(combined)].join(path.delimiter);
}

function killProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals | undefined): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Best-effort cleanup; callers verify no live lab RPC process remains.
    }
  }
}
