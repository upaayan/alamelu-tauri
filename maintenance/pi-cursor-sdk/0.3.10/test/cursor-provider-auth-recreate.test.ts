import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTH_CURSOR_SDK_ERROR_MESSAGE,
	GENERIC_CURSOR_SDK_ERROR_MESSAGE,
	MISSING_CURSOR_API_KEY_MESSAGE,
	NETWORK_CURSOR_SDK_ERROR_MESSAGE,
	formatCursorSdkAbortMessage,
	formatCursorSdkRunFailureDetail,
	isRetryableStaleCursorAuthFailure,
} from "../src/cursor-provider-errors.js";
import { hasEmittedProgress, shouldAttemptAuthRecreate, teardownFailedAuthAttempt } from "../src/cursor-provider-live-run-drain.js";
import { cursorLiveRuns, releaseAllPendingCursorLiveRunsForTests } from "../src/cursor-provider-live-run-drain.js";
import { invalidateSessionAgent, resetSessionCursorAgent } from "../src/cursor-session-agent.js";
import { connectUnauthenticatedError, makeFakeAgent, makePartial } from "./auth-recreate-fixtures.js";

vi.mock("../src/cursor-session-agent.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/cursor-session-agent.js")>();
	return {
		...actual,
		invalidateSessionAgent: vi.fn(),
		resetSessionCursorAgent: vi.fn(async () => {}),
	};
});

describe("isRetryableStaleCursorAuthFailure", () => {
	it("retries ConnectError code 16 / unauthenticated", () => {
		expect(isRetryableStaleCursorAuthFailure(connectUnauthenticatedError())).toBe(true);
		const named = connectUnauthenticatedError();
		(named as Error & { code: string }).code = "unauthenticated";
		expect(isRetryableStaleCursorAuthFailure(named)).toBe(true);
	});

	it("retries in-band Cursor auth codes and formatted run-failure text", () => {
		for (const code of [
			"ERROR_NOT_LOGGED_IN",
			"ERROR_AGENT_REQUIRES_LOGIN",
			"ERROR_BAD_API_KEY",
			"ERROR_BAD_USER_API_KEY",
			"ERROR_INVALID_AUTH_ID",
		]) {
			expect(isRetryableStaleCursorAuthFailure(code)).toBe(true);
		}
		expect(isRetryableStaleCursorAuthFailure("Authentication error: not logged in")).toBe(true);
		expect(
			isRetryableStaleCursorAuthFailure(
				formatCursorSdkRunFailureDetail({
					id: "run-abcdef123456",
					status: "error",
					error: { code: "ERROR_NOT_LOGGED_IN", message: "Cursor SDK run failed" },
				}),
			),
		).toBe(true);
		expect(
			isRetryableStaleCursorAuthFailure("Provider returned error: Cursor SDK run failed · code ERROR_NOT_LOGGED_IN · run abcdef12…"),
		).toBe(true);
	});

	it("retries remapped AUTH and GENERIC messages", () => {
		expect(isRetryableStaleCursorAuthFailure(AUTH_CURSOR_SDK_ERROR_MESSAGE)).toBe(true);
		expect(isRetryableStaleCursorAuthFailure(GENERIC_CURSOR_SDK_ERROR_MESSAGE)).toBe(true);
	});

	it("does not retry missing key or network messages", () => {
		expect(isRetryableStaleCursorAuthFailure(MISSING_CURSOR_API_KEY_MESSAGE)).toBe(false);
		expect(isRetryableStaleCursorAuthFailure(NETWORK_CURSOR_SDK_ERROR_MESSAGE)).toBe(false);
	});

	it("does not retry abort / cancelled messages", () => {
		expect(isRetryableStaleCursorAuthFailure(formatCursorSdkAbortMessage("user_interrupt"))).toBe(false);
		expect(isRetryableStaleCursorAuthFailure(formatCursorSdkAbortMessage("sdk_cancelled"))).toBe(false);
		expect(isRetryableStaleCursorAuthFailure("aborted")).toBe(false);
		expect(isRetryableStaleCursorAuthFailure("cancelled")).toBe(false);
		const abort = new Error("operation was aborted");
		abort.name = "ConnectError";
		(abort as Error & { code: number }).code = 1;
		(abort as Error & { rawMessage: string }).rawMessage = "operation was aborted";
		Object.assign(abort, { cause: { name: "AbortError" } });
		abort.stack = "ConnectError\n    at @cursor/sdk\n    at @connectrpc/connect-node";
		expect(isRetryableStaleCursorAuthFailure(abort)).toBe(false);
	});
});

describe("hasEmittedProgress / shouldAttemptAuthRecreate", () => {
	it("treats the initial stopReason stop as no progress", () => {
		const partial = makePartial();
		expect(hasEmittedProgress(partial)).toBe(false);
		expect(
			shouldAttemptAuthRecreate({
				local: true,
				retried: false,
				aborted: false,
				errorOrMessage: AUTH_CURSOR_SDK_ERROR_MESSAGE,
				partial,
			}),
		).toBe(true);
	});

	it("blocks retry after thinking-only content, tools, or live emitted text", () => {
		expect(hasEmittedProgress(makePartial({ content: [{ type: "thinking", thinking: "hmm" }] }))).toBe(true);
		expect(hasEmittedProgress(makePartial(), { emittedText: "hello" } as never)).toBe(true);
		expect(hasEmittedProgress(makePartial(), { recordedToolDisplayIds: ["t1"] } as never)).toBe(true);
		expect(hasEmittedProgress(makePartial({ stopReason: "error" }))).toBe(true);
		expect(
			hasEmittedProgress(makePartial(), {
				textDeltas: ["raw-only"],
				emittedText: "",
				recordedToolDisplayIds: [],
			} as never),
		).toBe(false);
	});

	it("does not retry cloud, second attempt, abort, or after progress", () => {
		const partial = makePartial();
		expect(
			shouldAttemptAuthRecreate({
				local: false,
				retried: false,
				aborted: false,
				errorOrMessage: AUTH_CURSOR_SDK_ERROR_MESSAGE,
				partial,
			}),
		).toBe(false);
		expect(
			shouldAttemptAuthRecreate({
				local: true,
				retried: true,
				aborted: false,
				errorOrMessage: AUTH_CURSOR_SDK_ERROR_MESSAGE,
				partial,
			}),
		).toBe(false);
		expect(
			shouldAttemptAuthRecreate({
				local: true,
				retried: false,
				aborted: true,
				errorOrMessage: AUTH_CURSOR_SDK_ERROR_MESSAGE,
				partial,
			}),
		).toBe(false);
	});
});

describe("teardownFailedAuthAttempt", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await releaseAllPendingCursorLiveRunsForTests();
	});

	afterEach(async () => {
		await releaseAllPendingCursorLiveRunsForTests();
	});

	it("restores the filter, invalidates deadTransport, skips sdkRun.cancel, then resets", async () => {
		const order: string[] = [];
		const restore = vi.fn(() => {
			order.push("restore");
		});
		vi.mocked(invalidateSessionAgent).mockImplementation(() => {
			order.push("invalidate");
		});
		vi.mocked(resetSessionCursorAgent).mockImplementation(async () => {
			order.push("reset");
		});

		const run = cursorLiveRuns.start({
			id: `teardown-${Date.now()}`,
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
			sessionAgentScopeKey: "scope-teardown",
		});
		const cancel = vi.fn(async () => {
			order.push("cancel");
		});
		cursorLiveRuns.attachSdkRun(run, { cancel });

		await teardownFailedAuthAttempt(
			{
				restoreCursorSdkOutputFilter: restore,
				runtime: { kind: "live", liveRun: run, turnCoordinator: {} as never },
			} as never,
			undefined,
			"scope-teardown",
		);

		expect(restore).toHaveBeenCalledOnce();
		expect(invalidateSessionAgent).toHaveBeenCalledWith("scope-teardown", { deadTransport: true });
		expect(cancel).not.toHaveBeenCalled();
		expect(run.done).toBe(true);
		expect(run.disposed).toBe(true);
		expect(order).toEqual(["restore", "invalidate", "reset"]);
		expect(resetSessionCursorAgent).toHaveBeenCalledWith("scope-teardown");
	});

	it("does not throw when prepared and sendResult are undefined", async () => {
		await expect(teardownFailedAuthAttempt(undefined, undefined, "scope-missing")).resolves.toBeUndefined();
		expect(invalidateSessionAgent).toHaveBeenCalledWith("scope-missing", { deadTransport: true });
		expect(resetSessionCursorAgent).toHaveBeenCalledWith("scope-missing");
	});

	it("removes the abort listener when sendResult has a registration", async () => {
		const signal = new AbortController().signal;
		const listener = vi.fn();
		signal.addEventListener("abort", listener);
		await teardownFailedAuthAttempt(undefined, { send: {} as never, abortRegistration: { signal, listener } }, "scope-abort");
		signal.dispatchEvent(new Event("abort"));
		expect(listener).not.toHaveBeenCalled();
	});
});
