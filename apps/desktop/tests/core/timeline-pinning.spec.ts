import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  commitAllInGitRepo,
  emitTestSessionEvent,
  desktopShortcut,
  getDesktopState,
  getTimelineScrollMetrics,
  initGitRepo,
  jumpTimelineToBottom,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  scrollTimelineAwayFromBottom,
  selectSession,
  seedTranscriptMessages,
  streamAssistantDeltas,
} from "../helpers/electron-app";

const multilineDraft = [
  "line 1",
  "line 2",
  "line 3",
  "line 4",
  "line 5",
  "line 6",
].join("\n");

async function expectRowVisibleAboveComposer(window: Page, row: Locator, composerShell: Locator): Promise<void> {
  await expect.poll(async () => {
    const [rowBox, composerBox, paneBox] = await Promise.all([
      row.boundingBox(),
      composerShell.boundingBox(),
      window.getByTestId("timeline-pane").boundingBox(),
    ]);
    if (!rowBox || !composerBox || !paneBox) {
      return { gapToComposer: -999, fullyVisibleWithinPane: false };
    }
    const rowTop = rowBox.y;
    const rowBottom = rowBox.y + rowBox.height;
    const paneTop = paneBox.y;
    const paneBottom = paneBox.y + paneBox.height;
    return {
      gapToComposer: composerBox.y - rowBottom,
      fullyVisibleWithinPane: rowTop >= paneTop - 1 && rowBottom <= paneBottom + 1,
    };
  }).toMatchObject({
    gapToComposer: expect.any(Number),
    fullyVisibleWithinPane: true,
  });
  await expect.poll(async () => {
    const [rowBox, composerBox] = await Promise.all([row.boundingBox(), composerShell.boundingBox()]);
    if (!rowBox || !composerBox) {
      return -999;
    }
    return composerBox.y - (rowBox.y + rowBox.height);
  }).toBeGreaterThanOrEqual(-1);
}

interface TimelineStabilitySample {
  readonly virtualized: boolean;
  readonly visibleItemCount: number;
  readonly renderedTextLength: number;
  readonly remainingFromBottom: number;
  readonly sentinelVisible: boolean;
}

async function sampleTimelineStability(window: Page, sentinelRow: Locator): Promise<TimelineStabilitySample> {
  const [rowBox, paneBox, renderMetrics, scrollMetrics] = await Promise.all([
    sentinelRow.boundingBox(),
    window.getByTestId("timeline-pane").boundingBox(),
    window.evaluate(() => {
      const transcript = document.querySelector<HTMLElement>("[data-testid='transcript']");
      return {
        virtualized: Boolean(document.querySelector(".timeline--virtualized")),
        visibleItemCount: document.querySelectorAll(".timeline-item").length,
        renderedTextLength: (transcript?.textContent ?? "").trim().length,
      };
    }),
    getTimelineScrollMetrics(window),
  ]);

  const sentinelVisible = Boolean(
    rowBox &&
      paneBox &&
      rowBox.y >= paneBox.y - 1 &&
      rowBox.y + rowBox.height <= paneBox.y + paneBox.height + 1,
  );

  return {
    ...renderMetrics,
    remainingFromBottom: scrollMetrics.remainingFromBottom,
    sentinelVisible,
  };
}

async function sampleTimelineCollapseWindow(
  window: Page,
  frameCount = 24,
): Promise<Pick<TimelineStabilitySample, "visibleItemCount" | "renderedTextLength">> {
  return window.evaluate(async (targetFrameCount) => {
    const samples: Array<{ visibleItemCount: number; renderedTextLength: number }> = [];
    await new Promise<void>((resolve) => {
      let remainingFrames = targetFrameCount;
      const captureFrame = () => {
        const transcript = document.querySelector<HTMLElement>("[data-testid='transcript']");
        samples.push({
          visibleItemCount: document.querySelectorAll(".timeline-item").length,
          renderedTextLength: (transcript?.textContent ?? "").trim().length,
        });
        remainingFrames -= 1;
        if (remainingFrames <= 0) {
          resolve();
          return;
        }
        window.requestAnimationFrame(captureFrame);
      };

      window.requestAnimationFrame(captureFrame);
    });

    return samples.reduce(
      (minimums, sample) => ({
        visibleItemCount: Math.min(minimums.visibleItemCount, sample.visibleItemCount),
        renderedTextLength: Math.min(minimums.renderedTextLength, sample.renderedTextLength),
      }),
      {
        visibleItemCount: Number.POSITIVE_INFINITY,
        renderedTextLength: Number.POSITIVE_INFINITY,
      },
    );
  }, frameCount);
}

async function waitForStableVirtualizedBottom(
  window: Page,
  sentinelRow: Locator,
): Promise<Pick<TimelineStabilitySample, "visibleItemCount" | "renderedTextLength">> {
  let consecutiveStableSamples = 0;
  let baselineSample: TimelineStabilitySample | null = null;

  for (let index = 0; index < 150; index += 1) {
    const sample = await sampleTimelineStability(window, sentinelRow);
    if (sample.virtualized && sample.remainingFromBottom <= 16 && sample.sentinelVisible) {
      consecutiveStableSamples += 1;
      baselineSample = sample;
      if (consecutiveStableSamples >= 5 && baselineSample) {
        return {
          visibleItemCount: baselineSample.visibleItemCount,
          renderedTextLength: baselineSample.renderedTextLength,
        };
      }
    } else {
      consecutiveStableSamples = 0;
      baselineSample = null;
    }
    await window.waitForTimeout(100);
  }

  throw new Error("Timeline never reached a stable virtualized bottom state.");
}

async function expectStableTimelineWindow(
  window: Page,
  sentinelRow: Locator,
  baseline: Pick<TimelineStabilitySample, "visibleItemCount" | "renderedTextLength">,
): Promise<void> {
  const minimumVisibleItems = Math.max(1, Math.floor(baseline.visibleItemCount * 0.6));
  const minimumRenderedTextLength = Math.max(1, Math.floor(baseline.renderedTextLength * 0.6));

  for (let index = 0; index < 8; index += 1) {
    const sample = await sampleTimelineStability(window, sentinelRow);
    expect(sample.virtualized).toBe(true);
    expect(sample.sentinelVisible).toBe(true);
    expect(sample.remainingFromBottom).toBeLessThanOrEqual(16);
    expect(sample.visibleItemCount).toBeGreaterThanOrEqual(minimumVisibleItems);
    expect(sample.renderedTextLength).toBeGreaterThanOrEqual(minimumRenderedTextLength);
    await window.waitForTimeout(100);
  }
}

async function expectNoTimelineCollapseWindow(
  window: Page,
  baseline: Pick<TimelineStabilitySample, "visibleItemCount" | "renderedTextLength">,
): Promise<void> {
  const minimumVisibleItems = Math.max(1, Math.floor(baseline.visibleItemCount * 0.6));
  const minimumRenderedTextLength = Math.max(1, Math.floor(baseline.renderedTextLength * 0.6));

  const sample = await sampleTimelineCollapseWindow(window);
  expect(sample.visibleItemCount).toBeGreaterThanOrEqual(minimumVisibleItems);
  expect(sample.renderedTextLength).toBeGreaterThanOrEqual(minimumRenderedTextLength);
}

async function setDesktopActiveView(window: Page, view: "threads" | "settings"): Promise<void> {
  await window.evaluate(async (nextView) => {
    const app = window.piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }
    await app.setActiveView(nextView);
  }, view);
}

async function createTimelineSession(window: Parameters<typeof getDesktopState>[0], title: string): Promise<void> {
  const state = await getDesktopState(window);
  const workspaceId = state.selectedWorkspaceId || state.workspaces[0]?.id;
  if (!workspaceId) {
    throw new Error("No selected workspace available for timeline pinning test");
  }

  await window.evaluate(async ({ targetTitle, targetWorkspaceId }) => {
    const app = window.piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }

    const beforeState = await app.getState();
    const beforeWorkspace = beforeState.workspaces.find((workspace) => workspace.id === targetWorkspaceId);
    const beforeIds = new Set(beforeWorkspace?.sessions.map((session) => session.id) ?? []);
    const nextState = await app.createSession({ workspaceId: targetWorkspaceId, title: targetTitle });
    const nextWorkspace = nextState.workspaces.find((workspace) => workspace.id === targetWorkspaceId);
    const session = nextWorkspace?.sessions.find((entry) => !beforeIds.has(entry.id) && entry.title === targetTitle)
      ?? nextWorkspace?.sessions.find((entry) => entry.title === targetTitle);
    if (!session) {
      throw new Error(`Session not found after createSession: ${targetTitle}`);
    }

    await app.selectSession({ workspaceId: targetWorkspaceId, sessionId: session.id });
    await app.setActiveView("threads");
  }, { targetTitle: title, targetWorkspaceId: workspaceId });

  await expect.poll(async () => {
    const nextState = await getDesktopState(window);
    return {
      activeView: nextState.activeView,
      selectedSessionId: nextState.selectedSessionId,
    };
  }).toMatchObject({ activeView: "threads" });
  await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
}

test("keeps the latest assistant content visible when the composer grows at the bottom of a thread", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-bottom");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, "README.md"), "# timeline pinning\nupdated\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    const window = await harness.firstWindow();
    await createTimelineSession(window, "Bottom pinning session");

    const finalMarker = "PIN_FINAL_ROW";
    const finalText = `${finalMarker} ${"visible above composer with width reflow ".repeat(10)}`;
    const { messages } = await seedTranscriptMessages(harness, window, {
      count: 14,
      textFactory: (index) => (index === 13 ? finalText : `Pinned seed row ${index} `.repeat(8)),
    });
    await expect(window.getByTestId("transcript")).toContainText(messages.at(-1) ?? finalText);

    await jumpTimelineToBottom(window);
    await expect.poll(() => getTimelineScrollMetrics(window)).toMatchObject({
      remainingFromBottom: expect.any(Number),
    });
    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return {
        overflowed: metrics.scrollHeight > metrics.clientHeight + 32,
        scrolled: metrics.scrollTop > 0,
        remaining: metrics.remainingFromBottom,
      };
    }).toMatchObject({
      overflowed: true,
      scrolled: true,
      remaining: expect.any(Number),
    });
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const composer = window.getByTestId("composer");
    const composerShell = window.locator(".composer");
    const finalRow = window.locator(".timeline-item--assistant", { hasText: finalMarker });

    const beforeComposerHeight = (await composerShell.boundingBox())?.height ?? 0;
    expect(beforeComposerHeight).toBeGreaterThan(0);

    await composer.fill(multilineDraft);
    await expect(composer).toHaveValue(multilineDraft);
    await expect
      .poll(async () => ((await composerShell.boundingBox())?.height ?? 0) - beforeComposerHeight)
      .toBeGreaterThan(40);

    await expectRowVisibleAboveComposer(window, finalRow, composerShell);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const diffPanel = window.locator(".diff-panel");
    await window.keyboard.press(desktopShortcut("D"));
    await expect(diffPanel).toBeVisible();
    await expect(diffPanel.locator(".diff-panel__file-name")).toContainText("README.md");
    await expect(window.getByTestId("timeline-pane")).toBeVisible();
    await expect(composerShell).toBeVisible();
    await expectRowVisibleAboveComposer(window, finalRow, composerShell);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(32);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("restores bottom pinning after leaving and returning to the thread surface", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-remount");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    const window = await harness.firstWindow();
    await createTimelineSession(window, "Remount pinning session");

    const finalMarker = "REMOUNT_FINAL_ROW";
    const finalText = `${finalMarker} ${"should remain visible after view remount ".repeat(4)}`;
    await seedTranscriptMessages(harness, window, {
      count: 18,
      textFactory: (index) => (index === 17 ? finalText : `Remount seed row ${index} `.repeat(8)),
    });
    await expect(window.getByTestId("transcript")).toContainText(finalMarker);

    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const composer = window.getByTestId("composer");
    const composerShell = window.locator(".composer");
    const finalRow = window.locator(".timeline-item--assistant", { hasText: finalMarker });
    await composer.fill(multilineDraft);
    await expect(composer).toHaveValue(multilineDraft);
    await expectRowVisibleAboveComposer(window, finalRow, composerShell);

    await setDesktopActiveView(window, "settings");
    await expect.poll(async () => (await getDesktopState(window)).activeView).toBe("settings");
    await expect(window.getByTestId("timeline-pane")).toHaveCount(0);
    await expect(window.getByTestId("composer")).toHaveCount(0);

    await setDesktopActiveView(window, "threads");
    await expect.poll(async () => (await getDesktopState(window)).activeView).toBe("threads");
    await expect(window.getByTestId("timeline-pane")).toBeVisible();
    await expect(window.getByTestId("composer")).toBeVisible();
    await expectRowVisibleAboveComposer(window, finalRow, composerShell);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("restores the true bottom when reopening a virtualized thread with oversized late rows", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-virtualized-reopen");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    let window = await harness.firstWindow();
    const targetTitle = "Virtualized restore target";
    await createTimelineSession(window, targetTitle);

    const finalMarker = "VIRTUALIZED_RESTORE_FINAL_ROW";
    const oversizedLateRow = `VIRTUALIZED_RESTORE_OVERSIZED ${"wrapped restore content ".repeat(420)}`;
    await seedTranscriptMessages(harness, window, {
      count: 110,
      textFactory: (index) => {
        if (index === 94 || index === 103) {
          return oversizedLateRow;
        }
        if (index === 109) {
          return `${finalMarker} ${"should stay visible at the real bottom ".repeat(8)}`;
        }
        return `Virtualized restore row ${index} `.repeat(8);
      },
    });

    await harness.close();

    harness = await launchDesktop(userDataDir, { testMode: "background", envOverrides: { PI_GUI_BRAND: "alpi" } });
    window = await harness.firstWindow();
    await expect(window.locator(".topbar__session")).toHaveText(targetTitle);
    await expect(window.locator(".timeline-item--assistant", { hasText: finalMarker })).toBeVisible();
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    await createTimelineSession(window, "Neighbor session");
    await expect(window.locator(".topbar__session")).toHaveText("Neighbor session");

    const collapsedWorkspace = window.locator(".workspace-row--active .workspace-row__select:has([data-collapsed])");
    if (await collapsedWorkspace.count()) await collapsedWorkspace.click();
    await selectSession(window, targetTitle);
    const finalRow = window.locator(".timeline-item--assistant", { hasText: finalMarker });
    await expect(finalRow).toBeVisible();
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);
  } finally {
    await harness.close();
  }
});

test("keeps a virtualized thread off-bottom after switching sessions", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-virtualized-mid-history-reopen");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    let window = await harness.firstWindow();
    const targetTitle = "Virtualized mid-history restore target";
    await createTimelineSession(window, targetTitle);

    const finalMarker = "VIRTUALIZED_MIDDLE_RESTORE_FINAL_ROW";
    await seedTranscriptMessages(harness, window, {
      count: 110,
      textFactory: (index) => {
        if (index === 109) {
          return `${finalMarker} ${"should stay offscreen when reopening mid-history ".repeat(6)}`;
        }
        return `Virtualized mid-history row ${index} `.repeat(8);
      },
    });

    await scrollTimelineAwayFromBottom(window, 1_600);
    const preReopenMetrics = await getTimelineScrollMetrics(window);
    expect(preReopenMetrics.remainingFromBottom).toBeGreaterThan(500);

    await createTimelineSession(window, "Neighbor session");
    await expect(window.locator(".topbar__session")).toHaveText("Neighbor session");

    const collapsedWorkspace = window.locator(".workspace-row--active .workspace-row__select:has([data-collapsed])");
    if (await collapsedWorkspace.count()) await collapsedWorkspace.click();
    await selectSession(window, targetTitle);
    await expect(window.locator(".topbar__session")).toHaveText(targetTitle);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeGreaterThan(500);
  } finally {
    await harness.close();
  }
});

test("keeps a reopened virtualized long transcript stable", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-virtualized-stable-reopen");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    let window = await harness.firstWindow();
    const targetTitle = "Virtualized stable reopen target";
    await createTimelineSession(window, targetTitle);

    const finalMarker = "VIRTUALIZED_STABLE_FINAL_ROW";
    await seedTranscriptMessages(harness, window, {
      count: 110,
      textFactory: (index) =>
        index === 109
          ? `${finalMarker} ${"should remain visible after reopen ".repeat(6)}`
          : `Virtualized stable row ${index} `.repeat(8),
    });
    const finalRow = window.locator(".timeline-item--assistant", { hasText: finalMarker });
    const preReopenBaseline = await waitForStableVirtualizedBottom(window, finalRow);

    await harness.close();

    harness = await launchDesktop(userDataDir, { testMode: "background", envOverrides: { PI_GUI_BRAND: "alpi" } });
    window = await harness.firstWindow();
    await expect(window.locator(".topbar__session")).toHaveText(targetTitle);
    const reopenedFinalRow = window.locator(".timeline-item--assistant", { hasText: finalMarker });

    await expectNoTimelineCollapseWindow(window, preReopenBaseline);
    const baseline = await waitForStableVirtualizedBottom(window, reopenedFinalRow);
    await expectStableTimelineWindow(window, reopenedFinalRow, baseline);

    const composer = window.getByTestId("composer");
    await composer.fill(multilineDraft);
    await expect(composer).toHaveValue(multilineDraft);
    await expectNoTimelineCollapseWindow(window, baseline);
    const postComposerBaseline = await waitForStableVirtualizedBottom(window, reopenedFinalRow);
    await expectStableTimelineWindow(window, reopenedFinalRow, postComposerBaseline);

    // This is a cached UI transcript fixture, not a persisted Pi runtime session.
    // Complete the message without asking a nonexistent runtime to complete the run.
    const pinnedStream = await streamAssistantDeltas(harness, window, [
      "VIRTUALIZED_REOPEN_STREAM_A ",
      "VIRTUALIZED_REOPEN_STREAM_B ",
      "VIRTUALIZED_REOPEN_STREAM_C",
    ], "reopened-message", false);
    const streamedRow = window.locator(".timeline-item--assistant", { hasText: pinnedStream.fullText });
    await expect(streamedRow).toBeVisible();
    const streamedBaseline = await waitForStableVirtualizedBottom(window, streamedRow);
    await expectStableTimelineWindow(window, streamedRow, streamedBaseline);
  } finally {
    await harness.close();
  }
});

test("keeps the mid-thread viewport stable when the composer grows away from the bottom", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-middle");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, "README.md"), "# mid-thread pinning\nupdated\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    const window = await harness.firstWindow();
    await createTimelineSession(window, "Mid-thread pinning session");

    const sentinelMarker = "MID_SENTINEL_ROW";
    const sentinelText = `${sentinelMarker} ${"should stay put during width reflow ".repeat(10)}`;
    const finalText = `MID_FINAL_ROW ${"at thread bottom with wrapping text ".repeat(10)}`;
    await seedTranscriptMessages(harness, window, {
      count: 16,
      textFactory: (index) => {
        if (index === 5) return sentinelText;
        if (index === 15) return finalText;
        return `Mid-thread seed row ${index} `.repeat(8);
      },
    });
    await expect(window.getByTestId("transcript")).toContainText(finalText);

    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    await scrollTimelineAwayFromBottom(window, 220);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeGreaterThan(100);

    const composer = window.getByTestId("composer");
    const composerShell = window.locator(".composer");
    const sentinelRow = window.locator(".timeline-item--assistant", { hasText: sentinelMarker });
    await expect(sentinelRow).toBeVisible();

    const beforeComposerHeight = (await composerShell.boundingBox())?.height ?? 0;
    const beforeSentinelY = (await sentinelRow.boundingBox())?.y ?? 0;
    const beforeScrollTop = (await getTimelineScrollMetrics(window)).scrollTop;

    await composer.fill(multilineDraft);
    await expect(composer).toHaveValue(multilineDraft);
    await expect
      .poll(async () => ((await composerShell.boundingBox())?.height ?? 0) - beforeComposerHeight)
      .toBeGreaterThan(40);

    await expect.poll(async () => {
      const rowBox = await sentinelRow.boundingBox();
      return rowBox ? Math.abs(rowBox.y - beforeSentinelY) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(12);
    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return Math.abs(metrics.scrollTop - beforeScrollTop);
    }).toBeLessThanOrEqual(12);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(0);

    const diffPanel = window.locator(".diff-panel");
    const beforeDiffSentinelY = (await sentinelRow.boundingBox())?.y ?? 0;
    const beforeDiffScrollTop = (await getTimelineScrollMetrics(window)).scrollTop;
    await window.keyboard.press(desktopShortcut("D"));
    await expect(diffPanel).toBeVisible();
    await expect(diffPanel.locator(".diff-panel__file-name")).toContainText("README.md");
    await expect.poll(async () => {
      const rowBox = await sentinelRow.boundingBox();
      return rowBox ? Math.abs(rowBox.y - beforeDiffSentinelY) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(12);
    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return Math.abs(metrics.scrollTop - beforeDiffScrollTop);
    }).toBeLessThanOrEqual(12);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("keeps transcript pinning semantics while assistant deltas stream into the same row", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-streaming");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
  });

  try {
    const window = await harness.firstWindow();
    await createTimelineSession(window, "Streaming pinning session");

    const finalSeedMarker = "Streaming seed row 23";
    await seedTranscriptMessages(harness, window, {
      count: 24,
      textFactory: (index) => `Streaming seed row ${index} `.repeat(8),
    });
    await expect(window.getByTestId("transcript")).toContainText(finalSeedMarker);

    await jumpTimelineToBottom(window);
    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return {
        overflowed: metrics.scrollHeight > metrics.clientHeight + 32,
        scrolled: metrics.scrollTop > 0,
        remaining: metrics.remainingFromBottom,
      };
    }).toMatchObject({
      overflowed: true,
      scrolled: true,
      remaining: expect.any(Number),
    });
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const pinnedStream = await streamAssistantDeltas(harness, window, [
      "PINNED_STREAM_CHUNK_A ",
      "PINNED_STREAM_CHUNK_B ",
      "PINNED_STREAM_CHUNK_C",
    ]);
    await expect(window.getByTestId("transcript")).toContainText(pinnedStream.fullText);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    await scrollTimelineAwayFromBottom(window, 220);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeGreaterThan(100);
    const beforeScrollTop = (await getTimelineScrollMetrics(window)).scrollTop;

    const awayStream = await streamAssistantDeltas(harness, window, [
      "AWAY_STREAM_CHUNK_A ",
      "AWAY_STREAM_CHUNK_B ",
      "AWAY_STREAM_CHUNK_C",
    ]);
    await expect(window.getByTestId("transcript")).toContainText(awayStream.fullText);
    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return Math.abs(metrics.scrollTop - beforeScrollTop);
    }).toBeLessThanOrEqual(12);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});


test("final-only rendering keeps unfinished Markdown out of the visible transcript", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [await makeWorkspace("final-only-rendering")],
    testMode: "background",
    envOverrides: { PI_GUI_BRAND: "alpi" },
    recordVideoDir: testInfo.outputPath("video"),
  });
  try {
    const window = await harness.firstWindow();
    await createTimelineSession(window, "Final-only rendering");
    const state = await getDesktopState(window);
    const ws = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId)!;
    const session = ws.sessions.find((entry) => entry.id === state.selectedSessionId)!;
    const sessionRef = { workspaceId: ws.id, sessionId: session.id };
    const base = { sessionRef, timestamp: new Date().toISOString(), runId: "final-only-run" };
    await emitTestSessionEvent(harness, {
      ...base, type: "sessionUpdated", snapshot: {
        ref: sessionRef, workspace: { workspaceId: ws.id, path: ws.path },
        title: session.title, status: "running", updatedAt: base.timestamp, runningRunId: base.runId,
      },
    });
    await emitTestSessionEvent(harness, { ...base, type: "assistantDelta", text: "## Finished heading\n\n| Name | Value |\n" });
    await window.waitForTimeout(100);
    await window.screenshot({ path: testInfo.outputPath("streaming.png") });
    const assistant = window.locator(".timeline-item--assistant").last();
    await expect(assistant).toHaveText("Preparing response…");
    const activeRecord = await window.evaluate(() => window.piApp!.getSelectedTranscript());
    expect(activeRecord?.activeAssistantMessageId).toBeTruthy();
    const activeId = activeRecord!.activeAssistantMessageId!;
    const beforeBox = await assistant.boundingBox();
    const chunks = [
      "| --- | --- |\n| **Ready** | 42 |\n\n",
      "> - parent\n>   - child\n\n```ts\nconst answer = 42;\n```\n\n",
      "~~~\nplain tilde code\n~~~\n\n```\nunlabelled code\n```\n\n",
      "[Reference][end]\n\n" + "long prose ".repeat(230),
      "\n\n[end]: https://example.com/final\n",
    ];
    // Sample every frame, including async IPC and React commits between assertions.
    await window.evaluate(() => {
      const state = { samples: [] as { text: string; height: number }[], stop: false };
      (window as any).__renderSamples = state;
      const sample = () => {
        const row = document.querySelector(".timeline-item--assistant:last-child")
          ?? Array.from(document.querySelectorAll(".timeline-item--assistant")).at(-1);
        if (row) state.samples.push({ text: row.textContent ?? "", height: row.getBoundingClientRect().height });
        if (!state.stop) requestAnimationFrame(sample);
      };
      sample();
    });
    for (const text of chunks) {
      await emitTestSessionEvent(harness, { ...base, type: "assistantDelta", text });
      await window.waitForTimeout(50);
      await expect(assistant).toHaveText("Preparing response…");
      expect((await assistant.boundingBox())?.height).toBe(beforeBox?.height);
    }
    // An unrelated activity must not expose the still-active assistant row.
    await emitTestSessionEvent(harness, {
      ...base, type: "hostUiRequest", request: { kind: "notify", requestId: "notice", message: "Still working", level: "info" },
    });
    await expect(assistant).toHaveText("Preparing response…");
    const samples = await window.evaluate(() => {
      (window as any).__renderSamples.stop = true;
      return (window as any).__renderSamples.samples as { text: string; height: number }[];
    });
    expect(samples.length).toBeGreaterThan(3);
    expect(samples.every((sample) => sample.text === "Preparing response…" && sample.height === beforeBox?.height)).toBe(true);
    await emitTestSessionEvent(harness, { ...base, type: "assistantMessageCompleted" });
    await expect(assistant.locator("h2")).toHaveText("Finished heading");
    await expect(assistant.locator("table tbody tr")).toHaveCount(1);
    await expect(assistant.locator("blockquote li")).toHaveCount(2);
    await expect(assistant.locator("a")).toHaveAttribute("href", "https://example.com/final");
    await expect(assistant.locator("code")).toHaveCount(3);
    expect((await window.evaluate(() => window.piApp!.getSelectedTranscript()))?.activeAssistantMessageId).toBeUndefined();
    expect((await getDesktopState(window)).workspaces.flatMap((entry) => entry.sessions).find((entry) => entry.id === session.id)?.status).toBe("running");
    const completedHtml = await assistant.innerHTML();
    // A subsequent assistant message does not append to, hide or reparse the finished one.
    await emitTestSessionEvent(harness, { ...base, type: "assistantDelta", text: "**Stopped partial**" });
    await expect(window.locator(".message__preparing")).toHaveCount(1);
    const first = window.locator(`[data-timeline-id="${activeId}"] .timeline-item--assistant`);
    expect(await first.innerHTML()).toBe(completedHtml);
    await emitTestSessionEvent(harness, { ...base, type: "runCancelled" });
    await expect(window.locator(".message__preparing")).toHaveCount(0);
    await expect(window.locator(".timeline-item--assistant").last().locator("strong")).toHaveText("Stopped partial");
    await window.screenshot({ path: testInfo.outputPath("completed.png") });
    await writeFile(testInfo.outputPath("frame-samples.json"), JSON.stringify(samples, null, 2));

  } finally {
    await harness.close();
  }
});


test("final-only rendering stabilizes image loads, tools and virtualized hidden deltas", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [await makeWorkspace("final-only-layout")],
    testMode: "background", envOverrides: { PI_GUI_BRAND: "alpi" },
    recordVideoDir: testInfo.outputPath("video"),
  });
  try {
    const window = await harness.firstWindow();
    const metrics: unknown[] = [];
    const recordMetrics = async (step: string) => {
      metrics.push({ step, ...await getTimelineScrollMetrics(window) });
      await writeFile(testInfo.outputPath("scroll-steps.json"), JSON.stringify(metrics, null, 2));
    };
    await createTimelineSession(window, "Layout stability");
    // A wheel nudge in a short, non-scrollable thread must not release follow mode.
    await window.getByTestId("timeline-pane").evaluate((pane) => {
      if (pane.scrollHeight > pane.clientHeight) throw new Error("Expected a short thread");
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -5, bubbles: true }));
    });
    const pendingImages = new Map<string, () => Promise<void>>();
    await window.route("https://render-test.invalid/**", async (route) => {
      if (route.request().url().endsWith("broken.svg")) { await route.abort(); return; }
      await new Promise<void>((resolve) => pendingImages.set(route.request().url(), async () => {
        await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#456"/></svg>' });
        resolve();
      }));
    });
    await seedTranscriptMessages(harness, window, {
      count: 20,
      textFactory: (index) => index === 3 ? "![slow](https://render-test.invalid/older.svg)" : `Image anchor row ${index} ` + "content ".repeat(25),
    });
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(1);
    const anchor = window.locator(".timeline-item--assistant", { hasText: "Image anchor row 7" });
    await anchor.evaluate((row) => {
      const pane = document.querySelector<HTMLElement>("[data-testid=timeline-pane]")!;
      pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeGreaterThan(100);
    // Let the deliberate scroll and its anchor capture settle before releasing the delayed image.
    await window.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = (await anchor.boundingBox())!.y;
    await expect.poll(() => pendingImages.has("https://render-test.invalid/older.svg")).toBe(true);
    await pendingImages.get("https://render-test.invalid/older.svg")!();
    await expect.poll(() => window.locator('img[alt="slow"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
    await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
    await jumpTimelineToBottom(window);
    await streamAssistantDeltas(harness, window, ["![pinned](https://render-test.invalid/pinned.svg)\n\n![broken](https://render-test.invalid/broken.svg)"]);
    await expect.poll(() => pendingImages.has("https://render-test.invalid/pinned.svg")).toBe(true);
    await pendingImages.get("https://render-test.invalid/pinned.svg")!();
    await expect.poll(() => window.locator('img[alt="pinned"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(1);
    // Exercise an actually virtualized history; hidden text must not flip it to exact DOM.
    await createTimelineSession(window, "Virtual placeholder");
    await seedTranscriptMessages(harness, window, { count: 50, textFactory: (i) => `Short history ${i} ` + "word ".repeat(15) });
    await expect(window.locator(".timeline--virtualized")).toHaveCount(1);
    const state = await getDesktopState(window);
    const ws = state.workspaces.find((w) => w.id === state.selectedWorkspaceId)!;
    const session = ws.sessions.find((entry) => entry.id === state.selectedSessionId)!;
    const sessionRef = { workspaceId: ws.id, sessionId: session.id };
    const base = { sessionRef, timestamp: new Date().toISOString(), runId: "layout-run" };
    await emitTestSessionEvent(harness, { ...base, type: "sessionUpdated", snapshot: {
      ref: sessionRef, workspace: { workspaceId: ws.id, path: ws.path }, title: session.title,
      status: "running", updatedAt: base.timestamp, runningRunId: base.runId,
    }});
    await emitTestSessionEvent(harness, { ...base, type: "assistantDelta", text: "## Hidden\n\n" });
    await expect(window.locator(".message__preparing")).toHaveCount(1);
    await recordMetrics("hidden-start");
    const beforeMetrics = await getTimelineScrollMetrics(window);
    for (let i = 0; i < 4; i++) {
      await emitTestSessionEvent(harness, { ...base, type: "assistantDelta", text: "wide words ".repeat(100) });
      await window.waitForTimeout(50);
      await expect(window.locator(".timeline--virtualized")).toHaveCount(1);
      const next = await getTimelineScrollMetrics(window);
      expect(Math.abs(next.scrollHeight - beforeMetrics.scrollHeight)).toBeLessThanOrEqual(1);
      expect(Math.abs(next.scrollTop - beforeMetrics.scrollTop)).toBeLessThanOrEqual(1);
    }
    // Switching away/back while active keeps the preparation row and actual active ID.
    const activeRecord = await window.evaluate(() => window.piApp!.getSelectedTranscript());
    await createTimelineSession(window, "Unrelated empty session");
    await window.evaluate((ref) => window.piApp!.selectSession(ref), sessionRef);
    await expect(window.locator(".message__preparing")).toHaveCount(1);
    expect((await window.evaluate(() => window.piApp!.getSelectedTranscript()))?.activeAssistantMessageId).toBe(activeRecord?.activeAssistantMessageId);
    await recordMetrics("switch-back");
    await emitTestSessionEvent(harness, { ...base, type: "toolStarted", callId: "render-tool", toolName: "edit", input: { path: "example.ts", text: "input" } });
    await expect(window.locator(".message__preparing")).toHaveCount(0);
    const tool = window.locator(".timeline-tool").last();
    await recordMetrics("before-click");
    await tool.locator(".timeline-tool__header").click();
    await expect(tool.locator(".timeline-tool__pre")).toContainText("input");
    await window.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await recordMetrics("expanded");
    const toolHeight = (await tool.boundingBox())!.height;
    const toolScroll = await getTimelineScrollMetrics(window);
    await emitTestSessionEvent(harness, { ...base, type: "toolUpdated", callId: "render-tool", text: "invisible details ".repeat(400) });
    await window.waitForTimeout(100);
    expect((await tool.boundingBox())!.height).toBe(toolHeight);
    expect(Math.abs((await getTimelineScrollMetrics(window)).scrollTop - toolScroll.scrollTop)).toBeLessThanOrEqual(1);
    await emitTestSessionEvent(harness, { ...base, type: "toolFinished", callId: "render-tool", success: true, output: { diff: "@@ -1 +1 @@\n-old\n+new" } });
    await expect(tool.locator(".diff-inline")).toContainText("new");
    await recordMetrics("tool-finished");
    await emitTestSessionEvent(harness, { ...base, type: "assistantDelta", text: "**Failed partial**" });
    await expect(window.locator(".message__preparing")).toHaveCount(1);
    await emitTestSessionEvent(harness, { ...base, type: "runFailed", error: { message: "Fixture failure" } });
    await expect(window.locator(".message__preparing")).toHaveCount(0);
    await expect(window.locator(".timeline-item--assistant").last().locator("strong")).toHaveText("Failed partial");
    await recordMetrics("run-failed");
    // Wide final tables stay within the pane at a narrow supported window width.
    await harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 760));
    await recordMetrics("resized");
    await streamAssistantDeltas(harness, window, ["| " + "column".repeat(120) + " | two |\n| --- | --- |\n| one | two |"]);
    await expect(window.locator(".message__content table").last()).toBeVisible();
    const widths = await window.getByTestId("timeline-pane").evaluate((pane) => ({ width: pane.clientWidth, scrollWidth: pane.scrollWidth }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.width + 1);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(1);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(0);
    await recordMetrics("completed");
    await window.screenshot({ path: testInfo.outputPath("layout-completed.png") });
  } finally {
    await harness.close();
  }
});
