interface DriveFolderContext {
  root: GoogleAppsScript.Drive.Folder;
  inbox: GoogleAppsScript.Drive.Folder;
  review: GoogleAppsScript.Drive.Folder;
}

function getFolderOrThrow(
  folderId: string,
  propertyName: string,
): GoogleAppsScript.Drive.Folder {
  try {
    const folder = DriveApp.getFolderById(folderId);
    if (folder.isTrashed()) {
      throw new Error("la cartella è nel cestino");
    }
    return folder;
  } catch (error) {
    throw new Error(
      `${propertyName} non identifica una cartella Drive accessibile: ${getErrorMessage(error)}`,
    );
  }
}

function isFolderDescendantOf(
  folder: GoogleAppsScript.Drive.Folder,
  rootFolderId: string,
): boolean {
  const pending: GoogleAppsScript.Drive.Folder[] = [folder];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const currentId = current.getId();
    if (currentId === rootFolderId) {
      return true;
    }
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    const parents = current.getParents();
    while (parents.hasNext()) {
      pending.push(parents.next());
    }
  }

  return false;
}

function validateDriveConfiguration(config: AppConfig): DriveFolderContext {
  const distinctIds = new Set([
    config.rootFolderId,
    config.inboxFolderId,
    config.reviewFolderId,
  ]);
  if (distinctIds.size !== 3) {
    throw new Error(
      "ROOT_FOLDER_ID, INBOX_FOLDER_ID e REVIEW_FOLDER_ID devono essere distinti.",
    );
  }

  const root = getFolderOrThrow(config.rootFolderId, "ROOT_FOLDER_ID");
  const inbox = getFolderOrThrow(config.inboxFolderId, "INBOX_FOLDER_ID");
  const review = getFolderOrThrow(config.reviewFolderId, "REVIEW_FOLDER_ID");

  const operationalNames = new Set([
    inbox.getName().trim().toLowerCase(),
    review.getName().trim().toLowerCase(),
  ]);
  if (
    operationalNames.has(config.duplicateFolderName.toLowerCase()) ||
    operationalNames.has(config.fallbackFolderName.toLowerCase())
  ) {
    throw new Error(
      "I nomi delle cartelle Duplicati/fallback non possono coincidere con inbox o review.",
    );
  }

  if (!isFolderDescendantOf(inbox, root.getId())) {
    throw new Error("INBOX_FOLDER_ID non si trova sotto ROOT_FOLDER_ID.");
  }
  if (!isFolderDescendantOf(review, root.getId())) {
    throw new Error("REVIEW_FOLDER_ID non si trova sotto ROOT_FOLDER_ID.");
  }

  return { root, inbox, review };
}

function shouldExcludeFolder(
  folder: GoogleAppsScript.Drive.Folder,
  reservedIds: Set<string>,
  reservedNames: Set<string>,
): boolean {
  return (
    reservedIds.has(folder.getId()) ||
    reservedNames.has(folder.getName().trim().toLowerCase())
  );
}

function buildFolderIndex(
  config: AppConfig,
  context?: DriveFolderContext,
): FolderIndex {
  const folders = context || validateDriveConfiguration(config);
  const reservedIds = new Set<string>([
    config.rootFolderId,
    config.inboxFolderId,
    config.reviewFolderId,
    ...config.excludedFolderIds,
  ]);
  const visitedIds = new Set<string>();
  const reservedNames = new Set<string>([
    "da smistare",
    "da controllare",
    "duplicati",
    folders.inbox.getName().trim().toLowerCase(),
    folders.review.getName().trim().toLowerCase(),
    config.duplicateFolderName.trim().toLowerCase(),
  ]);
  const entries: FolderEntry[] = [];
  const byId: FolderLookup = Object.create(null) as FolderLookup;
  let candidateLimitExceeded = false;

  function visit(
    folder: GoogleAppsScript.Drive.Folder,
    parentPath: string,
    parentId: string,
    depth: number,
  ): void {
    if (candidateLimitExceeded) {
      return;
    }
    const folderId = folder.getId();
    if (visitedIds.has(folderId)) {
      return;
    }
    visitedIds.add(folderId);

    if (shouldExcludeFolder(folder, reservedIds, reservedNames)) {
      return;
    }

    const name = folder.getName();
    const path = parentPath ? `${parentPath}/${name}` : name;
    const entry: FolderEntry = {
      id: folderId,
      name,
      path,
      parentId,
      depth,
    };
    entries.push(entry);
    byId[folderId] = entry;
    if (entries.length > config.maxCandidateFolders) {
      candidateLimitExceeded = true;
      return;
    }

    if (depth >= config.maxFolderDepth) {
      return;
    }

    const children = folder.getFolders();
    while (children.hasNext() && !candidateLimitExceeded) {
      visit(children.next(), path, folderId, depth + 1);
    }
  }

  const rootChildren = folders.root.getFolders();
  while (rootChildren.hasNext() && !candidateLimitExceeded) {
    visit(rootChildren.next(), "", config.rootFolderId, 1);
  }

  entries.sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    return pathOrder === 0 ? left.id.localeCompare(right.id) : pathOrder;
  });

  return {
    rootFolderId: config.rootFolderId,
    folders: entries,
    byId,
    excludedFolderIds: Array.from(reservedIds),
    builtAt: new Date().toISOString(),
  };
}

function getTrustedFolderEntry(
  index: FolderIndex,
  folderId: string,
): FolderEntry | null {
  return Object.prototype.hasOwnProperty.call(index.byId, folderId)
    ? index.byId[folderId]
    : null;
}
