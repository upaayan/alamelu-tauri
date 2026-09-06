import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("renders a real tool call item that expands and collapses from the transcript", async () => {
  test.setTimeout(180_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("tool-call-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Tool test");

    const composer = window.getByTestId("composer");
    await composer.fill("Use your bash or shell tool to run `pwd` before answering. After the tool finishes, reply with exactly TOOL_OK.");
    await composer.press("Enter");

    await expect(window.getByTestId("transcript")).toContainText("TOOL_OK", { timeout: 150_000 });
    await expect
      .poll(async () => window.locator(".timeline-tool").count(), { timeout: 120_000 })
      .toBeGreaterThan(0);

    const toolItem = window.locator(".timeline-tool").first();
    const toolHeader = toolItem.locator(".timeline-tool__header");
    await expect(toolHeader).toHaveAttribute("aria-expanded", "false");

    await toolHeader.click();
    await expect(toolHeader).toHaveAttribute("aria-expanded", "true");
    await expect(toolItem.locator(".timeline-tool__body")).toBeVisible();
    await expect(toolItem.locator(".timeline-tool__pre")).not.toHaveText("");

    await toolHeader.click();
    await expect(toolHeader).toHaveAttribute("aria-expanded", "false");
    await expect(toolItem.locator(".timeline-tool__body")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});


test("final-only rendering follows real Pi message completion", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [await makeWorkspace("final-only-live")],
    testMode: "background", realAuthSourceDir: realAuth.sourceDir,
    envOverrides: { PI_GUI_BRAND: "alpi" }, recordVideoDir: testInfo.outputPath("video"),
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Final render live check");
    await window.evaluate(() => {
      const records: { activeId?: string; messages: { id: string; text: string }[] }[] = [];
      (window as any).__liveRenderRecords = records;
      window.piApp!.onSelectedTranscriptChanged((record) => {
        if (record) records.push({ activeId: record.activeAssistantMessageId, messages: record.transcript
          .filter((item) => item.kind === "message" && item.role === "assistant")
          .map((item: any) => ({ id: item.id, text: item.text })) });
      });
    });
    const composer = window.getByTestId("composer");
    await composer.fill("Rendering smoke test in this temporary workspace. First write a Markdown table with Name/Value columns and two rows explaining what you will check. Then use your bash tool to run pwd. Finally reply with heading FINAL_RENDER_OK, a three-item list, and a fenced TypeScript code block containing const answer = 42;. Do not modify any files.");
    await composer.press("Enter");
    await expect(window.locator(".timeline-item--assistant")).toContainText(["FINAL_RENDER_OK"], { timeout: 150_000 });
    await expect(window.locator(".message__preparing")).toHaveCount(0, { timeout: 30_000 });
    await expect(window.locator(".timeline-tool").first()).toBeVisible();
    await expect(window.locator(".timeline-item--assistant table").first()).toBeVisible();
    const records = await window.evaluate(() => (window as any).__liveRenderRecords) as { activeId?: string; messages: { id: string; text: string }[] }[];
    const activeIds = [...new Set(records.flatMap((record) => record.activeId ? [record.activeId] : []))];
    expect(activeIds.length).toBeGreaterThan(0);
    for (const id of activeIds) {
      const start = records.findIndex((record) => record.activeId === id);
      expect(records.slice(start + 1).some((record) => !record.activeId && record.messages.some((item) => item.id === id))).toBe(true);
    }
    await window.screenshot({ path: testInfo.outputPath("live-completed.png") });
    await writeFile(testInfo.outputPath("message-boundaries.json"), JSON.stringify(records, null, 2));
  } finally {
    await harness.close();
  }
});
