export interface RepoRootWorkspaceLike {
  readonly id: string;
  readonly path: string;
  readonly rootWorkspaceId?: string;
  readonly specialKind?: string;
}

export function isNoRepositoryWorkspace(workspace: { readonly specialKind?: string } | undefined): boolean {
  return workspace?.specialKind === "no-repository";
}

export function workspaceDisplayName(workspace: { readonly name: string; readonly specialKind?: string }): string {
  return isNoRepositoryWorkspace(workspace) ? "Others" : workspace.name;
}

export function isSystemWorkspace(workspace: { readonly specialKind?: string } | undefined): boolean {
  return workspace?.specialKind === "system";
}

export function isSystemWorkspacePathOrName(pathOrName: string | undefined): boolean {
  if (!pathOrName) {
    return false;
  }
  const normalized = pathOrName.replaceAll("\\", "/");
  const normalizedLower = normalized.toLowerCase();
  const name = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return (
    name.startsWith("alpi-provider-login-workspace-") ||
    name.startsWith("alpi-state-workspace-") ||
    normalizedLower.endsWith("/library/application support/alamelu pi/workspace") ||
    normalizedLower.endsWith("/appdata/roaming/alamelu pi/workspace")
  );
}

export function resolveRepoWorkspaceId<T extends RepoRootWorkspaceLike>(
  workspaces: readonly T[],
  workspaceId: string | undefined,
): string | undefined {
  if (!workspaceId) {
    return undefined;
  }
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace] as const));
  if (!workspacesById.has(workspaceId)) {
    return workspaceId;
  }

  const linkedChildrenByRootId = new Map<string, string[]>();
  for (const workspace of workspaces) {
    if (!workspace.rootWorkspaceId) {
      continue;
    }
    const existing = linkedChildrenByRootId.get(workspace.rootWorkspaceId);
    if (existing) {
      existing.push(workspace.id);
    } else {
      linkedChildrenByRootId.set(workspace.rootWorkspaceId, [workspace.id]);
    }
  }

  const componentIds = new Set<string>();
  const pendingIds = [workspaceId];
  while (pendingIds.length > 0) {
    const currentId = pendingIds.pop();
    if (!currentId || componentIds.has(currentId)) {
      continue;
    }
    componentIds.add(currentId);
    const workspace = workspacesById.get(currentId);
    if (!workspace) {
      continue;
    }
    if (workspace.rootWorkspaceId && !componentIds.has(workspace.rootWorkspaceId)) {
      pendingIds.push(workspace.rootWorkspaceId);
    }
    for (const childId of linkedChildrenByRootId.get(currentId) ?? []) {
      if (!componentIds.has(childId)) {
        pendingIds.push(childId);
      }
    }
  }

  return [...componentIds]
    .map((id) => workspacesById.get(id))
    .filter((workspace): workspace is T => Boolean(workspace))
    .sort((left, right) => {
      const leftIsPrimary = !left.rootWorkspaceId;
      const rightIsPrimary = !right.rootWorkspaceId;
      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }
      if (left.path.length !== right.path.length) {
        return left.path.length - right.path.length;
      }
      return left.path.localeCompare(right.path);
    })[0]?.id;
}
