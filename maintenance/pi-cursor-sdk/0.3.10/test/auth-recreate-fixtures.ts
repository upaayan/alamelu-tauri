import type { AssistantMessage, AssistantMessageEventStream, Context, Model } from "@earendil-works/pi-ai/compat";
import type { Api } from "@earendil-works/pi-ai/compat";
import type { CursorLiveRun } from "../src/cursor-live-run-coordinator.js";
import type { CursorProviderTurnPrepareResult } from "../src/cursor-provider-turn-types.js";

export function connectUnauthenticatedError(message = "[unauthenticated] Error"): Error {
	const error = new Error(message) as Error & { code: number };
	error.name = "ConnectError";
	error.code = 16;
	return error;
}

export function makePartial(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "cursor",
		model: "cursor-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

export function makeModel(): Model<Api> {
	return {
		id: "cursor-test",
		name: "cursor-test",
		api: "openai-completions",
		provider: "cursor",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8000,
		maxTokens: 1000,
	} as Model<Api>;
}

export function makeContext(): Context {
	return { messages: [] };
}

export function makeStream(): { stream: AssistantMessageEventStream; events: unknown[] } {
	const events: unknown[] = [];
	const stream = {
		push(event: unknown) {
			events.push(event);
		},
		end() {},
	} as AssistantMessageEventStream;
	return { stream, events };
}

export function makeTurnCoordinator() {
	return {
		closeTraceBlock: () => {},
		flushText: () => {},
		discardIncompleteStartedToolCalls: () => {},
		lastSdkTurnUsage: undefined,
		handleDelta: () => {},
		handleStep: () => {},
	};
}

export function makeLifecycle() {
	return {
		trackRunCompletion: () => {},
		commitSend: () => {},
		abandon: async () => {},
		dispose: async () => {},
	};
}

export function makeFakeAgent() {
	return { agentId: "agent-1" };
}

export function makeFakeLiveRun(overrides: Partial<CursorLiveRun> = {}): CursorLiveRun {
	return {
		id: "run-1",
		agent: makeFakeAgent() as CursorLiveRun["agent"],
		sessionAgentScopeKey: "scope-1",
		accounting: {
			promptInputTokens: 0,
			promptInputTokensReported: false,
			consumedToolResultIds: new Set(),
			sdkTurnEnded: false,
		},
		pendingEvents: [],
		textDeltas: [],
		emittedText: "",
		recordedToolDisplayIds: [],
		done: false,
		cancelled: false,
		disposed: false,
		chainUserInputAfterCompletion: false,
		...overrides,
	};
}

export function makeLocalPrepared(
	kind: "direct" | "live",
	liveRun?: CursorLiveRun,
): CursorProviderTurnPrepareResult {
	return {
		runtimeTarget: "local",
		sessionAgentScopeKey: "scope-1",
		sessionAgentLease: {} as CursorProviderTurnPrepareResult extends { sessionAgentLease: infer T } ? T : never,
		localForce: { value: false, source: "default" },
		contextWindowAgentId: "agent-1",
		restoreCursorSdkOutputFilter: () => {},
		agent: makeFakeAgent() as CursorProviderTurnPrepareResult["agent"],
		cwd: "/tmp",
		payload: { text: "hi" },
		meta: {
			sendPlan: { mode: "bootstrap", resetAgent: false, reason: "test" },
			prompt: { text: "hi", images: [] },
			bootstrap: true,
			promptInputTokens: 0,
			useNativeToolReplay: false,
			bridgeEnabled: false,
			nativeReplayId: "replay-1",
			agentMode: "agent",
			modelSelection: { id: "cursor-test" },
		},
		textDeltas: [],
		lifecycle: makeLifecycle(),
		runtime:
			kind === "live"
				? { kind: "live", liveRun: liveRun ?? makeFakeLiveRun(), turnCoordinator: makeTurnCoordinator() }
				: { kind: "direct", turnCoordinator: makeTurnCoordinator() },
	} as unknown as CursorProviderTurnPrepareResult;
}

export function makeFinishedOutcome() {
	return {
		kind: "finished" as const,
		waitResult: { id: "run-1", status: "finished" as const },
		finalText: "ok",
		incompleteTools: { status: "finished" as const, assistantTextProduced: true, entries: [] },
		assistantTextProduced: true,
	};
}

export function makeAuthErrorOutcome(errorMessage: string) {
	return {
		kind: "error" as const,
		waitResult: { id: "run-1", status: "error" as const },
		incompleteTools: { status: "error" as const, assistantTextProduced: false, entries: [] },
		errorMessage,
	};
}

export function makeProcessErrorGuard() {
	return {
		containLocalTransportClosedPipe: (_fn: () => void) => {},
		dispose: () => {},
		suppressAbortErrors: () => {},
	};
}
