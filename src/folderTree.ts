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
    reservedNames.has(normalizeFolderNameForLookup(folder.getName()))
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
    folders.inbox.getName(),
    folders.review.getName(),
    config.duplicateFolderName,
  ].map(normalizeFolderNameForLookup));
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

  const lookups = buildFolderRelationshipLookups(entries);

  return {
    rootFolderId: config.rootFolderId,
    folders: entries,
    byId,
    childrenByParentId: lookups.childrenByParentId,
    childrenByNormalizedNameByParentId:
      lookups.childrenByNormalizedNameByParentId,
    excludedFolderIds: Array.from(reservedIds),
    reservedNormalizedNames: Array.from(reservedNames).sort(),
    isComplete: !candidateLimitExceeded,
    invalidReason: candidateLimitExceeded
      ? `Folder candidate limit MAX_CANDIDATE_FOLDERS=${config.maxCandidateFolders} exceeded.`
      : null,
    builtAt: new Date().toISOString(),
  };
}

function normalizeFolderNameForLookup(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

function buildFolderRelationshipLookups(entries: readonly FolderEntry[]): {
  childrenByParentId: FolderChildrenLookup;
  childrenByNormalizedNameByParentId: FolderChildrenByNameLookup;
} {
  const childrenByParentId: FolderChildrenLookup = Object.create(
    null,
  ) as FolderChildrenLookup;
  const childrenByNormalizedNameByParentId: FolderChildrenByNameLookup =
    Object.create(null) as FolderChildrenByNameLookup;

  entries.forEach((entry) => {
    if (entry.parentId === null) {
      return;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        childrenByParentId,
        entry.parentId,
      )
    ) {
      childrenByParentId[entry.parentId] = [];
    }
    childrenByParentId[entry.parentId].push(entry);

    if (
      !Object.prototype.hasOwnProperty.call(
        childrenByNormalizedNameByParentId,
        entry.parentId,
      )
    ) {
      childrenByNormalizedNameByParentId[entry.parentId] = Object.create(
        null,
      ) as FolderNameLookup;
    }
    const normalizedName = normalizeFolderNameForLookup(entry.name);
    const byName = childrenByNormalizedNameByParentId[entry.parentId];
    if (!Object.prototype.hasOwnProperty.call(byName, normalizedName)) {
      byName[normalizedName] = [];
    }
    byName[normalizedName].push(entry);
  });

  return {
    childrenByParentId,
    childrenByNormalizedNameByParentId,
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

function getTrustedFolderChildren(
  index: FolderIndex,
  parentFolderId: string,
): FolderEntry[] {
  if (
    !Object.prototype.hasOwnProperty.call(
      index.childrenByParentId,
      parentFolderId,
    )
  ) {
    return [];
  }
  return index.childrenByParentId[parentFolderId].slice();
}

function getEquivalentTrustedChildren(
  index: FolderIndex,
  parentFolderId: string,
  childName: string,
): FolderEntry[] {
  const byName = index.childrenByNormalizedNameByParentId[parentFolderId];
  if (!byName) {
    return [];
  }
  const normalizedName = normalizeFolderNameForLookup(childName);
  return Object.prototype.hasOwnProperty.call(byName, normalizedName)
    ? byName[normalizedName].slice()
    : [];
}

function getTrustedSiblingEntries(
  index: FolderIndex,
  folderId: string,
): FolderEntry[] {
  const entry = getTrustedFolderEntry(index, folderId);
  if (entry === null || entry.parentId === null) {
    return [];
  }
  return getTrustedFolderChildren(index, entry.parentId).filter(
    (candidate) => candidate.id !== folderId,
  );
}

/** Keep only unambiguous children whose normalized names occur once. */
function getDistinctNamedFolderEntries(
  entries: readonly FolderEntry[],
): FolderEntry[] {
  const counts: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  entries.forEach((entry) => {
    const normalizedName = normalizeFolderNameForLookup(entry.name);
    counts[normalizedName] = (counts[normalizedName] || 0) + 1;
  });
  return entries.filter(
    (entry) => counts[normalizeFolderNameForLookup(entry.name)] === 1,
  );
}

function parseFourDigitFolderYear(name: string): number | null {
  const normalized = name.trim();
  if (!/^(?:19|20|21)\d{2}$/.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

function detectTemporalSiblingEvidence(
  index: FolderIndex,
  parentFolderId: string,
  minimumEvidence = 2,
): TemporalSiblingEvidence | null {
  if (!Number.isInteger(minimumEvidence) || minimumEvidence < 2) {
    throw new Error(
      "minimumEvidence must be an integer greater than or equal to 2.",
    );
  }
  const parent = getTrustedFolderEntry(index, parentFolderId);
  if (parent === null) {
    // Root and every reserved/excluded folder are intentionally absent byId.
    return null;
  }

  const yearEntries = getDistinctNamedFolderEntries(
    getTrustedFolderChildren(index, parentFolderId),
  )
    .map((entry) => ({ entry, year: parseFourDigitFolderYear(entry.name) }))
    .filter(
      (value): value is { entry: FolderEntry; year: number } =>
        value.year !== null,
    )
    .sort((left, right) =>
      left.year === right.year
        ? left.entry.id.localeCompare(right.entry.id)
        : left.year - right.year,
    );

  if (yearEntries.length < minimumEvidence) {
    return null;
  }
  const observedYears = yearEntries.map((value) => value.year);
  return {
    parentFolderId: parent.id,
    parentFolderPath: parent.path,
    evidenceFolderIds: yearEntries.map((value) => value.entry.id),
    observedYears,
    minimumYear: observedYears[0],
    maximumYear: observedYears[observedYears.length - 1],
  };
}

/**
 * Accept an absent year only when it is inside the observed span or directly
 * adjacent to it, and close to at least one cited sibling year.
 */
function isPlausibleTemporalSiblingYear(
  proposedYear: number,
  evidence: TemporalSiblingEvidence,
  maximumDistance = 2,
): boolean {
  if (
    !Number.isInteger(proposedYear) ||
    proposedYear < 1900 ||
    proposedYear > 2199 ||
    !Number.isInteger(maximumDistance) ||
    maximumDistance < 1 ||
    evidence.observedYears.length < 2 ||
    evidence.observedYears.includes(proposedYear)
  ) {
    return false;
  }

  const insideOrAdjacent =
    proposedYear >= evidence.minimumYear - 1 &&
    proposedYear <= evidence.maximumYear + 1;
  const nearestDistance = evidence.observedYears.reduce(
    (nearest, year) => Math.min(nearest, Math.abs(year - proposedYear)),
    Number.MAX_SAFE_INTEGER,
  );
  return insideOrAdjacent && nearestDistance <= maximumDistance;
}

/**
 * Build a bounded creation topology exclusively from candidate entries. Root,
 * operational, duplicate and excluded folders cannot become contexts because
 * they are never present in FolderIndex.byId.
 */
function buildFolderCreationContexts(
  index: FolderIndex,
  config: AppConfig,
): FolderCreationContext[] {
  if (!index.isComplete) {
    throw new Error(
      index.invalidReason ||
        "Folder index is incomplete; folder-creation context was refused.",
    );
  }

  return index.folders
    .filter((parent) => parent.depth + 1 <= config.folderCreationMaxFinalDepth)
    .map((parent): FolderCreationContext | null => {
      const childFolders = getDistinctNamedFolderEntries(
        getTrustedFolderChildren(index, parent.id),
      );
      if (childFolders.length < config.folderCreationMinSiblingEvidence) {
        return null;
      }
      return {
        parentFolderId: parent.id,
        parentFolderPath: parent.path,
        parentDepth: parent.depth,
        childFolders,
        temporalEvidence: detectTemporalSiblingEvidence(
          index,
          parent.id,
          config.folderCreationMinSiblingEvidence,
        ),
      };
    })
    .filter(
      (context): context is FolderCreationContext => context !== null,
    );
}

/**
 * Atomically add a newly confirmed real folder to all in-memory lookups. Any
 * ambiguity invalidates the index so the batch cannot keep classifying against
 * a partially updated topology.
 */
function addConfirmedFolderEntryToIndex(
  index: FolderIndex,
  entry: FolderEntry,
  config: AppConfig,
): void {
  try {
    if (!index.isComplete) {
      throw new Error(index.invalidReason || "Folder index is incomplete.");
    }
    if (
      entry.id.trim() === "" ||
      getTrustedFolderEntry(index, entry.id) !== null
    ) {
      throw new Error("The confirmed folder ID is blank or already indexed.");
    }
    if (entry.parentId === null || entry.parentId === index.rootFolderId) {
      throw new Error("A confirmed folder must have a non-root candidate parent.");
    }
    const parent = getTrustedFolderEntry(index, entry.parentId);
    if (parent === null) {
      throw new Error("The confirmed folder parent is not a trusted candidate.");
    }
    if (!isSafeFolderName(entry.name)) {
      throw new Error("The confirmed folder name is unsafe.");
    }
    if (
      entry.depth !== parent.depth + 1 ||
      entry.depth > config.maxFolderDepth ||
      entry.depth > config.folderCreationMaxFinalDepth ||
      entry.path !== `${parent.path}/${entry.name}`
    ) {
      throw new Error("The confirmed folder path/depth does not match its parent.");
    }
    if (getEquivalentTrustedChildren(index, parent.id, entry.name).length > 0) {
      throw new Error(
        "An equivalent child is already present in the folder index.",
      );
    }
    if (index.folders.length + 1 > config.maxCandidateFolders) {
      throw new Error(
        "Adding the confirmed folder would exceed MAX_CANDIDATE_FOLDERS.",
      );
    }

    const nextFolders = index.folders.concat(entry).sort((left, right) => {
      const pathOrder = left.path.localeCompare(right.path);
      return pathOrder === 0 ? left.id.localeCompare(right.id) : pathOrder;
    });
    const nextById: FolderLookup = Object.create(null) as FolderLookup;
    nextFolders.forEach((folder) => {
      nextById[folder.id] = folder;
    });
    const nextRelationships = buildFolderRelationshipLookups(nextFolders);

    index.folders = nextFolders;
    index.byId = nextById;
    index.childrenByParentId = nextRelationships.childrenByParentId;
    index.childrenByNormalizedNameByParentId =
      nextRelationships.childrenByNormalizedNameByParentId;
    index.builtAt = new Date().toISOString();
  } catch (error: unknown) {
    index.isComplete = false;
    index.invalidReason = `In-memory folder index update refused: ${getErrorMessage(error)}`;
    throw new Error(index.invalidReason);
  }
}
