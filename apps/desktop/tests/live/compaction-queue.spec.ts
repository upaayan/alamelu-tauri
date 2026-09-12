import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getRealAuthConfig,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

/**
 * Real Pi child on a cheap model: manual compaction reports Pi's actual outcome through the
 * new event path, and Sends during a run are queued (display-only), consumed in order and the
 * run stays busy until Pi settles. Set PI_APP_TEST_RELEASE_DIR to drive a packaged candidate.
 */
test("manual compaction outcome and queued follow-ups against a real Pi child", async () => {
  test.setTimeout(240_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("compaction-queue-live");
  const launchOptions = {
    initialWorkspaces: [workspacePath],
    testMode: "background" as const,
    realAuthSourceDir: realAuth.sourceDir,
    envOverrides: { PI_GUI_BRAND: "alpi", PI_GUI_DRIVER: "rpc" },
  };
  const harness = process.env.PI_APP_TEST_RELEASE_DIR
    ? await launchPackagedDesktop(userDataDir, launchOptions)
    : await launchDesktop(userDataDir, launchOptions);

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Live compaction queue");
    const transcript = window.getByTestId("transcript");
    const header = window.locator(".chat-header__status");
    const hint = window.locator(".composer__hint");
    const model = process.env.ALPI_LIVE_MODEL ?? "deepseek:deepseek-flash";

    await window.evaluate((value) => window.piApp!.submitComposer(value), `/model ${model}`);
    await expect(transcript).toContainText("Model set to", { timeout: 30_000 });
    await window.evaluate((value) => window.piApp!.submitComposer(value), "/thinking off");
    await expect(transcript).toContainText("Thinking set to off", { timeout: 30_000 });

    // Manual compaction of an empty thread: Pi rejects it after emitting compaction_start/end.
    await window.evaluate((value) => window.piApp!.submitComposer(value), "/compact");
    await expect(transcript).toContainText("Compaction failed", { timeout: 60_000 });
    await expect(transcript).toContainText("Nothing to compact", { timeout: 5_000 });
    await expect(transcript).not.toContainText("Compacting conversation…");
    await expect(hint).toContainText("Enter to send", { timeout: 30_000 });

    const composer = window.getByTestId("composer");
    await composer.fill("Reply with exactly ONE_OK and nothing else.");
    await composer.press("Enter");
    await expect(header).toContainText("Working", { timeout: 30_000 });
    await composer.fill("Reply with exactly TWO_OK and nothing else.");
    await composer.press("Enter");
    await composer.fill("Reply with exactly THREE_OK and nothing else.");
    await composer.press("Enter");

    const chips = window.getByTestId("queued-composer-message");
    await expect(chips).toHaveCount(2, { timeout: 15_000 });
    await expect(chips.first()).toContainText("Queued");
    await expect(chips.first().getByRole("button")).toHaveCount(0);

    // Assert on assistant rows only: the user prompts echo the same markers immediately.
    const assistantRows = window.locator(".timeline-item--assistant");
    for (const marker of ["ONE_OK", "TWO_OK", "THREE_OK"]) {
      await expect(assistantRows.filter({ hasText: marker })).toHaveCount(1, { timeout: 120_000 });
    }
    await expect(chips).toHaveCount(0, { timeout: 30_000 });
    await expect(hint).toContainText("Enter to send", { timeout: 60_000 });
    await expect(transcript).toContainText("Worked for", { timeout: 10_000 });

    const replies = await assistantRows.allTextContents();
    const order = ["ONE_OK", "TWO_OK", "THREE_OK"].map((marker) => replies.findIndex((text) => text.includes(marker)));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
    expect(replies.filter((text) => /ONE_OK|TWO_OK|THREE_OK/.test(text))).toHaveLength(3);
  } finally {
    await harness.close();
  }
});
