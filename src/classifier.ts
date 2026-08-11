interface FileProcessingSummary {
  processed: number;
  moved: number;
  reviewed: number;
  duplicates: number;
  unsupported: number;
  errors: number;
  skipped: number;
}

function emptyFileProcessingSummary(): FileProcessingSummary {
  return {
    processed: 0,
    moved: 0,
    reviewed: 0,
    duplicates: 0,
    unsupported: 0,
    errors: 0,
    skipped: 0,
  };
}

function summarizePlan(plan: FileActionPlan): FileProcessingSummary {
  const summary = emptyFileProcessingSummary();
  summary.processed = 1;
  if (plan.action === "MOVE") {
    summary.moved = 1;
  } else if (plan.action === "REVIEW") {
    summary.reviewed = 1;
  } else if (plan.action === "DUPLICATE") {
    summary.duplicates = 1;
  } else if (plan.action === "UNSUPPORTED") {
    summary.unsupported = 1;
  }
  return summary;
}

function mergeFileProcessingSummary(
  target: FileProcessingSummary,
  addition: FileProcessingSummary,
): void {
  target.processed += addition.processed;
  target.moved += addition.moved;
  target.reviewed += addition.reviewed;
  target.duplicates += addition.duplicates;
  target.unsupported += addition.unsupported;
  target.errors += addition.errors;
  target.skipped += addition.skipped;
}

function buildReviewPlan(
  file: GoogleAppsScript.Drive.File,
  sourceSnapshot: SourceFileSnapshot,
  classification: ClassificationResult | null,
  kind: "CLASSIFICATION_UNCERTAIN" | "UNSUPPORTED",
  reason: string,
  config: AppConfig,
  context: DriveFolderContext,
  deadlineEpochMs: number,
): FileActionPlan {
  const reviewPath = context.review.getName();
  const duplicate = findExactDuplicate(
    file,
    context.review,
    config,
    deadlineEpochMs,
  );
  if (duplicate.isDuplicate) {
    const duplicateFilename = generateNonConflictingFilename(
      context.review,
      file.getName(),
    );
    const duplicatesFolder = findChildFolderByName(
      context.review,
      config.duplicateFolderName,
    );
    const finalDuplicateFilename = duplicatesFolder
      ? generateNonConflictingFilename(duplicatesFolder, duplicateFilename)
      : duplicateFilename;
    return {
      action: "DUPLICATE",
      destinationFolderId: config.reviewFolderId,
      destinationPath: `${reviewPath}/${config.duplicateFolderName}`,
      destinationFilename: finalDuplicateFilename,
      duplicateOfFileId: duplicate.duplicateOfFileId,
      exactDuplicateSha256: duplicate.sourceSha256,
      possibleDuplicateOfFileIds: duplicate.possibleDuplicateFileIds,
      sourceSnapshot,
      classification,
      errorKind: kind,
      reason: `${reason} Exact SHA-256 duplicate detected in review.`,
      requiresFolderCreation: duplicatesFolder === null,
    };
  }

  const safeReviewFilename = generateNonConflictingFilename(
    context.review,
    file.getName(),
  );
  const possibleSuffix =
    duplicate.possibleDuplicateFileIds.length > 0
      ? " Possible same-name duplicate logged; hashes did not match or were unavailable."
      : "";
  return {
    action: kind === "UNSUPPORTED" ? "UNSUPPORTED" : "REVIEW",
    destinationFolderId: config.reviewFolderId,
    destinationPath: reviewPath,
    destinationFilename: safeReviewFilename,
    duplicateOfFileId: null,
    exactDuplicateSha256: null,
    possibleDuplicateOfFileIds: duplicate.possibleDuplicateFileIds,
    sourceSnapshot,
    classification,
    errorKind: kind,
    reason: `${reason}${possibleSuffix}`,
    requiresFolderCreation: false,
  };
}

function buildClassifiedPlan(
  file: GoogleAppsScript.Drive.File,
  sourceSnapshot: SourceFileSnapshot,
  classification: ClassificationResult,
  config: AppConfig,
  index: FolderIndex,
  deadlineEpochMs: number,
): FileActionPlan {
  if (!classification.targetFolderId || !classification.targetFolderPath) {
    throw new Error("La classificazione non contiene una destinazione.");
  }

  const trustedEntry = getTrustedFolderEntry(
    index,
    classification.targetFolderId,
  );
  if (!trustedEntry || trustedEntry.path !== classification.targetFolderPath) {
    throw new Error("La destinazione non è presente nell'indice affidabile.");
  }

  const destination = getFolderOrThrow(trustedEntry.id, "targetFolderId");
  const duplicate = findExactDuplicate(
    file,
    destination,
    config,
    deadlineEpochMs,
  );

  if (duplicate.isDuplicate) {
    // Reserve names from the parent too, producing the familiar document (2)
    // name when the byte-identical original has the same filename.
    const duplicateFilename = generateNonConflictingFilename(
      destination,
      file.getName(),
    );
    const duplicatesFolder = findChildFolderByName(
      destination,
      config.duplicateFolderName,
    );
    const finalDuplicateFilename = duplicatesFolder
      ? generateNonConflictingFilename(duplicatesFolder, duplicateFilename)
      : duplicateFilename;
    return {
      action: "DUPLICATE",
      destinationFolderId: trustedEntry.id,
      destinationPath: `${trustedEntry.path}/${config.duplicateFolderName}`,
      destinationFilename: finalDuplicateFilename,
      duplicateOfFileId: duplicate.duplicateOfFileId,
      exactDuplicateSha256: duplicate.sourceSha256,
      possibleDuplicateOfFileIds: duplicate.possibleDuplicateFileIds,
      sourceSnapshot,
      classification,
      errorKind: null,
      reason: "Exact SHA-256 duplicate detected.",
      requiresFolderCreation: duplicatesFolder === null,
    };
  }

  const modelSuggestion = config.renameFiles
    ? classification.suggestedFilename
    : null;
  const safeFilename = buildSafeFilename(file.getName(), modelSuggestion);
  const availableFilename = generateNonConflictingFilename(
    destination,
    safeFilename,
  );
  const possibleSuffix =
    duplicate.possibleDuplicateFileIds.length > 0
      ? " Possible same-name duplicate logged; hashes did not match or were unavailable."
      : "";

  return {
    action: "MOVE",
    destinationFolderId: trustedEntry.id,
    destinationPath: trustedEntry.path,
    destinationFilename: availableFilename,
    duplicateOfFileId: null,
    exactDuplicateSha256: null,
    possibleDuplicateOfFileIds: duplicate.possibleDuplicateFileIds,
    sourceSnapshot,
    classification,
    errorKind: null,
    reason: `${classification.reason}${possibleSuffix}`,
    requiresFolderCreation: false,
  };
}

function processFile(
  file: GoogleAppsScript.Drive.File,
  runId: string,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
  deadlineEpochMs: number,
): FileProcessingSummary {
  const startedAt = Date.now();
  const fileId = file.getId();
  const originalFilename = file.getName();
  const mimeType = file.getMimeType();
  let sizeBytes: number | null = null;
  let sourceSnapshot: SourceFileSnapshot | null = null;

  try {
    sourceSnapshot = captureSourceFileSnapshot(file);
    sizeBytes = sourceSnapshot.sizeBytes;
    const prepared = prepareDocument(file, config);
    const classification = classifyFile(
      prepared,
      index.folders,
      config,
      deadlineEpochMs,
    );

    if (
      classification.targetFolderId === null ||
      classification.targetFolderPath === null ||
      classification.confidence < config.confidenceThreshold
    ) {
      const plan = buildReviewPlan(
        file,
        sourceSnapshot,
        classification,
        "CLASSIFICATION_UNCERTAIN",
        `Classification confidence ${classification.confidence.toFixed(3)} is below ${config.confidenceThreshold.toFixed(3)} or no target was selected.`,
        config,
        context,
        deadlineEpochMs,
      );
      return executeAndLogFilePlan(
        file,
        plan,
        runId,
        config,
        context,
        index,
        startedAt,
        sizeBytes,
        null,
        deadlineEpochMs,
      );
    }

    const plan = buildClassifiedPlan(
      file,
      sourceSnapshot,
      classification,
      config,
      index,
      deadlineEpochMs,
    );
    return executeAndLogFilePlan(
      file,
      plan,
      runId,
      config,
      context,
      index,
      startedAt,
      sizeBytes,
      null,
      deadlineEpochMs,
    );
  } catch (error: unknown) {
    if (
      sourceSnapshot !== null &&
      error instanceof SorterError &&
      error.category === "UNSUPPORTED"
    ) {
      const plan = buildReviewPlan(
        file,
        sourceSnapshot,
        null,
        "UNSUPPORTED",
        `${error.code}: ${error.message}`,
        config,
        context,
        deadlineEpochMs,
      );
      return executeAndLogFilePlan(
        file,
        plan,
        runId,
        config,
        context,
        index,
        startedAt,
        sizeBytes,
        error,
        deadlineEpochMs,
      );
    }

    if (
      sourceSnapshot !== null &&
      error instanceof SorterError &&
      error.category === "INVALID_RESPONSE"
    ) {
      const plan = buildReviewPlan(
        file,
        sourceSnapshot,
        null,
        "CLASSIFICATION_UNCERTAIN",
        `${error.code}: invalid or unsafe Gemini response.`,
        config,
        context,
        deadlineEpochMs,
      );
      return executeAndLogFilePlan(
        file,
        plan,
        runId,
        config,
        context,
        index,
        startedAt,
        sizeBytes,
        error,
        deadlineEpochMs,
      );
    }

    const errorKind: ProcessingErrorKind =
      error instanceof SorterError && error.category === "API_ERROR"
        ? "API_ERROR"
        : "INTERNAL_ERROR";
    const summary = emptyFileProcessingSummary();
    summary.processed = 1;
    summary.errors = 1;
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId,
        originalFilename,
        mimeType,
        sizeBytes,
        classification: null,
        action: "ERROR",
        wouldAction: null,
        destinationFolderId: null,
        destinationPath: null,
        resultingFilename: null,
        duplicateOfFileId: null,
        possibleDuplicateOfFileIds: [],
        errorKind,
        error: toStructuredLogError(
          error,
          errorKind,
          error instanceof SorterError && error.retryable,
        ),
        dryRun: config.dryRun,
        durationMs: Date.now() - startedAt,
        reason:
          errorKind === "API_ERROR"
            ? "Infrastructure/API failure; file intentionally left in inbox."
            : "Unexpected failure; file intentionally left in inbox when possible.",
      }),
    );
    return summary;
  }
}

function executeAndLogFilePlan(
  file: GoogleAppsScript.Drive.File,
  plan: FileActionPlan,
  runId: string,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
  startedAt: number,
  sizeBytes: number | null,
  sourceError: unknown,
  deadlineEpochMs: number,
): FileProcessingSummary {
  const summary = summarizePlan(plan);
  const originalFilename = file.getName();
  const originalMimeType = file.getMimeType();

  if (config.dryRun) {
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId: file.getId(),
        originalFilename,
        mimeType: originalMimeType,
        sizeBytes,
        classification: plan.classification,
        action: "DRY_RUN",
        wouldAction: plan.action,
        destinationFolderId:
          plan.action === "DUPLICATE" && plan.requiresFolderCreation
            ? null
            : plan.destinationFolderId,
        destinationPath: plan.destinationPath,
        resultingFilename: plan.destinationFilename,
        duplicateOfFileId: plan.duplicateOfFileId,
        possibleDuplicateOfFileIds: plan.possibleDuplicateOfFileIds,
        errorKind: plan.errorKind,
        error:
          sourceError === null || plan.errorKind === null
            ? null
            : toStructuredLogError(sourceError, plan.errorKind, false),
        dryRun: true,
        durationMs: Date.now() - startedAt,
        reason: plan.reason,
      }),
    );
    return summary;
  }

  let applied: AppliedFileAction | null = null;
  try {
    assertRuntimeBudgetForMutation(deadlineEpochMs);
    applied = applyFileActionPlan(
      file.getId(),
      plan,
      config,
      context,
      index,
      deadlineEpochMs,
    );
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId: file.getId(),
        originalFilename,
        mimeType: originalMimeType,
        sizeBytes,
        classification: plan.classification,
        action: plan.action,
        wouldAction: null,
        destinationFolderId: applied.destinationFolderId,
        destinationPath: applied.destinationPath,
        resultingFilename: applied.resultingFilename,
        duplicateOfFileId: plan.duplicateOfFileId,
        possibleDuplicateOfFileIds: plan.possibleDuplicateOfFileIds,
        errorKind: plan.errorKind,
        error:
          sourceError === null || plan.errorKind === null
            ? null
            : toStructuredLogError(sourceError, plan.errorKind, false),
        dryRun: false,
        durationMs: Date.now() - startedAt,
        reason: plan.reason,
      }),
    );
    return summary;
  } catch (error: unknown) {
    const partial =
      error instanceof PartialDriveMutationError ? error : null;
    const partialFolder =
      error instanceof PartialFolderCreationError ? error : null;
    const failureKind: ProcessingErrorKind =
      partialFolder?.processingErrorKind ??
      (error instanceof SorterError && error.category === "API_ERROR"
        ? "API_ERROR"
        : "INTERNAL_ERROR");
    const failed = emptyFileProcessingSummary();
    failed.processed = 1;
    failed.errors = 1;
    if (partial !== null || applied !== null) {
      const appliedAction = summarizePlan(plan);
      failed.moved = appliedAction.moved;
      failed.reviewed = appliedAction.reviewed;
      failed.duplicates = appliedAction.duplicates;
      failed.unsupported = appliedAction.unsupported;
    }
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId: file.getId(),
        originalFilename,
        mimeType: originalMimeType,
        sizeBytes,
        classification: plan.classification,
        action: "ERROR",
        wouldAction: plan.action,
        destinationFolderId:
          partial?.destinationFolderId ??
          partialFolder?.destinationFolderId ??
          applied?.destinationFolderId ??
          plan.destinationFolderId,
        destinationPath:
          partial?.destinationPath ??
          partialFolder?.destinationPath ??
          applied?.destinationPath ??
          plan.destinationPath,
        resultingFilename:
          partial?.resultingFilename ?? applied?.resultingFilename ?? null,
        duplicateOfFileId: plan.duplicateOfFileId,
        possibleDuplicateOfFileIds: plan.possibleDuplicateOfFileIds,
        errorKind: failureKind,
        error: toStructuredLogError(
          error,
          failureKind,
          (error instanceof SorterError && error.retryable) ||
            (partialFolder?.retryable ?? false),
        ),
        dryRun: false,
        durationMs: Date.now() - startedAt,
        reason:
          partial !== null || applied !== null
            ? "PARTIAL_MUTATION: the file moved, but rename, verification, or logging did not complete; inspect the recorded destination."
            : partialFolder !== null
              ? "PARTIAL_FOLDER_CREATION: Duplicati was created, but the file stayed in inbox; the next run can reuse the folder."
            : "The guarded Drive mutation was refused or failed before a confirmed move; file remains in inbox when possible.",
      }),
    );
    return failed;
  }
}

function assertRuntimeBudgetForMutation(deadlineEpochMs: number): void {
  if (Date.now() + 10_000 >= deadlineEpochMs) {
    throw new SorterError(
      "API_ERROR",
      "RUNTIME_DEADLINE_EXHAUSTED",
      "The runtime deadline does not allow a safe Drive mutation.",
      { retryable: true },
    );
  }
}
