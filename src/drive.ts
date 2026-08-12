interface AppliedFileAction {
  destinationFolderId: string;
  destinationPath: string;
  resultingFilename: string;
  moved: boolean;
  renamed: boolean;
  createdFolder: boolean;
  createdFolderId: string | null;
  createdFolderPath: string | null;
  effectiveAction: LogAction;
  createdFolders: CreatedFolderRecord[];
  duplicateOfFileId: string | null;
  possibleDuplicateOfFileIds: string[];
}

class PartialDriveMutationError extends Error {
  readonly destinationFolderId: string;
  readonly destinationPath: string;
  readonly resultingFilename: string;
  readonly effectiveAction: LogAction;
  readonly createdFolders: CreatedFolderRecord[];
  readonly duplicateOfFileId: string | null;
  readonly possibleDuplicateOfFileIds: string[];

  constructor(
    message: string,
    destinationFolderId: string,
    destinationPath: string,
    resultingFilename: string,
    effectiveAction: LogAction,
    createdFolders: readonly CreatedFolderRecord[],
    duplicateOfFileId: string | null,
    possibleDuplicateOfFileIds: readonly string[],
  ) {
    super(message);
    this.name = "PartialDriveMutationError";
    this.destinationFolderId = destinationFolderId;
    this.destinationPath = destinationPath;
    this.resultingFilename = resultingFilename;
    this.effectiveAction = effectiveAction;
    this.createdFolders = createdFolders.slice();
    this.duplicateOfFileId = duplicateOfFileId;
    this.possibleDuplicateOfFileIds = possibleDuplicateOfFileIds.slice();
    Object.setPrototypeOf(this, PartialDriveMutationError.prototype);
  }
}

class PartialFolderCreationError extends Error {
  readonly destinationFolderId: string;
  readonly destinationPath: string;
  readonly processingErrorKind: ProcessingErrorKind;
  readonly retryable: boolean;
  readonly purpose: "DUPLICATES" | "TAXONOMY";
  readonly createdFolders: CreatedFolderRecord[];

  constructor(
    cause: unknown,
    destinationFolderId: string,
    destinationPath: string,
    purpose: "DUPLICATES" | "TAXONOMY" = "DUPLICATES",
    createdFolders?: readonly CreatedFolderRecord[],
  ) {
    super(
      `A ${purpose.toLowerCase()} folder was created, but the file was not moved: ${getErrorMessage(cause)}`,
    );
    this.name = "PartialFolderCreationError";
    this.destinationFolderId = destinationFolderId;
    this.destinationPath = destinationPath;
    this.purpose = purpose;
    this.createdFolders =
      createdFolders === undefined
        ? [{ id: destinationFolderId, path: destinationPath, purpose }]
        : createdFolders.slice();
    this.processingErrorKind =
      cause instanceof SorterError && cause.category === "API_ERROR"
        ? "API_ERROR"
        : "INTERNAL_ERROR";
    this.retryable = cause instanceof SorterError && cause.retryable;
    Object.setPrototypeOf(this, PartialFolderCreationError.prototype);
  }
}

function findEquivalentChildFolders(
  parent: GoogleAppsScript.Drive.Folder,
  folderName: string,
): GoogleAppsScript.Drive.Folder[] {
  const normalizedName = normalizeFolderNameForLookup(folderName);
  const matches: GoogleAppsScript.Drive.Folder[] = [];
  const folders = parent.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (normalizeFolderNameForLookup(folder.getName()) === normalizedName) {
      matches.push(folder);
    }
  }
  return matches;
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
  assertPersistentAuditLogHealthy();
  return parent.createFolder(safeName);
}

/** Resolve the reserved direct child used only for per-run audit documents. */
function ensureAuditLogFolder(
  config: AppConfig,
  context: DriveFolderContext,
): { folder: GoogleAppsScript.Drive.Folder; created: boolean } {
  const existing = context.logFolder || findUniqueDirectChildFolderByName(
    context.root,
    config.logFolderName,
  );
  if (existing !== null) {
    if (!folderIsDirectChildOfFolder(existing, context.root.getId())) {
      throw new Error("The configured log folder is no longer a direct child of ROOT_FOLDER_ID.");
    }
    context.logFolder = existing;
    return { folder: existing, created: false };
  }
  const created = createValidatedChildFolder(context.root, config.logFolderName);
  const verified = findUniqueDirectChildFolderByName(context.root, config.logFolderName);
  if (verified === null || verified.getId() !== created.getId()) {
    throw new Error("The new log folder could not be uniquely verified under ROOT_FOLDER_ID.");
  }
  context.logFolder = verified;
  return { folder: verified, created: true };
}

/**
 * Build a deterministic-but-unique enough name for the append-only audit
 * document. It deliberately contains no user document name or secret.
 */
function buildPersistentAuditLogFilename(
  runId: string,
  startedAtEpochMs: number,
): string {
  const timestamp = new Date(startedAtEpochMs)
    .toISOString()
    .replace(/[:.]/g, "-");
  const safeRunId = runId
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(-48);
  return `Drive Sorter Audit ${timestamp} ${safeRunId}`.slice(0, 180);
}

/**
 * Create the one audit document for a run and place only that new file in the
 * configured root. This is the only intentional audit-only write exception to
 * DRY_RUN. Folder-proposal SUGGEST mode may still route classified documents;
 * it only prevents the proposal itself from creating taxonomy folders.
 */
function createPersistentAuditDocument(
  root: GoogleAppsScript.Drive.Folder,
  logFolder: GoogleAppsScript.Drive.Folder,
  runId: string,
  startedAtEpochMs: number,
): PersistentAuditLogInfo {
  const filename = buildPersistentAuditLogFilename(runId, startedAtEpochMs);
  const document = DocumentApp.create(filename);
  const documentId = document.getId();
  // A new Google Doc may contain an initial empty paragraph. Remove it so the
  // persisted document contains only the logger messages mirrored from console.
  document.getBody().clear();
  document.saveAndClose();

  const auditFile = DriveApp.getFileById(documentId);
  auditFile.moveTo(logFolder);
  if (!fileIsDirectChildOfFolder(auditFile, logFolder.getId())) {
    throw new Error(
      "The newly created audit document could not be verified in the reserved log folder.",
    );
  }

  return {
    runId,
    documentId,
    fileId: auditFile.getId(),
    filename: auditFile.getName(),
    rootFolderId: root.getId(),
    logFolderId: logFolder.getId(),
    logFolderPath: `${root.getName()}/${logFolder.getName()}`,
    startedAt: isoTimestamp(new Date(startedAtEpochMs)),
    linesWritten: 0,
  };
}

/**
 * Persist exactly one already-sanitized logger message. Opening and closing
 * for each message makes completed records durable even if a later batch step
 * fails.
 */
function appendPersistentAuditDocumentLine(
  documentId: string,
  serializedRecord: string,
): void {
  if (serializedRecord.trim() === "") {
    throw new Error("Refusing to append an empty persistent audit record.");
  }
  const document = DocumentApp.openById(documentId);
  document.getBody().appendParagraph(serializedRecord);
  document.saveAndClose();
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
    "logs",
    config.logFolderName.trim().toLowerCase(),
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
    ...(context.logFolder === null ? [] : [context.logFolder.getId()]),
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
    "logs",
    config.logFolderName,
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

function invalidateFolderIndexAfterCreationRace(
  index: FolderIndex,
  reason: string,
): void {
  index.isComplete = false;
  index.invalidReason = truncateString(reason, 500);
}

function assertLiveFolderCreationEvidence(
  validated: ValidatedFolderCreationProposal,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
): GoogleAppsScript.Drive.Folder {
  const parent = getFolderOrThrow(
    validated.parentFolder.id,
    "folderCreationParentFolderId",
  );
  assertDestinationStillAllowed(parent, config, context);
  assertIndexedFolderPathStillMatches(parent, validated.parentFolder, index);

  for (const evidenceEntry of validated.evidenceFolders) {
    const evidence = getFolderOrThrow(
      evidenceEntry.id,
      "folderCreationEvidenceFolderId",
    );
    assertIndexedFolderPathStillMatches(evidence, evidenceEntry, index);
    if (!folderIsDirectChildOfFolder(evidence, validated.parentFolder.id)) {
      throw new Error(
        "Folder-creation evidence is no longer a direct child of the trusted parent.",
      );
    }
  }
  return parent;
}

function assertCreatedFolderStillUnique(
  folder: GoogleAppsScript.Drive.Folder,
  parent: GoogleAppsScript.Drive.Folder,
  expectedName: string,
  expectedId: string,
): void {
  const equivalents = findEquivalentChildFolders(parent, expectedName);
  if (
    folder.isTrashed() ||
    folder.getId() !== expectedId ||
    folder.getName() !== expectedName ||
    !folderIsDirectChildOfFolder(folder, parent.getId()) ||
    equivalents.length !== 1 ||
    equivalents[0].getId() !== expectedId
  ) {
    throw new Error(
      "The created taxonomy folder is no longer the unique trusted child.",
    );
  }
}

function assertDynamicExactDuplicateStillMatches(
  sourceFile: GoogleAppsScript.Drive.File,
  duplicate: ExactDuplicateResult,
  originalDestinationFolderId: string,
  config: AppConfig,
): void {
  if (
    !duplicate.isDuplicate ||
    duplicate.duplicateOfFileId === null ||
    duplicate.sourceSha256 === null
  ) {
    throw new Error("Dynamic duplicate proof is incomplete.");
  }
  const existingFile = DriveApp.getFileById(duplicate.duplicateOfFileId);
  if (
    existingFile.isTrashed() ||
    !fileIsDirectChildOfFolder(existingFile, originalDestinationFolderId)
  ) {
    throw new Error(
      "The dynamic duplicate original is no longer in the created destination.",
    );
  }
  const sourceHash = computeFileSha256(sourceFile, config.maxHashBytes);
  const existingHash = computeFileSha256(existingFile, config.maxHashBytes);
  if (
    sourceHash === null ||
    existingHash === null ||
    sourceHash !== duplicate.sourceSha256 ||
    existingHash !== duplicate.sourceSha256
  ) {
    throw new Error("Dynamic exact-duplicate proof changed before the move.");
  }
}

function createTrustedProposedDestinationFolder(
  file: GoogleAppsScript.Drive.File,
  plan: FileActionPlan,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
  deadlineEpochMs: number,
): {
  folder: GoogleAppsScript.Drive.Folder;
  path: string;
  created: true;
  createdFolder: CreatedFolderRecord;
  validatedProposal: ValidatedFolderCreationProposal;
  parent: GoogleAppsScript.Drive.Folder;
} {
  if (
    plan.action !== "CREATE_FOLDER_AND_MOVE" ||
    config.folderCreationMode !== "AUTO" ||
    plan.folderCreationProposal == null
  ) {
    throw new Error(
      "Folder creation requires an AUTO plan with a validated proposal.",
    );
  }

  // Autonomous v1 authorizes one missing direct child only. A larger configured
  // suggestion can still be inspected in SUGGEST mode but cannot reach Drive.
  if (plan.folderCreationProposal.proposedSegments.length !== 1) {
    throw new Error(
      "Autonomous folder creation is limited to one missing leaf segment.",
    );
  }

  const contexts = buildFolderCreationContexts(index, config);
  const validation = validateFolderCreationProposal(
    plan.folderCreationProposal,
    contexts,
    index,
    config,
  );
  if (!validation.valid) {
    throw new Error(
      `Folder proposal failed mutation-boundary validation: ${validation.errors.join("; ")}`,
    );
  }
  const validated = validation.value;
  const proposedName = validated.proposal.proposedSegments[0];
  if (
    validated.proposal.patternType === "OTHER" ||
    validated.proposal.confidence < config.folderCreationConfidenceThreshold ||
    plan.destinationFolderId !== validated.parentFolder.id ||
    plan.destinationPath !== validated.finalPath
  ) {
    throw new Error(
      "Folder proposal does not match the trusted AUTO action plan.",
    );
  }

  let parent: GoogleAppsScript.Drive.Folder;
  try {
    parent = assertLiveFolderCreationEvidence(
      validated,
      config,
      context,
      index,
    );
  } catch (error: unknown) {
    invalidateFolderIndexAfterCreationRace(
      index,
      "Folder-creation parent or evidence changed after proposal validation.",
    );
    throw error;
  }
  assertFileStillInInbox(file, config);
  assertFileMatchesSnapshot(file, plan.sourceSnapshot);
  assertDriveMutationDeadline(deadlineEpochMs);

  if (index.folders.length + 1 > config.maxCandidateFolders) {
    throw new Error(
      "Creating the proposed folder would exceed MAX_CANDIDATE_FOLDERS.",
    );
  }

  if (findEquivalentChildFolders(parent, proposedName).length > 0) {
    invalidateFolderIndexAfterCreationRace(
      index,
      "An equivalent child appeared after the folder index was built.",
    );
    throw new SorterError(
      "API_ERROR",
      "FOLDER_CREATION_RACE",
      "An equivalent child appeared before creation; file left in inbox for a fresh run.",
      { retryable: true },
    );
  }

  const createdFolder = createValidatedChildFolder(parent, proposedName);
  let createdFolderId = "<unavailable>";
  let addedToIndex = false;
  try {
    createdFolderId = createdFolder.getId();
    assertCreatedFolderStillUnique(
      createdFolder,
      parent,
      proposedName,
      createdFolderId,
    );

    const confirmedEntry: FolderEntry = {
      id: createdFolderId,
      name: proposedName,
      path: validated.finalPath,
      parentId: validated.parentFolder.id,
      depth: validated.finalDepth,
    };
    addConfirmedFolderEntryToIndex(index, confirmedEntry, config);
    addedToIndex = true;

    // Creation is not a transaction. Re-check every authorization input before
    // allowing the subsequent file move.
    assertFileStillInInbox(file, config);
    assertFileMatchesSnapshot(file, plan.sourceSnapshot);
    assertLiveFolderCreationEvidence(
      {
        ...validated,
        // validate the pre-creation parent/evidence only; the newly indexed
        // child is not itself authorization evidence.
      },
      config,
      context,
      index,
    );
    assertDriveMutationDeadline(deadlineEpochMs);
  } catch (error: unknown) {
    invalidateFolderIndexAfterCreationRace(
      index,
      addedToIndex
        ? "A post-creation check failed; the batch must rebuild its trusted folder index."
        : "A taxonomy folder may have been created but could not be added safely to the in-memory index.",
    );
    throw new PartialFolderCreationError(
      error,
      createdFolderId,
      validated.finalPath,
      "TAXONOMY",
    );
  }

  return {
    folder: createdFolder,
    path: validated.finalPath,
    created: true,
    createdFolder: {
      id: createdFolderId,
      path: validated.finalPath,
      purpose: "TAXONOMY",
    },
    validatedProposal: validated,
    parent,
  };
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
  assertPersistentAuditLogHealthy();
  if (
    plan.action !== "MOVE" &&
    plan.action !== "REVIEW" &&
    plan.action !== "DUPLICATE" &&
    plan.action !== "UNSUPPORTED" &&
    plan.action !== "CREATE_FOLDER_AND_MOVE"
  ) {
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
  const createdResolution =
    plan.action === "CREATE_FOLDER_AND_MOVE"
      ? createTrustedProposedDestinationFolder(
          file,
          plan,
          config,
          context,
          index,
          deadlineEpochMs,
        )
      : null;
  const resolved =
    createdResolution ??
    resolveTrustedDestinationFolder(plan, config, context, index);
  let destinationFolder = resolved.folder;
  let destinationPath = resolved.path;
  let effectiveAction: LogAction = plan.action;
  let effectiveDuplicateOfFileId = plan.duplicateOfFileId;
  let effectivePossibleDuplicateIds = plan.possibleDuplicateOfFileIds.slice();
  const createdFolders: CreatedFolderRecord[] = [];
  if (createdResolution !== null) {
    createdFolders.push(createdResolution.createdFolder);
  } else if (resolved.created) {
    createdFolders.push({
      id: resolved.folder.getId(),
      path: resolved.path,
      purpose: "DUPLICATES",
    });
  }
  // destinationFilename has already been derived by trusted application code.
  // Reinterpreting it as an AI suggestion here would sanitize an unchanged
  // original name and violate RENAME_FILES=false.
  let desiredFilename = selectPlannedDestinationFilename(
    originalFilename,
    plan.destinationFilename,
  );
  let availableFilename: string;
  let dynamicDuplicate: ExactDuplicateResult | null = null;
  try {
    if (createdResolution !== null) {
      // A manual/concurrent actor may put a file into the new folder between
      // creation and move. Preserve the normal exact-duplicate and collision
      // policies instead of assuming the destination stayed empty.
      dynamicDuplicate = findExactDuplicate(
        file,
        createdResolution.folder,
        config,
        deadlineEpochMs,
      );
      effectivePossibleDuplicateIds = uniqueStrings([
        ...effectivePossibleDuplicateIds,
        ...dynamicDuplicate.possibleDuplicateFileIds,
      ]);
      if (dynamicDuplicate.isDuplicate) {
        assertDynamicExactDuplicateStillMatches(
          file,
          dynamicDuplicate,
          createdResolution.folder.getId(),
          config,
        );
        const duplicateDestination = getOrCreateDuplicatesFolder(
          createdResolution.folder,
          config,
        );
        if (duplicateDestination.folder === null) {
          throw new Error("Dynamic duplicate destination could not be resolved.");
        }
        destinationFolder = duplicateDestination.folder;
        destinationPath = `${createdResolution.path}/${config.duplicateFolderName}`;
        effectiveAction = "DUPLICATE";
        effectiveDuplicateOfFileId = dynamicDuplicate.duplicateOfFileId;
        desiredFilename = generateNonConflictingFilename(
          createdResolution.folder,
          originalFilename,
        );
        if (duplicateDestination.created) {
          createdFolders.push({
            id: duplicateDestination.folder.getId(),
            path: destinationPath,
            purpose: "DUPLICATES",
          });
        }
      }
    }

    availableFilename = generateNonConflictingFilename(
      destinationFolder,
      desiredFilename,
    );

    if (createdResolution !== null) {
      assertFileStillInInbox(file, config);
      assertFileMatchesSnapshot(file, plan.sourceSnapshot);
      assertLiveFolderCreationEvidence(
        createdResolution.validatedProposal,
        config,
        context,
        index,
      );
      assertCreatedFolderStillUnique(
        createdResolution.folder,
        createdResolution.parent,
        createdResolution.validatedProposal.proposal.proposedSegments[0],
        createdResolution.createdFolder.id,
      );
      if (dynamicDuplicate?.isDuplicate) {
        assertDynamicExactDuplicateStillMatches(
          file,
          dynamicDuplicate,
          createdResolution.folder.getId(),
          config,
        );
      }
      if (
        destinationFolder !== createdResolution.folder &&
        (!folderIsDirectChildOfFolder(
          destinationFolder,
          createdResolution.folder.getId(),
        ) ||
          normalizeFolderNameForLookup(destinationFolder.getName()) !==
            normalizeFolderNameForLookup(config.duplicateFolderName))
      ) {
        throw new Error(
          "The dynamic duplicate folder is no longer the trusted direct child.",
        );
      }
    }
    assertDriveMutationDeadline(deadlineEpochMs);
    file.moveTo(destinationFolder);
  } catch (error: unknown) {
    if (createdFolders.length > 0) {
      if (createdResolution !== null) {
        invalidateFolderIndexAfterCreationRace(
          index,
          "A post-creation destination, evidence, duplicate, collision, or move check failed.",
        );
      }
      const lastCreated = createdFolders[createdFolders.length - 1];
      throw new PartialFolderCreationError(
        error,
        lastCreated.id,
        lastCreated.path,
        lastCreated.purpose,
        createdFolders,
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

    if (!fileIsDirectChildOfFolder(file, destinationFolder.getId())) {
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
    if (createdResolution !== null) {
      invalidateFolderIndexAfterCreationRace(
        index,
        "A post-move check failed after taxonomy folder creation; rebuild required.",
      );
    }
    throw new PartialDriveMutationError(
      `Il file è stato spostato, ma una fase successiva è fallita: ${getErrorMessage(error)}`,
      destinationFolder.getId(),
      destinationPath,
      observedFilename,
      effectiveAction,
      createdFolders,
      effectiveDuplicateOfFileId,
      effectivePossibleDuplicateIds,
    );
  }

  return {
    destinationFolderId: destinationFolder.getId(),
    destinationPath,
    resultingFilename,
    moved: true,
    renamed: shouldRename,
    createdFolder: createdFolders.length > 0,
    createdFolderId: createdFolders[0]?.id ?? null,
    createdFolderPath: createdFolders[0]?.path ?? null,
    effectiveAction,
    createdFolders,
    duplicateOfFileId: effectiveDuplicateOfFileId,
    possibleDuplicateOfFileIds: effectivePossibleDuplicateIds,
  };
}
