import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ArchiveIcon, BellIcon, ChevronDownIcon, EditIcon, ExtensionIcon, FolderIcon, PlusIcon, RestoreIcon, SearchIcon, SettingsIcon, SkillIcon, WorktreeIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime } from "./string-utils";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { ThreadGroup, ThreadListEntry } from "./thread-groups";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "./desktop-state";
import { isNoRepositoryWorkspace } from "./workspace-roots";

const COLLAPSED_THREAD_COUNT = 4;
const PRIORITY_WINDOW_MS = 30 * 60 * 1000;

interface SidebarProps {
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly threadGroups: readonly ThreadGroup[];
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly onNewThread: () => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenExtensions: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onRenameSession: (target: { workspaceId: string; sessionId: string }, title: string) => void | Promise<unknown>;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    activeView,
    selectedWorkspace,
    selectedSession,
    visibleWorkspaces,
    threadGroups,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    setSnapshot,
    updateSnapshot,
    onNewThread,
    onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenSettings,
    onArchiveSession,
    onRenameSession,
    onSelectSession,
    onUnarchiveSession,
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [timelineView, setTimelineView] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Collision detection based on workspace row headers only (~30px top of each group),
  // not the full group height including all sessions.
  const headerCollision: CollisionDetection = (args) => {
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY == null) return [];

    let closest: { id: string; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      const rect = container.rect.current;
      if (!rect) continue;
      const headerCenter = rect.top + 15; // center of the ~30px workspace row header
      const distance = Math.abs(pointerY - headerCenter);
      if (!closest || distance < closest.distance) {
        closest = { id: String(container.id), distance };
      }
    }
    return closest ? [{ id: closest.id, data: { droppableContainer: args.droppableContainers.find((c) => String(c.id) === closest!.id)! } }] : [];
  };

  const rootGroups = threadGroups.filter((g) => g.rootWorkspace.kind === "primary");
  const orphanGroups = threadGroups.filter((g) => g.rootWorkspace.kind !== "primary");
  const rootGroupIds = rootGroups.map((g) => g.rootWorkspace.id);
  const canDrag = rootGroups.length > 1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rootGroupIds.indexOf(String(active.id));
    const newIndex = rootGroupIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newOrder = arrayMove(rootGroupIds, oldIndex, newIndex);
    // Optimistically update local state to avoid snap-back animation
    setSnapshot((prev) => prev ? { ...prev, workspaceOrder: newOrder } : prev);
    void api.reorderWorkspaces(newOrder);
  }

  const activeGroup = activeId ? rootGroups.find((g) => g.rootWorkspace.id === activeId) : undefined;
  const searchableThreads = useMemo(
    () =>
      threadGroups.flatMap((group) =>
        group.threads.map((thread) => ({
          thread,
          workspaceName:
            thread.environment.kind === "worktree"
              ? thread.environment.label
              : group.rootWorkspace.name,
        })),
      ),
    [threadGroups],
  );
  const hasUnseen = searchableThreads.some((item) => item.thread.session.hasUnseenUpdate);

  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <button
          className="sidebar__new"
          type="button"
          disabled={!selectedWorkspace}
          onClick={onNewThread}
        >
          <PlusIcon />
          <span>New thread</span>
        </button>

        <div className="sidebar__nav">
          <button
            className={`sidebar__nav-item ${activeView === "threads" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onSetActiveView("threads")}
          >
            <FolderIcon />
            <span>Threads</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() => onOpenSkills(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <SkillIcon />
            <span>Skills</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() => onOpenExtensions(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <ExtensionIcon />
            <span>Extensions</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() => onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="sidebar__section">
        <div className="section__head">
          <span>{timelineView ? "Recent activity" : "Threads"}</span>
          <div className="section__tools">
            <button
              aria-label="Search chats"
              className="icon-button"
              title="Search chats"
              type="button"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon />
            </button>
            <button
              aria-label={timelineView ? "Show projects" : "Show recent activity"}
              className={`icon-button sidebar-bell${timelineView ? " icon-button--active" : ""}`}
              title={timelineView ? "Back to projects" : "Recent activity"}
              type="button"
              onClick={() => setTimelineView((current) => !current)}
            >
              <BellIcon />
              {hasUnseen ? <span className="sidebar-unseen-dot" /> : null}
            </button>
            <button
              aria-label="Open folder"
              className="icon-button"
              type="button"
              onClick={() => {
                void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
              }}
            >
              <FolderIcon />
            </button>
          </div>
        </div>

        {visibleWorkspaces.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <h2>No folders yet</h2>
            <p>Open a project folder to start building a workspace and session list.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
              }}
            >
              Open first folder
            </button>
          </div>
        ) : timelineView ? (
          <TimelineView
            items={searchableThreads}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            onArchiveSession={onArchiveSession}
            onRenameSession={onRenameSession}
            onSelectSession={onSelectSession}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={headerCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={rootGroupIds} strategy={verticalListSortingStrategy}>
              <div className="workspace-list" data-testid="workspace-list">
                {rootGroups.map((group) => (
                  <SortableWorkspaceGroup
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={canDrag}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onRenameSession={onRenameSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                  />
                ))}
                {orphanGroups.map((group) => (
                  <WorkspaceGroupContent
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onRenameSession={onRenameSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeGroup ? (
                <div className="workspace-group workspace-group--overlay">
                  <WorkspaceGroupContent
                    group={activeGroup}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onRenameSession={onRenameSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        {searchOpen ? (
          <SearchPopup
            items={searchableThreads}
            onSelectSession={(target) => {
              setSearchOpen(false);
              onSelectSession(target);
            }}
            onClose={() => setSearchOpen(false)}
          />
        ) : null}
      </div>
    </aside>
  );
}

/* ── Sortable workspace group wrapper ──────────────────── */

interface WorkspaceGroupProps {
  readonly group: ThreadGroup;
  readonly canDrag: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onRenameSession: (target: { workspaceId: string; sessionId: string }, title: string) => void | Promise<unknown>;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
}

function SortableWorkspaceGroup(props: WorkspaceGroupProps) {
  const { group, wsMenu } = props;
  const isRenaming = wsMenu.workspaceRenameId === group.rootWorkspace.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.rootWorkspace.id,
    disabled: isRenaming,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`workspace-group ${isDragging ? "workspace-group--dragging" : ""}`}
    >
      <WorkspaceGroupContent
        {...props}
        dragHandleProps={props.canDrag && !isRenaming ? { attributes, listeners } : undefined}
      />
    </section>
  );
}

/* ── Workspace group content (used both inline and in overlay) ──── */

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function WorkspaceGroupContent(
  props: WorkspaceGroupProps & { readonly dragHandleProps?: DragHandleProps },
) {
  const {
    group: { rootWorkspace, threads, archivedThreads },
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    onArchiveSession,
    onRenameSession,
    onSelectSession,
    onUnarchiveSession,
    dragHandleProps,
  } = props;

  const workspaceActive =
    rootWorkspace.id === selectedWorkspace?.id ||
    rootWorkspace.id === selectedWorkspace?.rootWorkspaceId;
  const linkedWorktree = linkedWorktreeByWorkspaceId.get(rootWorkspace.id);
  const archivedSectionOpen = wsMenu.expandedArchivedByWorkspace[rootWorkspace.id] ?? false;
  const isCollapsed = wsMenu.isWorkspaceCollapsed(rootWorkspace.id);
  const isNoRepository = isNoRepositoryWorkspace(rootWorkspace);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const visibleThreads = showAllThreads ? threads : threads.slice(0, COLLAPSED_THREAD_COUNT);

  return (
    <>
      <div className={`workspace-row ${workspaceActive ? "workspace-row--active" : ""}`}>
        <button
          className={`workspace-row__select ${dragHandleProps ? "workspace-row__select--draggable" : ""}`}
          onClick={() => wsMenu.toggleWorkspaceCollapsed(rootWorkspace.id)}
          type="button"
          {...(dragHandleProps ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners } : {})}
        >
          <span className="workspace-row__icon" aria-hidden="true" data-collapsed={isCollapsed || undefined}>
            <span className="workspace-row__icon-folder"><FolderIcon /></span>
            <span className="workspace-row__icon-chevron"><ChevronDownIcon /></span>
          </span>
          <span className="workspace-row__name">{rootWorkspace.name}</span>
        </button>
        <span
          className="workspace-row__menu-wrap"
          ref={wsMenu.workspaceMenuId === rootWorkspace.id ? wsMenu.workspaceMenuWrapRef : undefined}
        >
          <button
            aria-label={`Workspace actions for ${rootWorkspace.name}`}
            aria-haspopup="menu"
            className="icon-button workspace-row__menu-button"
            aria-expanded={wsMenu.workspaceMenuId === rootWorkspace.id}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              wsMenu.openWorkspaceMenu(rootWorkspace.id);
            }}
          >
            …
          </button>
          {wsMenu.workspaceMenuId === rootWorkspace.id ? (
            <div className="workspace-menu">
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) =>
                  wsMenu.runWorkspaceMenuAction(event, () => {
                    void api.openWorkspaceInFinder(rootWorkspace.id);
                  })
                }
              >
                Open folder
              </button>
              {linkedWorktree ? (
                <button
                  className="workspace-menu__item workspace-menu__item--danger"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () =>
                      wsMenu.removeWorktree(linkedWorktree.rootWorkspaceId || rootWorkspace.id, linkedWorktree),
                    )
                  }
                >
                  Remove worktree
                </button>
              ) : isNoRepository ? null : (
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => wsMenu.createWorktree(rootWorkspace.id))
                  }
                >
                  Create permanent worktree
                </button>
              )}
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.startRename(rootWorkspace))}
              >
                Edit name
              </button>
              <button
                className="workspace-menu__item workspace-menu__item--danger"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.removeWorkspace(rootWorkspace))}
              >
                Remove
              </button>
            </div>
          ) : null}
        </span>
      </div>
      {wsMenu.workspaceRenameId === rootWorkspace.id ? (
        <form
          className="workspace-rename"
          ref={wsMenu.workspaceRenamePanelRef}
          onSubmit={(event) => {
            event.preventDefault();
            wsMenu.submitRename(rootWorkspace);
          }}
        >
          <input
            aria-label={`Rename ${rootWorkspace.name}`}
            className="workspace-rename__input"
            ref={wsMenu.workspaceRenameInputRef}
            value={wsMenu.workspaceRenameDraft}
            onChange={(event) => {
              wsMenu.setWorkspaceRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                wsMenu.cancelRename();
              }
            }}
          />
          <div className="workspace-rename__actions">
            <button className="workspace-rename__button" type="button" onClick={wsMenu.cancelRename}>
              Cancel
            </button>
            <button className="workspace-rename__button workspace-rename__button--primary" type="submit">
              Save
            </button>
          </div>
        </form>
      ) : null}
      {!isCollapsed ? (
        <>
          <div className="session-list">
            {visibleThreads.map((thread) => {
              const active = thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
              return (
                <ThreadSessionRow
                  key={`${thread.workspaceId}:${thread.session.id}`}
                  active={active}
                  thread={thread}
                  onAction={() =>
                    onArchiveSession({
                      workspaceId: thread.workspaceId,
                      sessionId: thread.session.id,
                    })
                  }
                  onRename={(title) =>
                    onRenameSession(
                      {
                        workspaceId: thread.workspaceId,
                        sessionId: thread.session.id,
                      },
                      title,
                    )
                  }
                  onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                />
              );
            })}
          </div>
          {threads.length > COLLAPSED_THREAD_COUNT ? (
            <button
              className="sidebar-show-more"
              type="button"
              onClick={() => setShowAllThreads((current) => !current)}
            >
              {showAllThreads ? "Show less" : "Show more"}
            </button>
          ) : null}
          {archivedThreads.length > 0 ? (
            <div className="archived-thread-group">
              <button
                aria-expanded={archivedSectionOpen}
                className="archived-thread-group__toggle"
                type="button"
                onClick={() => wsMenu.toggleArchived(rootWorkspace.id, !archivedSectionOpen)}
              >
                <span
                  aria-hidden="true"
                  className={`archived-thread-group__chevron ${archivedSectionOpen ? "archived-thread-group__chevron--open" : ""}`}
                >
                  <ChevronDownIcon />
                </span>
                <span>Archived</span>
                <span className="archived-thread-group__count">{archivedThreads.length}</span>
              </button>
              {archivedSectionOpen ? (
                <div className="session-list session-list--archived">
                  {archivedThreads.map((thread) => {
                    const active =
                      thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
                    return (
                      <ThreadSessionRow
                        key={`${thread.workspaceId}:${thread.session.id}`}
                        active={active}
                        archived
                        thread={thread}
                        onAction={() =>
                          onUnarchiveSession({
                            workspaceId: thread.workspaceId,
                            sessionId: thread.session.id,
                          })
                        }
                        onRename={(title) =>
                          onRenameSession(
                            {
                              workspaceId: thread.workspaceId,
                              sessionId: thread.session.id,
                            },
                            title,
                          )
                        }
                        onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/* ── Thread session row ────────────────────────────────── */

function sessionIndicatorVariant(thread: ThreadListEntry): "running" | "unseen" | "none" {
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.hasUnseenUpdate) {
    return "unseen";
  }
  return "none";
}

function ThreadSessionRow({
  active,
  archived = false,
  location,
  thread,
  onAction,
  onRename,
  onSelect,
}: {
  readonly active: boolean;
  readonly archived?: boolean;
  readonly location?: string;
  readonly thread: ThreadListEntry;
  readonly onAction: () => void;
  readonly onRename: (title: string) => void | Promise<unknown>;
  readonly onSelect: () => void;
}) {
  const indicatorVariant = sessionIndicatorVariant(thread);
  const [renaming, setRenaming] = useState(false);
  const [renamePending, setRenamePending] = useState(false);
  const [draft, setDraft] = useState(thread.session.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!renaming) {
      setDraft(thread.session.title);
    }
  }, [renaming, thread.session.title]);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const handleRenameRequest = () => {
    setDraft(thread.session.title);
    setRenaming(true);
  };

  const cancelRename = () => {
    setDraft(thread.session.title);
    setRenaming(false);
  };

  const submitRename = () => {
    const currentTitle = thread.session.title.trim();
    const nextTitle = draft.trim();
    if (!nextTitle || nextTitle === currentTitle) {
      setRenaming(false);
      setDraft(thread.session.title);
      return;
    }
    // Stay open and disabled until the rename actually lands, so a failure is
    // visible instead of closing optimistically and silently reverting.
    const result = onRename(nextTitle);
    if (!result || typeof (result as Promise<unknown>).finally !== "function") {
      setRenaming(false);
      return;
    }
    setRenamePending(true);
    void (result as Promise<unknown>).finally(() => {
      setRenamePending(false);
      setRenaming(false);
    });
  };

  return (
    <div
      className={`session-row ${active ? "session-row--active" : ""} ${renaming ? "session-row--renaming" : ""} ${renamePending ? "session-row--rename-pending" : ""}`}
      data-sidebar-indicator={indicatorVariant}
      data-session-id={thread.session.id}
      onContextMenu={(event) => {
        event.preventDefault();
        handleRenameRequest();
      }}
    >
      {renaming ? (
        <form
          className="session-row__rename"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <input
            aria-label={`Rename ${thread.session.title}`}
            className="session-row__rename-input"
            disabled={renamePending}
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
          <button className="session-row__rename-button session-row__rename-button--primary" disabled={renamePending} type="submit">
            Save
          </button>
          <button className="session-row__rename-button" type="button" onClick={cancelRename}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="session-row__select" onClick={onSelect} type="button">
          <span className="session-row__leading" aria-hidden="true">
            {indicatorVariant === "running" ? <span className="session-row__status session-row__status--running" /> : null}
            {indicatorVariant === "unseen" ? <span className="session-row__status session-row__status--unseen" /> : null}
          </span>
          <span className="session-row__body">
            <span className="session-row__title-line">
              <span className="session-row__title">{thread.session.title}</span>
            </span>
            {location ? <span className="session-row__location">{location}</span> : null}
            {thread.session.preview ? <span className="session-row__preview">{thread.session.preview}</span> : null}
          </span>
        </button>
      )}
      <span className="session-row__trailing">
        {thread.environment.kind === "worktree" ? (
          <span className="session-row__workspace-icon" aria-hidden="true" title="Worktree">
            <WorktreeIcon />
          </span>
        ) : null}
        <span className="session-row__time">{formatRelativeTime(thread.session.updatedAt)}</span>
        <span className="session-row__actions">
          <button
            aria-label={`Rename ${thread.session.title}`}
            className="icon-button session-row__action"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleRenameRequest();
            }}
          >
            <EditIcon />
          </button>
          <button
            aria-label={`${archived ? "Restore" : "Archive"} ${thread.session.title}`}
            className="icon-button session-row__action"
            type="button"
            onClick={onAction}
          >
            {archived ? <RestoreIcon /> : <ArchiveIcon />}
          </button>
        </span>
      </span>
    </div>
  );
}

type SearchableThread = {
  readonly thread: ThreadListEntry;
  readonly workspaceName: string;
};

function TimelineView({
  items,
  selectedWorkspace,
  selectedSession,
  onArchiveSession,
  onRenameSession,
  onSelectSession,
}: {
  readonly items: readonly SearchableThread[];
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onRenameSession: (target: { workspaceId: string; sessionId: string }, title: string) => void | Promise<unknown>;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
}) {
  const sections = bucketSidebarThreads(items, Date.now());
  return (
    <div className="sidebar-timeline">
      {sections.map(({ title: heading, items: sectionItems }) =>
        sectionItems.length > 0 ? (
          <section className="sidebar-timeline-section" key={heading}>
            <div className="sidebar-timeline-heading">{heading}</div>
            <div className="session-list">
              {sectionItems.map(({ thread, workspaceName }) => {
                const active =
                  thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
                return (
                  <ThreadSessionRow
                    key={`${thread.workspaceId}:${thread.session.id}`}
                    active={active}
                    location={workspaceName}
                    thread={thread}
                    onAction={() =>
                      onArchiveSession({
                        workspaceId: thread.workspaceId,
                        sessionId: thread.session.id,
                      })
                    }
                    onRename={(nextTitle) =>
                      onRenameSession(
                        {
                          workspaceId: thread.workspaceId,
                          sessionId: thread.session.id,
                        },
                        nextTitle,
                      )
                    }
                    onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                  />
                );
              })}
            </div>
          </section>
        ) : null,
      )}
      {items.length === 0 ? <div className="sidebar-empty">No threads yet.</div> : null}
    </div>
  );
}

function SearchPopup({
  items,
  onSelectSession,
  onClose,
}: {
  readonly items: readonly SearchableThread[];
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const results = (trimmed
    ? items.filter(
        ({ thread, workspaceName }) =>
          thread.session.title.toLowerCase().includes(trimmed) ||
          thread.session.preview.toLowerCase().includes(trimmed) ||
          workspaceName.toLowerCase().includes(trimmed),
      )
    : [...items].sort((left, right) =>
        right.thread.session.updatedAt.localeCompare(left.thread.session.updatedAt),
      )
  ).slice(0, 9);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="search-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="search-panel" role="dialog" aria-label="Search chats">
        <input
          type="search"
          className="search-panel-input"
          placeholder="Search chats"
          aria-label="Search chats"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="search-panel-heading">Chats</div>
        <ul className="search-panel-results">
          {results.map(({ thread, workspaceName }) => (
            <li key={`${thread.workspaceId}:${thread.session.id}`}>
              <button
                type="button"
                className="search-panel-result"
                onClick={() =>
                  onSelectSession({
                    workspaceId: thread.workspaceId,
                    sessionId: thread.session.id,
                  })
                }
              >
                <span className="search-panel-result-title">{thread.session.title}</span>
                <span className="search-panel-result-location">{workspaceName}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className="sidebar-empty">No matching chats.</li> : null}
        </ul>
      </div>
    </div>
  );
}

function bucketSidebarThreads(
  items: readonly SearchableThread[],
  nowMs: number,
): Array<{ title: string; items: SearchableThread[] }> {
  const sorted = [...items].sort((left, right) =>
    right.thread.session.updatedAt.localeCompare(left.thread.session.updatedAt),
  );
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const yesterdayMs = todayMs - 86_400_000;
  const weekMs = todayMs - 6 * 86_400_000;

  const priority: SearchableThread[] = [];
  const today: SearchableThread[] = [];
  const yesterday: SearchableThread[] = [];
  const week: SearchableThread[] = [];
  const older: SearchableThread[] = [];

  for (const item of sorted) {
    const recency = sessionRecencyMs(item.thread.session);
    if (item.thread.session.status === "running" || nowMs - recency <= PRIORITY_WINDOW_MS) {
      priority.push(item);
    } else if (recency >= todayMs) {
      today.push(item);
    } else if (recency >= yesterdayMs) {
      yesterday.push(item);
    } else if (recency >= weekMs) {
      week.push(item);
    } else {
      older.push(item);
    }
  }

  return [
    { title: "Priority", items: priority },
    { title: "Today", items: today },
    { title: "Yesterday", items: yesterday },
    { title: "This week", items: week },
    { title: "Older", items: older },
  ];
}

function sessionRecencyMs(session: SessionRecord): number {
  const parsed = Date.parse(session.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
