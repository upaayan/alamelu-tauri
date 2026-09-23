import { beforeEach, describe, expect, it } from "vitest";
import type { ModelListItem } from "@cursor/sdk";
import { buildCursorModelSelection, getCursorModelMetadata, __testUtils } from "../src/model-discovery.js";

// Alamelu Mac local fix (c): unqualified IDs for context-variant models and `reasoning_effort` mapping.
function contextModel(id: string, contexts: string[]): ModelListItem {
	return {
		id,
		displayName: id,
		parameters: [{ id: "context", displayName: "Context", values: contexts.map((value) => ({ value })) }],
		variants: [{ params: [{ id: "context", value: contexts[0] }], displayName: id, isDefault: true }],
	} as ModelListItem;
}

const reasoningEffortModel = {
	id: "re-model",
	displayName: "re-model",
	parameters: [
		{
			id: "reasoning_effort",
			displayName: "Reasoning effort",
			values: [{ value: "low" }, { value: "medium" }, { value: "high" }],
		},
	],
	variants: [{ params: [{ id: "reasoning_effort", value: "medium" }], displayName: "re-model", isDefault: true }],
} as ModelListItem;

let ids: string[] = [];

beforeEach(() => {
	ids = __testUtils
		.registerModelItems([contextModel("ctx-256", ["1m", "256k"]), contextModel("ctx-first", ["1m", "300k"]), reasoningEffortModel])
		.map((config) => config.id);
});

describe("Mac local fix (c): Cursor model variants", () => {
	it("adds the unqualified ID after the context-qualified IDs, selecting the standard 256k context", () => {
		expect(ids.filter((id) => id.startsWith("ctx-256"))).toEqual(["ctx-256@1m", "ctx-256@256k", "ctx-256"]);
		expect(getCursorModelMetadata("ctx-256")?.context).toBeUndefined();
		expect(buildCursorModelSelection("ctx-256", "medium")).toEqual({ id: "ctx-256", params: [{ id: "context", value: "256k" }] });
		expect(buildCursorModelSelection("ctx-256@1m", "medium")).toEqual({ id: "ctx-256", params: [{ id: "context", value: "1m" }] });
	});

	it("falls back to the first context value when 256k is not offered", () => {
		expect(ids.filter((id) => id.startsWith("ctx-first"))).toEqual(["ctx-first@1m", "ctx-first@300k", "ctx-first"]);
		expect(buildCursorModelSelection("ctx-first", "medium")).toEqual({ id: "ctx-first", params: [{ id: "context", value: "1m" }] });
	});
});

describe("Mac local fix (c): reasoning_effort mapping", () => {
	it("treats reasoning_effort as the effort parameter for thinking levels", () => {
		const metadata = getCursorModelMetadata("re-model");
		expect(metadata?.supportsReasoning).toBe(true);
		expect(metadata?.parameterIds.effort).toBe(true);
		expect(metadata?.thinkingLevelMap?.high).toBe("high");
	});

	it("sends the chosen effort under reasoning_effort, never effort", () => {
		const selection = buildCursorModelSelection("re-model", "high");
		expect(selection.params).toContainEqual({ id: "reasoning_effort", value: "high" });
		expect(selection.params?.some((param) => param.id === "effort")).toBe(false);
	});
});
