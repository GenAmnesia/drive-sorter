interface AppliedFileAction {
  destinationFolderId: string;
  destinationPath: string;
  resultingFilename: string;
  moved: boolean;
  renamed: boolean;
  createdFolder: boolean;
}

class PartialDriveMutationError extends Error {
  readonly destinationFolderId: string;
  readonly destinationPath: string;
  readonly resultingFilename: string;

  constructor(
    message: string,
    destinationFolderId: string,
    destinationPath: string,
    resultingFilename: string,
  ) {
    super(message);
    this.name = "PartialDriveMutationError";
    this.destinationFolderId = destinationFolderId;
    this.destinationPath = destinationPath;
    this.resultingFilename = resultingFilename;
    Object.setPrototypeOf(this, PartialDriveMutationError.prototype);
  }
}

class PartialFolderCreationError extends Error {
  readonly destinationFolderId: string;
  readonly destinationPath: string;
  readonly processingErrorKind: ProcessingErrorKind;
  readonly retryable: boolean;

  constructor(
    cause: unknown,
    destinationFolderId: string,
    destinationPath: string,
  ) {
    super(
      `La cartella Duplicati è stata creata, ma il file non è stato spostato: ${getErrorMessage(cause)}`,
    );
    this.name = "PartialFolderCreationError";
    this.destinationFolderId = destinationFolderId;
    this.destinationPath = destinationPath;
    this.processingErrorKind =
      cause instanceof SorterError && cause.category === "API_ERROR"
        ? "API_ERROR"
        : "INTERNAL_ERROR";
    this.retryable = cause instanceof SorterError && cause.retryable;
    Object.setPrototypeOf(this, PartialFolderCreationError.prototype);
  }
}

function captureSourceFileSnapshot(
  file: GoogleAppsScript.Drive.File,
): SourceFileSnapshot {
  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    sizeBytes: file.getSize(),
    lastUpdatedEpochMs: file.getLastUpdated().getTime(),
  };
}

function fileIsDirectChildOfFolder(
  file: GoogleAppsScript.Drive.File,
  folderId: string,
): boolean {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) {
      return true;
    }
  }
  return false;
}

function folderIsDirectChildOfFolder(
  folder: GoogleAppsScript.Drive.Folder,
  parentFolderId: string,
): boolean {
  const parents = folder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === parentFolderId) {
      return true;
    }
  }
  return false;
}

function findChildFolderByName(
  parent: GoogleAppsScript.Drive.Folder,
  folderName: string,
): GoogleAppsScript.Drive.Folder | null {
  const normalizedName = folderName.trim().toLowerCase();
  const folders = parent.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().trim().toLowerCase() === normalizedName) {
      return folder;
    }
  }
  return null;
}

/** The only low-level folder-creation primitive in the application. */
function createValidatedChildFolder(
  parent: GoogleAppsScript.Drive.Folder,
  requestedName: string,
): GoogleAppsScript.Drive.Folder {
  const safeName = requestedName.trim();
  if (!isSafeFolderName(safeName)) {
    throw new Error("Nome cartella non valido; creazione rifiutata.");
  }
  return parent.createFolder(safeName);
}

function getOrCreateDuplicatesFolder(
  destination: GoogleAppsScript.Drive.Folder,
  config: AppConfig,
): { folder: GoogleAppsScript.Drive.Folder | null; created: boolean } {
  const existing = findChildFolderByName(
    destination,
    config.duplicateFolderName,
  );
  if (existing) {
    return { folder: existing, created: false };
  }
  if (config.dryRun) {
    return { folder: null, created: false };
  }
  return {
    folder: createValidatedChildFolder(
      destination,
      config.duplicateFolderName,
    ),
    created: true,
  };
}

/**
 * Extreme fallback only: when there are zero normal candidates, an explicitly
 * enabled, configured catch-all folder may be created by application code.
 * Gemini never supplies this name or an ID.
 */
function maybeCreateFallbackFolder(
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
): boolean {
  if (
    index.folders.length > 0 ||
    !config.allowFolderCreation ||
    config.dryRun
  ) {
    return false;
  }

  const requestedName = config.fallbackFolderName.trim();
  const reservedNames = new Set([
    "da smistare",
    "da controllare",
    "duplicati",
    context.inbox.getName().trim().toLowerCase(),
    context.review.getName().trim().toLowerCase(),
    config.duplicateFolderName.trim().toLowerCase(),
  ]);
  if (reservedNames.has(requestedName.toLowerCase())) {
    throw new Error("FALLBACK_FOLDER_NAME coincide con una cartella riservata.");
  }

  const existing = findChildFolderByName(context.root, requestedName);
  if (existing) {
    return false;
  }

  createValidatedChildFolder(context.root, requestedName);
  return true;
}

function resolveTrustedDestinationFolder(
  plan: FileActionPlan,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
): {
  folder: GoogleAppsScript.Drive.Folder;
  path: string;
  created: boolean;
} {
  if (!plan.destinationFolderId) {
    throw new Error("Il piano non contiene una destinazione.");
  }

  const isReviewAction =
    plan.action === "REVIEW" || plan.action === "UNSUPPORTED";
  const isReviewDuplicate =
    plan.action === "DUPLICATE" &&
    plan.destinationFolderId === config.reviewFolderId;
  if (isReviewAction || isReviewDuplicate) {
    const currentReview = getFolderOrThrow(
      config.reviewFolderId,
      "REVIEW_FOLDER_ID",
    );
    const expectedReviewPath = isReviewDuplicate
      ? `${currentReview.getName()}/${config.duplicateFolderName}`
      : currentReview.getName();
    if (
      plan.destinationFolderId !== config.reviewFolderId ||
      plan.destinationPath !== expectedReviewPath
    ) {
      throw new Error("Un piano di review deve usare la cartella review configurata.");
    }
    if (
      !isFolderDescendantOf(currentReview, config.rootFolderId)
    ) {
      throw new Error("La cartella review non è più una destinazione valida.");
    }
    if (!isReviewDuplicate) {
      return {
        folder: currentReview,
        path: currentReview.getName(),
        created: false,
      };
    }
    const duplicateFolder = getOrCreateDuplicatesFolder(currentReview, config);
    if (!duplicateFolder.folder) {
      throw new Error("Cartella duplicati review non disponibile fuori da DRY_RUN.");
    }
    return {
      folder: duplicateFolder.folder,
      path: expectedReviewPath,
      created: duplicateFolder.created,
    };
  }
  if (plan.destinationFolderId === config.reviewFolderId) {
    throw new Error("Una classificazione normale non può usare la cartella review.");
  }

  const trustedEntry = getTrustedFolderEntry(index, plan.destinationFolderId);
  const expectedPath = trustedEntry
    ? plan.action === "DUPLICATE"
      ? `${trustedEntry.path}/${config.duplicateFolderName}`
      : trustedEntry.path
    : null;
  if (!trustedEntry || plan.destinationPath !== expectedPath) {
    throw new Error("Destinazione non presente nell'indice Drive affidabile.");
  }

  const trustedFolder = getFolderOrThrow(trustedEntry.id, "targetFolderId");
  assertDestinationStillAllowed(trustedFolder, config, context);
  assertIndexedFolderPathStillMatches(trustedFolder, trustedEntry, index);
  if (plan.action !== "DUPLICATE") {
    return { folder: trustedFolder, path: trustedEntry.path, created: false };
  }

  const duplicateFolder = getOrCreateDuplicatesFolder(trustedFolder, config);
  if (!duplicateFolder.folder) {
    throw new Error("Cartella duplicati non disponibile fuori da DRY_RUN.");
  }
  return {
    folder: duplicateFolder.folder,
    path: `${trustedEntry.path}/${config.duplicateFolderName}`,
    created: duplicateFolder.created,
  };
}

function assertIndexedFolderPathStillMatches(
  folder: GoogleAppsScript.Drive.Folder,
  entry: FolderEntry,
  index: FolderIndex,
): void {
  let currentFolder = folder;
  let currentEntry = entry;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentEntry.id)) {
      throw new Error("Ciclo inatteso nel percorso della destinazione.");
    }
    visited.add(currentEntry.id);
    if (
      currentFolder.getId() !== currentEntry.id ||
      currentFolder.getName() !== currentEntry.name ||
      !currentEntry.parentId ||
      !folderIsDirectChildOfFolder(currentFolder, currentEntry.parentId)
    ) {
      throw new Error(
        "La destinazione è stata rinominata o spostata dopo la classificazione.",
      );
    }
    if (currentEntry.parentId === index.rootFolderId) {
      return;
    }

    const parentEntry = getTrustedFolderEntry(index, currentEntry.parentId);
    if (!parentEntry) {
      throw new Error("Il percorso affidabile della destinazione è incompleto.");
    }
    currentFolder = getFolderOrThrow(parentEntry.id, "destinationParentId");
    currentEntry = parentEntry;
  }
}

function assertDestinationStillAllowed(
  destination: GoogleAppsScript.Drive.Folder,
  config: AppConfig,
  context: DriveFolderContext,
): void {
  if (!isFolderDescendantOf(destination, config.rootFolderId)) {
    throw new Error("La destinazione non si trova più sotto la root configurata.");
  }
  const reservedIds = [
    config.inboxFolderId,
    config.reviewFolderId,
    ...config.excludedFolderIds,
  ];
  if (
    reservedIds.some((folderId) =>
      isFolderDescendantOf(destination, folderId),
    )
  ) {
    throw new Error("La destinazione si trova ora sotto una cartella riservata.");
  }
  const reservedNames = [
    "Da smistare",
    "Da controllare",
    "Duplicati",
    context.inbox.getName(),
    context.review.getName(),
    config.duplicateFolderName,
  ];
  if (
    folderOrAncestorHasAnyReservedName(
      destination,
      reservedNames,
      context.root.getId(),
    )
  ) {
    throw new Error("La destinazione si trova ora sotto una cartella riservata.");
  }
}

function folderOrAncestorHasAnyReservedName(
  folder: GoogleAppsScript.Drive.Folder,
  reservedNames: readonly string[],
  stopFolderId: string,
): boolean {
  const pending: GoogleAppsScript.Drive.Folder[] = [folder];
  const visited = new Set<string>();
  const normalizedReservedNames = new Set(
    reservedNames.map((name) => name.trim().toLowerCase()),
  );
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current.getId())) {
      continue;
    }
    visited.add(current.getId());
    if (current.getId() === stopFolderId) {
      continue;
    }
    if (normalizedReservedNames.has(current.getName().trim().toLowerCase())) {
      return true;
    }
    const parents = current.getParents();
    while (parents.hasNext()) {
      pending.push(parents.next());
    }
  }
  return false;
}

function assertFileStillInInbox(
  file: GoogleAppsScript.Drive.File,
  config: AppConfig,
): void {
  if (file.isTrashed()) {
    throw new Error("Il file non è più disponibile.");
  }
  if (!fileIsDirectChildOfFolder(file, config.inboxFolderId)) {
    throw new Error("Il file non è più un figlio diretto della inbox.");
  }
}

function assertFileMatchesSnapshot(
  file: GoogleAppsScript.Drive.File,
  snapshot: SourceFileSnapshot,
): void {
  const current = captureSourceFileSnapshot(file);
  if (
    current.id !== snapshot.id ||
    current.name !== snapshot.name ||
    current.mimeType !== snapshot.mimeType ||
    current.sizeBytes !== snapshot.sizeBytes ||
    current.lastUpdatedEpochMs !== snapshot.lastUpdatedEpochMs
  ) {
    throw new Error(
      "Il file è cambiato dopo la preparazione; classificazione obsoleta rifiutata.",
    );
  }
}

function assertExactDuplicateStillMatches(
  sourceFile: GoogleAppsScript.Drive.File,
  plan: FileActionPlan,
  config: AppConfig,
  index: FolderIndex,
): void {
  if (
    plan.action !== "DUPLICATE" ||
    !plan.duplicateOfFileId ||
    !plan.destinationFolderId ||
    !plan.exactDuplicateSha256
  ) {
    throw new Error("Il piano duplicato non contiene una prova SHA-256 completa.");
  }
  const isReviewDuplicate = plan.destinationFolderId === config.reviewFolderId;
  const destinationEntry = isReviewDuplicate
    ? null
    : getTrustedFolderEntry(index, plan.destinationFolderId);
  if (!isReviewDuplicate && !destinationEntry) {
    throw new Error("Destinazione duplicato non presente nell'indice affidabile.");
  }
  const originalDestinationFolderId = isReviewDuplicate
    ? config.reviewFolderId
    : destinationEntry?.id;
  if (!originalDestinationFolderId) {
    throw new Error("Destinazione originale del duplicato non valida.");
  }
  const duplicateFile = DriveApp.getFileById(plan.duplicateOfFileId);
  if (
    duplicateFile.isTrashed() ||
    !fileIsDirectChildOfFolder(duplicateFile, originalDestinationFolderId)
  ) {
    throw new Error("Il duplicato originale non si trova più nella destinazione.");
  }
  const sourceHash = computeFileSha256(sourceFile, config.maxHashBytes);
  const duplicateHash = computeFileSha256(
    duplicateFile,
    config.maxHashBytes,
  );
  if (
    sourceHash === null ||
    duplicateHash === null ||
    sourceHash !== plan.exactDuplicateSha256 ||
    duplicateHash !== plan.exactDuplicateSha256
  ) {
    throw new Error(
      "La prova di duplicato è cambiata dopo la classificazione; spostamento rifiutato.",
    );
  }
}

function selectPlannedDestinationFilename(
  originalFilename: string,
  plannedFilename: string | null,
): string {
  return plannedFilename || originalFilename;
}

function assertDriveMutationDeadline(deadlineEpochMs: number): void {
  if (Date.now() + 10_000 >= deadlineEpochMs) {
    throw new SorterError(
      "API_ERROR",
      "RUNTIME_DEADLINE_EXHAUSTED",
      "Il budget runtime non consente una mutazione Drive sicura.",
      { retryable: true },
    );
  }
}

/**
 * Central mutation boundary. Callers must construct a fully validated plan;
 * this function independently re-resolves trusted folders and rechecks state.
 */
function applyFileActionPlan(
  fileId: string,
  plan: FileActionPlan,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
  deadlineEpochMs: number,
): AppliedFileAction {
  if (config.dryRun) {
    throw new Error("Mutazione Drive rifiutata: DRY_RUN è attivo.");
  }
  if (plan.action !== "MOVE" && plan.action !== "REVIEW" && plan.action !== "DUPLICATE" && plan.action !== "UNSUPPORTED") {
    throw new Error(`Azione non mutabile: ${plan.action}`);
  }
  if (plan.action === "DUPLICATE" && !plan.duplicateOfFileId) {
    throw new Error("Un piano duplicato richiede duplicateOfFileId.");
  }

  const file = DriveApp.getFileById(fileId);
  assertFileStillInInbox(file, config);
  assertFileMatchesSnapshot(file, plan.sourceSnapshot);
  if (plan.action === "DUPLICATE") {
    assertExactDuplicateStillMatches(file, plan, config, index);
  }
  assertDriveMutationDeadline(deadlineEpochMs);
  const originalFilename = file.getName();
  const resolved = resolveTrustedDestinationFolder(
    plan,
    config,
    context,
    index,
  );
  // destinationFilename has already been derived by trusted application code.
  // Reinterpreting it as an AI suggestion here would sanitize an unchanged
  // original name and violate RENAME_FILES=false.
  const desiredFilename = selectPlannedDestinationFilename(
    originalFilename,
    plan.destinationFilename,
  );
  let availableFilename: string;
  try {
    availableFilename = generateNonConflictingFilename(
      resolved.folder,
      desiredFilename,
    );
    assertDriveMutationDeadline(deadlineEpochMs);
    file.moveTo(resolved.folder);
  } catch (error: unknown) {
    if (resolved.created) {
      throw new PartialFolderCreationError(
        error,
        resolved.folder.getId(),
        resolved.path,
      );
    }
    throw error;
  }
  const shouldRename = availableFilename !== originalFilename;
  let resultingFilename = availableFilename;
  try {
    if (shouldRename) {
      file.setName(availableFilename);
    }

    if (!fileIsDirectChildOfFolder(file, resolved.folder.getId())) {
      throw new Error("Post-condizione fallita: destinazione Drive non verificata.");
    }
    resultingFilename = file.getName();
  } catch (error: unknown) {
    let observedFilename = resultingFilename;
    try {
      observedFilename = file.getName();
    } catch (_metadataError) {
      // Keep the planned name when post-move metadata cannot be read.
    }
    throw new PartialDriveMutationError(
      `Il file è stato spostato, ma una fase successiva è fallita: ${getErrorMessage(error)}`,
      resolved.folder.getId(),
      resolved.path,
      observedFilename,
    );
  }

  return {
    destinationFolderId: resolved.folder.getId(),
    destinationPath: resolved.path,
    resultingFilename,
    moved: true,
    renamed: shouldRename,
    createdFolder: resolved.created,
  };
}
