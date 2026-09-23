import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CURSOR_SDK_ERROR_MESSAGE } from "../src/cursor-provider-errors.js";
import { CursorProviderTurnRunner } from "../src/cursor-provider-turn-runner.js";
import { prepareCursorProviderTurn, requireCursorApiKey, resolveCursorProviderTurnConfig } from "../src/cursor-provider-turn-prepare.js";
import { sendCursorProviderTurn } from "../src/cursor-provider-turn-send.js";
import { emitCursorLiveTurn } from "../src/cursor-provider-turn-emit.js";
import { awaitFinalizeCursorRunOutcome } from "../src/cursor-provider-turn-finalize.js";
import { drainExistingCursorLiveRunBeforeSend } from "../src/cursor-provider-live-run-drain.js";
import { CursorLiveRunAbortError } from "../src/cursor-live-run-coordinator.js";
import {
	connectUnauthenticatedError,
	makeAuthErrorOutcome,
	makeContext,
	makeFakeLiveRun,
	makeFinishedOutcome,
	makeLocalPrepared,
	makeModel,
	makePartial,
	makeProcessErrorGuard,
	makeStream,
} from "./auth-recreate-fixtures.js";

vi.mock("../src/cursor-provider-turn-prepare.js", () => ({
	prepareCursorProviderTurn: vi.fn(),
	requireCursorApiKey: vi.fn(() => "test-key"),
	resolveCursorProviderTurnConfig: vi.fn(() => ({ runtime: { value: "local" } })),
}));

vi.mock("../src/cursor-provider-turn-send.js", () => ({
	sendCursorProviderTurn: vi.fn(),
}));

vi.mock("../src/cursor-provider-turn-emit.js", () => ({
	emitCursorLiveTurn: vi.fn(async () => "stop"),
	discardIncompleteToolsFromPrepared: vi.fn(),
}));

vi.mock("../src/cursor-provider-turn-finalize.js", () => ({
	awaitFinalizeCursorRunOutcome: vi.fn(),
}));

vi.mock("../src/cursor-provider-live-run-drain.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/cursor-provider-live-run-drain.js")>();
	return {
		...actual,
		drainExistingCursorLiveRunBeforeSend: vi.fn(async () => "continue_send"),
		teardownFailedAuthAttempt: vi.fn(actual.teardownFailedAuthAttempt),
	};
});

vi.mock("../src/cursor-sdk-event-debug.js", () => ({
	CursorSdkEventDebugSink: { maybeCreate: () => undefined },
}));

import { teardownFailedAuthAttempt } from "../src/cursor-provider-live-run-drain.js";

const prepare = vi.mocked(prepareCursorProviderTurn);
const send = vi.mocked(sendCursorProviderTurn);
const emit = vi.mocked(emitCursorLiveTurn);
const finalize = vi.mocked(awaitFinalizeCursorRunOutcome);
const teardown = vi.mocked(teardownFailedAuthAttempt);

function fakeSendResult() {
	return {
		send: {
			run: { id: "run-1", result: undefined, error: undefined, wait: async () => ({ status: "finished" }) },
			cursorAgentMessageOffset: 0,
		},
		abortRegistration: undefined,
	};
}

function makeRunner(partial = makePartial(), signal?: AbortSignal) {
	const { stream, events } = makeStream();
	const runner = new CursorProviderTurnRunner({
		model: makeModel(),
		context: makeContext(),
		stream,
		partial,
		options: { apiKey: "test-key", signal },
		sdkEventDebugRef: {},
	});
	return { runner, stream, events, partial };
}

describe("CursorProviderTurnRunner auth recreate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireCursorApiKey).mockReturnValue("test-key");
		vi.mocked(resolveCursorProviderTurnConfig).mockReturnValue({ runtime: { value: "local" } } as never);
		vi.mocked(drainExistingCursorLiveRunBeforeSend).mockResolvedValue("continue_send");
		teardown.mockImplementation(async () => {});
	});

	it("retries once when the first send throws unauthenticated, then succeeds", async () => {
		const prepared1 = makeLocalPrepared("direct");
		const prepared2 = makeLocalPrepared("direct");
		prepare.mockResolvedValueOnce(prepared1).mockResolvedValueOnce(prepared2);
		send.mockRejectedValueOnce(connectUnauthenticatedError()).mockResolvedValueOnce(fakeSendResult() as never);
		finalize.mockResolvedValue({ outcome: makeFinishedOutcome(), displayOnlyTraceBlock: undefined } as never);
		const { runner, events } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(prepare.mock.calls[0]?.[0]?.forceCreate).toBe(false);
		expect(prepare.mock.calls[1]?.[0]?.forceCreate).toBe(true);
		expect(teardown).toHaveBeenCalledOnce();
		expect(teardown.mock.invocationCallOrder[0] ?? 0).toBeLessThan(prepare.mock.invocationCallOrder[1] ?? 0);
		expect(events.some((event) => (event as { type?: string }).type === "error")).toBe(false);
		expect(events.some((event) => (event as { type?: string }).type === "done")).toBe(true);
	});

	it("retries a direct wait() auth error outcome before applyTerminalEvent", async () => {
		prepare.mockResolvedValue(makeLocalPrepared("direct"));
		send.mockResolvedValue(fakeSendResult() as never);
		finalize
			.mockResolvedValueOnce({
				outcome: makeAuthErrorOutcome(AUTH_CURSOR_SDK_ERROR_MESSAGE),
				displayOnlyTraceBlock: undefined,
			} as never)
			.mockResolvedValueOnce({ outcome: makeFinishedOutcome(), displayOnlyTraceBlock: undefined } as never);
		const { runner, events } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(teardown).toHaveBeenCalledOnce();
		expect(events.filter((event) => (event as { type?: string }).type === "error")).toHaveLength(0);
		expect(events.some((event) => (event as { type?: string }).type === "done")).toBe(true);
	});

	it("retries a direct wait() throw via the loop try", async () => {
		prepare.mockResolvedValue(makeLocalPrepared("direct"));
		send.mockResolvedValue(fakeSendResult() as never);
		finalize.mockRejectedValueOnce(connectUnauthenticatedError()).mockResolvedValueOnce({
			outcome: makeFinishedOutcome(),
			displayOnlyTraceBlock: undefined,
		} as never);
		const { runner, events } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(teardown).toHaveBeenCalledOnce();
		expect(events.some((event) => (event as { type?: string }).type === "done")).toBe(true);
	});

	it("retries acquire/create throw once", async () => {
		prepare.mockRejectedValueOnce(connectUnauthenticatedError()).mockResolvedValueOnce(makeLocalPrepared("direct"));
		send.mockResolvedValue(fakeSendResult() as never);
		finalize.mockResolvedValue({ outcome: makeFinishedOutcome(), displayOnlyTraceBlock: undefined } as never);
		const { runner } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(prepare.mock.calls[1]?.[0]?.forceCreate).toBe(true);
		expect(teardown).toHaveBeenCalledOnce();
	});

	it("surfaces the existing auth error when the second attempt also fails", async () => {
		prepare.mockResolvedValue(makeLocalPrepared("direct"));
		send.mockResolvedValue(fakeSendResult() as never);
		finalize.mockResolvedValue({
			outcome: makeAuthErrorOutcome(AUTH_CURSOR_SDK_ERROR_MESSAGE),
			displayOnlyTraceBlock: undefined,
		} as never);
		const { runner, events } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(teardown).toHaveBeenCalledOnce();
		const errors = events.filter((event) => (event as { type?: string }).type === "error");
		expect(errors).toHaveLength(1);
	});

	it("does not recreate after thinking-only partial.content", async () => {
		const partial = makePartial({ content: [{ type: "thinking", thinking: "only thinking" }] });
		prepare.mockResolvedValue(makeLocalPrepared("direct"));
		send.mockResolvedValue(fakeSendResult() as never);
		finalize.mockResolvedValue({
			outcome: makeAuthErrorOutcome(AUTH_CURSOR_SDK_ERROR_MESSAGE),
			displayOnlyTraceBlock: undefined,
		} as never);
		const { runner } = makeRunner(partial);
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(teardown).not.toHaveBeenCalled();
	});

	it("does not recreate after hasEmittedProgress is true on send throw", async () => {
		const partial = makePartial({ content: [{ type: "text", text: "hello" }] });
		prepare.mockResolvedValue(makeLocalPrepared("direct"));
		send.mockRejectedValueOnce(connectUnauthenticatedError());
		const { runner, events } = makeRunner(partial);
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(teardown).not.toHaveBeenCalled();
		expect(events.some((event) => (event as { type?: string }).type === "error")).toBe(true);
	});

	it("retries live wait return via auth_recreate without a first error/done event", async () => {
		finalize.mockReturnValue(new Promise(() => {}));
		prepare.mockResolvedValue(makeLocalPrepared("live"));
		send.mockResolvedValue(fakeSendResult() as never);
		emit.mockResolvedValueOnce("auth_recreate").mockResolvedValueOnce("stop");
		const { runner, events } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(teardown).toHaveBeenCalledOnce();
		expect(events.filter((event) => (event as { type?: string }).type === "error")).toHaveLength(0);
	});

	it("throws on declined live auth_recreate when aborted", async () => {
		const controller = new AbortController();
		finalize.mockReturnValue(new Promise(() => {}));
		const liveRun = makeFakeLiveRun();
		prepare.mockResolvedValue(makeLocalPrepared("live", liveRun));
		send.mockResolvedValue(fakeSendResult() as never);
		emit.mockImplementation(async () => {
			controller.abort();
			return "auth_recreate";
		});
		const { runner, events } = makeRunner(makePartial(), controller.signal);
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(teardown).not.toHaveBeenCalled();
		expect(liveRun.disposed).toBe(true);
		expect(events.some((event) => (event as { reason?: string }).reason === "aborted")).toBe(true);
	});

	it("does not recreate on cloud runtime", async () => {
		vi.mocked(resolveCursorProviderTurnConfig).mockReturnValue({ runtime: { value: "cloud" } } as never);
		prepare.mockResolvedValue({
			...makeLocalPrepared("direct"),
			runtimeTarget: "cloud",
			sessionAgentScopeKey: undefined,
			sessionAgentLease: undefined,
		} as never);
		send.mockRejectedValueOnce(connectUnauthenticatedError());
		const { runner } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(teardown).not.toHaveBeenCalled();
	});

	it("does not retry an explicit cancel", async () => {
		prepare.mockRejectedValueOnce(new CursorLiveRunAbortError());
		const { runner, events } = makeRunner();
		await runner.run(makeProcessErrorGuard() as never);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(teardown).not.toHaveBeenCalled();
		expect(events.some((event) => (event as { reason?: string }).reason === "aborted")).toBe(true);
	});
});
