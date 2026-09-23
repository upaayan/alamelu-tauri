import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_CURSOR_SDK_ERROR_MESSAGE } from "../src/cursor-provider-errors.js";
import { CursorRunFinalizer } from "../src/cursor-provider-run-finalizer.js";
import { awaitFinalizeCursorRunOutcome } from "../src/cursor-provider-turn-finalize.js";
import { cursorLiveRuns, releaseAllPendingCursorLiveRunsForTests } from "../src/cursor-provider-live-run-drain.js";
import {
	connectUnauthenticatedError,
	makeAuthErrorOutcome,
	makeContext,
	makeFakeAgent,
	makeLocalPrepared,
	makeModel,
	makePartial,
	makeProcessErrorGuard,
	makeStream,
} from "./auth-recreate-fixtures.js";

vi.mock("../src/cursor-provider-turn-finalize.js", () => ({
	awaitFinalizeCursorRunOutcome: vi.fn(),
}));

const finalize = vi.mocked(awaitFinalizeCursorRunOutcome);

function makeFinalizer() {
	const { stream } = makeStream();
	return new CursorRunFinalizer({
		runnerParams: {
			model: makeModel(),
			context: makeContext(),
			stream,
			partial: makePartial(),
			options: { apiKey: "test-key" },
			sdkEventDebugRef: {},
		},
		sdkEventDebug: () => undefined,
		sdkProcessErrorGuard: makeProcessErrorGuard() as never,
		resolvedApiKey: () => "test-key",
		runtimeTarget: () => "local",
	});
}

describe("CursorRunFinalizer live auth recreate gates", () => {
	afterEach(async () => {
		await releaseAllPendingCursorLiveRunsForTests();
		vi.clearAllMocks();
	});

	it("marks authRecreate when wait() returns a retryable auth error and allowAuthRecreate is true", async () => {
		const run = cursorLiveRuns.start({
			id: `finalizer-return-${Date.now()}`,
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
		});
		finalize.mockResolvedValue({
			outcome: makeAuthErrorOutcome(AUTH_CURSOR_SDK_ERROR_MESSAGE),
			displayOnlyTraceBlock: undefined,
		} as never);
		const completion = makeFinalizer().startLiveRunCompletion({
			send: { run: { id: "run-1", result: undefined, error: undefined } as never, cursorAgentMessageOffset: 0 },
			prepared: makeLocalPrepared("live", run) as never,
			modelId: "cursor-test",
			discardIncompleteTools: () => {},
			allowAuthRecreate: true,
			hasEmittedProgress: () => false,
		});
		await completion.waitCompletion;
		expect(run.authRecreate).toBe(true);
		expect(run.done).toBe(false);
		expect(run.errorMessage).toBeUndefined();
	});

	it("marks authRecreate when wait() throws ConnectError 16", async () => {
		const run = cursorLiveRuns.start({
			id: `finalizer-throw-${Date.now()}`,
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
		});
		finalize.mockRejectedValue(connectUnauthenticatedError());
		const completion = makeFinalizer().startLiveRunCompletion({
			send: { run: { id: "run-1", result: undefined, error: undefined } as never, cursorAgentMessageOffset: 0 },
			prepared: makeLocalPrepared("live", run) as never,
			modelId: "cursor-test",
			discardIncompleteTools: () => {},
			allowAuthRecreate: true,
			hasEmittedProgress: () => false,
		});
		await completion.waitCompletion;
		expect(run.authRecreate).toBe(true);
		expect(run.done).toBe(false);
	});

	it("uses markError on attempt 2 when allowAuthRecreate is false", async () => {
		const run = cursorLiveRuns.start({
			id: `finalizer-second-${Date.now()}`,
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
		});
		finalize.mockResolvedValue({
			outcome: makeAuthErrorOutcome(AUTH_CURSOR_SDK_ERROR_MESSAGE),
			displayOnlyTraceBlock: undefined,
		} as never);
		const completion = makeFinalizer().startLiveRunCompletion({
			send: { run: { id: "run-1", result: undefined, error: undefined } as never, cursorAgentMessageOffset: 0 },
			prepared: makeLocalPrepared("live", run) as never,
			modelId: "cursor-test",
			discardIncompleteTools: () => {},
			allowAuthRecreate: false,
			hasEmittedProgress: () => false,
		});
		await completion.waitCompletion;
		expect(run.authRecreate).toBeUndefined();
		expect(run.done).toBe(true);
		expect(run.errorMessage).toBe(AUTH_CURSOR_SDK_ERROR_MESSAGE);
	});
});
