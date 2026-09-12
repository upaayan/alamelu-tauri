import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionQueuedMessage, SessionRef, SessionSnapshot, WorkspaceRef } from "@alamelu-pi/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

async function selectedSessionContext(window: Parameters<typeof getDesktopState>[0]): Promise<{
  readonly sessionRef: SessionRef;
  readonly workspace: WorkspaceRef;
  readonly title: string;
}> {
  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
  if (!workspace) {
    throw new Error("Expected a selected workspace");
  }
  const session = workspace.sessions.find((entry) => entry.id === state.selectedSessionId);
  if (!session) {
    throw new Error("Expected a selected session");
  }
  return {
    sessionRef: { workspaceId: workspace.id, sessionId: session.id },
    workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
    title: session.title,
  };
}

const RUN_ID = "compaction-core-run";

function runningSnapshot(
  context: Awaited<ReturnType<typeof selectedSessionContext>>,
  extra: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    ref: context.sessionRef,
    workspace: context.workspace,
    title: context.title,
    status: "running",
    updatedAt: new Date().toISOString(),
    runningRunId: RUN_ID,
    ...extra,
  };
}

test("shows compaction progress and its outcome in the timeline, header and composer hint", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("compaction-workspace");
  await seedAgentDir(agentDir);
  // Alamelu Pi always runs the RPC driver; launch exactly that configuration.
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_GUI_BRAND: "alpi",
      PI_GUI_DRIVER: "rpc",
    },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Compaction session");
    const context = await selectedSessionContext(window);
    const base = { sessionRef: context.sessionRef, runId: RUN_ID };
    const startedAt = new Date(Date.now() - 5_000).toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      ...base,
      timestamp: new Date().toISOString(),
      snapshot: runningSnapshot(context),
    });
    await expect(window.locator(".chat-header__status")).toContainText("Working");

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      ...base,
      timestamp: new Date().toISOString(),
      snapshot: runningSnapshot(context, { compacting: { reason: "threshold", startedAt } }),
    });
    await emitTestSessionEvent(harness, {
      type: "compactionStarted",
      ...base,
      timestamp: new Date().toISOString(),
      reason: "threshold",
      startedAt,
    } satisfies SessionDriverEvent);

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("Compacting conversation…");
    await expect(window.locator(".chat-header__status")).toContainText("Compacting conversation for");
    await expect(window.locator(".composer__hint")).toContainText("Compacting conversation for");

    await emitTestSessionEvent(harness, {
      type: "compactionEnded",
      ...base,
      timestamp: new Date().toISOString(),
      reason: "threshold",
      startedAt,
      endedAt: new Date().toISOString(),
      outcome: "completed",
      tokensBefore: 514440,
      estimatedTokensAfter: 32000,
    } satisfies SessionDriverEvent);
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      ...base,
      timestamp: new Date().toISOString(),
      snapshot: runningSnapshot(context),
    });

    await expect(transcript).toContainText("Compacted conversation");
    await expect(transcript).not.toContainText("Compacting conversation…");
    await expect(window.locator(".chat-header__status")).toContainText("Working for");

    const { runningRunId: _runningRunId, ...idle } = runningSnapshot(context);
    await emitTestSessionEvent(harness, {
      type: "runCompleted",
      ...base,
      timestamp: new Date().toISOString(),
      snapshot: { ...idle, status: "idle" },
    });
    await expect(window.locator(".chat-header__status")).not.toContainText("Working");
    await expect(window.locator(".composer__hint")).toContainText("Enter to send");
  } finally {
    await harness.close();
  }
});

test("queued messages are display-only when the driver cannot edit its queue", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("compaction-rpc-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_GUI_BRAND: "alpi",
      PI_GUI_DRIVER: "rpc",
    },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Queued RPC session");
    const context = await selectedSessionContext(window);
    const state = await getDesktopState(window);
    expect(state.driverCapabilities.queueEditing).toBe(false);

    const queued: SessionQueuedMessage = {
      id: "queued-rpc-1",
      mode: "followUp",
      text: "Follow up after the current work",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: context.sessionRef,
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      snapshot: runningSnapshot(context, { queuedMessages: [queued] }),
    });

    const chip = window.getByTestId("queued-composer-message").filter({ hasText: queued.text });
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("Queued");
    await expect(chip.getByRole("button", { name: "Steer", exact: true })).toHaveCount(0);
    await expect(chip.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(chip.getByRole("button", { name: /Delete queued message/ })).toHaveCount(0);

    await emitTestSessionEvent(harness, {
      type: "queuedMessageStarted",
      sessionRef: context.sessionRef,
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      message: queued,
    });
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: context.sessionRef,
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      snapshot: runningSnapshot(context),
    });
    await expect(window.getByTestId("queued-composer-messages")).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText(queued.text);
  } finally {
    await harness.close();
  }
});
