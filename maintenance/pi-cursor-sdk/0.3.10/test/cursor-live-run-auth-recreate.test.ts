import { afterEach, describe, expect, it } from "vitest";
import { createCursorLiveRunCoordinator } from "../src/cursor-live-run-coordinator.js";
import {
	cursorLiveRuns,
	drainCursorLiveRunTurn,
	drainExistingCursorLiveRunBeforeSend,
	releaseAllPendingCursorLiveRunsForTests,
} from "../src/cursor-provider-live-run-drain.js";
import { makeContext, makeFakeAgent, makeModel, makePartial, makeStream } from "./auth-recreate-fixtures.js";

describe("markAuthRecreate / drain auth_recreate", () => {
	afterEach(async () => {
		await releaseAllPendingCursorLiveRunsForTests();
	});

	it("unblocks waitForProgress without setting done or errorMessage", async () => {
		const coordinator = createCursorLiveRunCoordinator({
			getIdleDisposeMs: () => 60_000,
			deleteNativeToolDisplay: () => {},
			abandonSessionAgent: async () => {},
		});
		const run = coordinator.start({
			id: "wait-auth",
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
			sessionAgentScopeKey: "scope-wait",
		});
		const waited = coordinator.waitForProgress(run);
		let resolved = false;
		void waited.then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);
		coordinator.markAuthRecreate(run);
		await waited;
		expect(resolved).toBe(true);
		expect(run.done).toBe(false);
		expect(run.errorMessage).toBeUndefined();
		expect(run.authRecreate).toBe(true);
		expect(coordinator.isReady(run)).toBe(true);
		await coordinator.release(run);
	});

	it("does not mark a disposed run", () => {
		const coordinator = createCursorLiveRunCoordinator({
			getIdleDisposeMs: () => 60_000,
			deleteNativeToolDisplay: () => {},
			abandonSessionAgent: async () => {},
		});
		const run = coordinator.start({
			id: "disposed-auth",
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
		});
		run.disposed = true;
		coordinator.markAuthRecreate(run);
		expect(run.authRecreate).toBeUndefined();
	});

	it("returns auth_recreate without flushing queued textDeltas or pushing done/error", async () => {
		const run = cursorLiveRuns.start({
			id: `drain-auth-${Date.now()}`,
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
			textDeltas: ["secret-delta"],
		});
		cursorLiveRuns.queueEvent(run, { type: "text-delta", text: "queued" });
		cursorLiveRuns.markAuthRecreate(run);
		const { stream, events } = makeStream();
		const partial = makePartial();
		const outcome = await drainCursorLiveRunTurn(stream, partial, makeModel(), makeContext(), run, 0, {
			mode: "emit",
		});
		expect(outcome).toBe("auth_recreate");
		expect(events).toEqual([]);
		expect(partial.stopReason).toBe("stop");
		expect(partial.content).toEqual([]);
		expect(run.textDeltas).toEqual(["secret-delta"]);
		expect(run.disposed).toBe(false);
		await cursorLiveRuns.release(run);
	});

	it("maps a leftover authRecreate run at pre-send to continue_send and releases it", async () => {
		const run = cursorLiveRuns.start({
			id: `leftover-auth-${Date.now()}`,
			agent: makeFakeAgent() as never,
			promptInputTokens: 0,
		});
		cursorLiveRuns.markAuthRecreate(run);
		const { stream, events } = makeStream();
		const outcome = await drainExistingCursorLiveRunBeforeSend(stream, makePartial(), makeModel(), makeContext());
		expect(outcome).toBe("continue_send");
		expect(events).toEqual([]);
		expect(run.disposed).toBe(true);
	});
});
