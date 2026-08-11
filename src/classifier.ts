interface FileProcessingSummary {
  processed: number;
  moved: number;
  reviewed: number;
  duplicates: number;
  unsupported: number;
  errors: number;
  skipped: number;
  folderProposals: number;
  acceptedFolderProposals: number;
  rejectedFolderProposals: number;
  folderProposalApiErrors: number;
  createdFolders: number;
  partialFolderCreations: number;
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
    folderProposals: 0,
    acceptedFolderProposals: 0,
    rejectedFolderProposals: 0,
    folderProposalApiErrors: 0,
    createdFolders: 0,
    partialFolderCreations: 0,
  };
}

function summarizePlan(plan: FileActionPlan): FileProcessingSummary {
  return summarizeEffectiveAction(plan.action, plan);
}

function summarizeEffectiveAction(
  action: LogAction,
  plan: FileActionPlan,
): FileProcessingSummary {
  const summary = emptyFileProcessingSummary();
  summary.processed = 1;
  if (action === "MOVE" || action === "CREATE_FOLDER_AND_MOVE") {
    summary.moved = 1;
  } else if (action === "REVIEW") {
    summary.reviewed = 1;
  } else if (action === "DUPLICATE") {
    summary.duplicates = 1;
  } else if (action === "UNSUPPORTED") {
    summary.unsupported = 1;
  }
  applyFolderProposalCounters(summary, plan);
  return summary;
}

function applyFolderProposalCounters(
  summary: FileProcessingSummary,
  plan: FileActionPlan,
): void {
  if (plan.folderCreationProposalRequestMade) {
    summary.folderProposals = 1;
  }
  if (
    plan.folderCreationDecision === "SUGGESTED" ||
    plan.folderCreationDecision === "AUTO_APPROVED"
  ) {
    summary.acceptedFolderProposals = 1;
  } else if (
    plan.folderCreationProposalRequestMade &&
    (plan.folderCreationDecision === "MODEL_DECLINED" ||
      plan.folderCreationDecision === "REJECTED")
  ) {
    summary.rejectedFolderProposals = 1;
  }
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
  target.folderProposals += addition.folderProposals;
  target.acceptedFolderProposals += addition.acceptedFolderProposals;
  target.rejectedFolderProposals += addition.rejectedFolderProposals;
  target.folderProposalApiErrors += addition.folderProposalApiErrors;
  target.createdFolders += addition.createdFolders;
  target.partialFolderCreations += addition.partialFolderCreations;
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

interface FolderProposalAttemptState {
  apiError: boolean;
  requestMade: boolean;
}

function buildFolderProposalOrFallbackPlan(
  file: GoogleAppsScript.Drive.File,
  sourceSnapshot: SourceFileSnapshot,
  prepared: PreparedDocument,
  classification: ClassificationResult,
  proposalReason: string,
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
  deadlineEpochMs: number,
  attemptState: FolderProposalAttemptState,
): FileActionPlan {
  if (config.folderCreationMode === "OFF") {
    return buildReviewPlan(
      file,
      sourceSnapshot,
      classification,
      "CLASSIFICATION_UNCERTAIN",
      proposalReason,
      config,
      context,
      deadlineEpochMs,
    );
  }

  let evaluation: FolderCreationProposalEvaluation;
  try {
    // The public result intentionally contains no transport metadata. Derive
    // whether a request can be made from the same trusted, deterministic
    // context builder used by the proposal engine.
    attemptState.requestMade =
      buildFolderCreationContexts(index, config).length > 0;
    evaluation = proposeFolderFromReview(
      prepared,
      index,
      config,
      deadlineEpochMs,
    );
  } catch (error: unknown) {
    if (error instanceof SorterError && error.category === "API_ERROR") {
      attemptState.apiError = true;
    }
    throw error;
  }

  const policyErrors = getAutoFolderCreationPolicyErrors(
    evaluation,
    config,
    index,
  );
  const decision = getFolderCreationDecision(
    evaluation,
    config,
    policyErrors,
    attemptState.requestMade,
  );
  // INVALID may carry a canonical, structurally validated low-confidence
  // proposal in SUGGEST mode. It is safe for bounded logging only and can
  // never cross the AUTO authorization branch below.
  const loggedProposal = evaluation.proposal;
  const authorizedProposal =
    evaluation.status === "VALID" ? evaluation.proposal : null;
  const proposalErrors = [...evaluation.errors, ...policyErrors];
  const finalPath =
    authorizedProposal === null
      ? null
      : `${authorizedProposal.parentFolderPath}/${authorizedProposal.proposedSegments.join("/")}`;

  if (
    (decision === "AUTO_APPROVED" || decision === "SUGGESTED") &&
    authorizedProposal !== null &&
    finalPath !== null
  ) {
    const proposal = authorizedProposal;
    const modelSuggestion = config.renameFiles
      ? classification.suggestedFilename
      : null;
    return {
      action: "CREATE_FOLDER_AND_MOVE",
      // This is deliberately the existing parent ID, never a fabricated ID
      // for the missing child. The mutation layer creates and records the
      // child only after repeating live topology checks.
      destinationFolderId: proposal.parentFolderId,
      destinationPath: finalPath,
      destinationFilename: buildSafeFilename(
        file.getName(),
        modelSuggestion,
      ),
      duplicateOfFileId: null,
      exactDuplicateSha256: null,
      possibleDuplicateOfFileIds: [],
      sourceSnapshot,
      classification,
      errorKind: null,
      reason: proposal.reason,
      requiresFolderCreation: true,
      folderCreationProposal: proposal,
      folderCreationDecision: decision,
      folderCreationProposalErrors: [],
      folderCreationProposalRequestMade: attemptState.requestMade,
    };
  }

  const fallbackReason = buildFolderProposalPlanReason(
    proposalReason,
    decision,
    loggedProposal,
    proposalErrors,
  );
  const hasUsableExistingTarget =
    classification.targetFolderId !== null &&
    classification.targetFolderPath !== null &&
    classification.confidence >= config.confidenceThreshold;
  const fallbackPlan = hasUsableExistingTarget
    ? buildClassifiedPlan(
        file,
        sourceSnapshot,
        classification,
        config,
        index,
        deadlineEpochMs,
      )
    : buildReviewPlan(
        file,
        sourceSnapshot,
        classification,
        "CLASSIFICATION_UNCERTAIN",
        fallbackReason,
        config,
        context,
        deadlineEpochMs,
      );
  return {
    ...fallbackPlan,
    folderCreationProposal: loggedProposal,
    folderCreationDecision: decision,
    folderCreationProposalErrors: proposalErrors,
    folderCreationProposalRequestMade: attemptState.requestMade,
    reason: hasUsableExistingTarget
      ? `${fallbackPlan.reason} Folder proposal fallback: ${fallbackReason}`
      : fallbackPlan.reason,
  };
}

function getAutoFolderCreationPolicyErrors(
  evaluation: FolderCreationProposalEvaluation,
  config: AppConfig,
  index: FolderIndex,
): string[] {
  if (
    config.folderCreationMode !== "AUTO" ||
    evaluation.status !== "VALID" ||
    evaluation.proposal === null
  ) {
    return [];
  }

  const proposal = evaluation.proposal;
  const errors: string[] = [];
  // V1 AUTO intentionally authorizes one new leaf only, even if a future
  // configuration permits a wider proposal for read-only review.
  if (proposal.proposedSegments.length !== 1) {
    errors.push("AUTO requires exactly one new folder segment.");
  }
  if (
    proposal.patternType !== "TEMPORAL" &&
    proposal.patternType !== "SEMANTIC"
  ) {
    errors.push("AUTO accepts only TEMPORAL or SEMANTIC sibling patterns.");
  }
  if (proposal.confidence < config.folderCreationConfidenceThreshold) {
    errors.push(
      `Proposal confidence ${proposal.confidence.toFixed(3)} is below AUTO threshold ${config.folderCreationConfidenceThreshold.toFixed(3)}.`,
    );
  }
  const parent = getTrustedFolderEntry(index, proposal.parentFolderId);
  const finalDepth =
    parent === null ? Number.POSITIVE_INFINITY : parent.depth + proposal.proposedSegments.length;
  if (
    finalDepth > config.folderCreationMaxFinalDepth ||
    finalDepth > config.maxFolderDepth
  ) {
    errors.push("The proposed final path exceeds the configured depth limit.");
  }
  return errors;
}

function getFolderCreationDecision(
  evaluation: FolderCreationProposalEvaluation,
  config: AppConfig,
  policyErrors: readonly string[],
  requestMade: boolean,
): FolderCreationDecision {
  if (evaluation.status === "NO_PROPOSAL") {
    return requestMade ? "MODEL_DECLINED" : "NO_CONTEXT";
  }
  if (evaluation.status !== "VALID" || policyErrors.length > 0) {
    return "REJECTED";
  }
  return config.folderCreationMode === "AUTO"
    ? "AUTO_APPROVED"
    : "SUGGESTED";
}

function buildFolderProposalPlanReason(
  uncertaintyReason: string,
  decision: FolderCreationDecision,
  proposal: FolderCreationProposal | null,
  errors: readonly string[],
): string {
  const detail =
    proposal !== null
      ? ` Proposed ${proposal.parentFolderPath}/${proposal.proposedSegments.join("/")} (${proposal.patternType}, confidence ${proposal.confidence.toFixed(3)}).`
      : "";
  const rejection =
    errors.length > 0
      ? ` Proposal checks: ${errors.slice(0, 5).join("; ")}`
      : "";
  return `${uncertaintyReason} Folder proposal decision=${decision}.${detail}${rejection}`;
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
  let classification: ClassificationResult | null = null;
  const folderProposalAttempt: FolderProposalAttemptState = {
    apiError: false,
    requestMade: false,
  };

  try {
    sourceSnapshot = captureSourceFileSnapshot(file);
    sizeBytes = sourceSnapshot.sizeBytes;
    const prepared = prepareDocument(file, config);
    classification = classifyFile(
      prepared,
      index.folders,
      config,
      deadlineEpochMs,
    );

    const hasSelectedTarget =
      classification.targetFolderId !== null &&
      classification.targetFolderPath !== null;
    const hasUsableExistingTarget =
      hasSelectedTarget &&
      classification.confidence >= config.confidenceThreshold;
    const shouldEvaluateFolderProposal =
      config.folderCreationMode !== "OFF" &&
      (!hasSelectedTarget ||
        classification.confidence <
          config.folderCreationConfidenceThreshold);

    if (shouldEvaluateFolderProposal) {
      const proposalReason = !hasSelectedTarget
        ? "Normal classification selected no existing destination."
        : `Normal classification confidence ${classification.confidence.toFixed(3)} is below folder creation threshold ${config.folderCreationConfidenceThreshold.toFixed(3)}; its existing target remains the fallback.`;
      const plan = buildFolderProposalOrFallbackPlan(
        file,
        sourceSnapshot,
        prepared,
        classification,
        proposalReason,
        config,
        context,
        index,
        deadlineEpochMs,
        folderProposalAttempt,
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

    if (!hasUsableExistingTarget) {
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
    if (folderProposalAttempt.apiError) {
      summary.folderProposals = 1;
      summary.folderProposalApiErrors = 1;
    }
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId,
        originalFilename,
        mimeType,
        sizeBytes,
        classification,
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
          folderProposalAttempt.apiError
            ? "Folder proposal API failure; the valid initial classification is logged and the file is intentionally left in inbox."
            : errorKind === "API_ERROR"
            ? "Infrastructure/API failure; file intentionally left in inbox."
            : "Unexpected failure; file intentionally left in inbox when possible.",
        folderCreationMode: config.folderCreationMode,
        folderCreationDecision: folderProposalAttempt.apiError
          ? "API_ERROR"
          : "NOT_EVALUATED",
        folderCreationProposal: null,
        folderCreationProposalErrors: [],
        folderCreationThresholdPassed: null,
        createdFolderId: null,
        createdFolderPath: null,
        folderCreationPartialMutation: false,
      }),
    );
    return summary;
  }
}

interface FolderCreationLogFields {
  folderCreationMode: FolderCreationMode;
  folderCreationDecision: FolderCreationDecision;
  folderCreationProposal: FolderCreationProposal | null;
  folderCreationProposalErrors: string[];
  folderCreationThresholdPassed: boolean | null;
  createdFolderId: string | null;
  createdFolderPath: string | null;
  createdFolders: CreatedFolderRecord[];
  folderCreationPartialMutation: boolean;
}

function buildFolderCreationLogFields(
  plan: FileActionPlan,
  config: AppConfig,
  createdFolders: readonly CreatedFolderRecord[] = [],
  partialMutation = false,
): FolderCreationLogFields {
  const proposal = plan.folderCreationProposal ?? null;
  const firstCreated = createdFolders[0] ?? null;
  return {
    folderCreationMode: config.folderCreationMode,
    folderCreationDecision:
      plan.folderCreationDecision ?? "NOT_EVALUATED",
    folderCreationProposal: proposal,
    folderCreationProposalErrors:
      plan.folderCreationProposalErrors?.slice(0, 20) ?? [],
    folderCreationThresholdPassed:
      proposal === null
        ? null
        : proposal.confidence >=
          config.folderCreationConfidenceThreshold,
    createdFolderId: firstCreated?.id ?? null,
    createdFolderPath: firstCreated?.path ?? null,
    createdFolders: createdFolders.slice(),
    folderCreationPartialMutation: partialMutation,
  };
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

  // SUGGEST is an unconditional read-only boundary, independently of DRY_RUN
  // and independently of whether the normal classifier found a usable target.
  // The file remains in inbox and the selected fallback/proposal is log-only.
  if (config.folderCreationMode === "SUGGEST") {
    const suggestSummary = emptyFileProcessingSummary();
    suggestSummary.processed = 1;
    suggestSummary.skipped = 1;
    applyFolderProposalCounters(suggestSummary, plan);
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId: file.getId(),
        originalFilename,
        mimeType: originalMimeType,
        sizeBytes,
        classification: plan.classification,
        action: config.dryRun ? "DRY_RUN" : "SUGGEST_FOLDER",
        wouldAction: plan.action,
        destinationFolderId: plan.requiresFolderCreation
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
        dryRun: config.dryRun,
        durationMs: Date.now() - startedAt,
        reason: `${plan.reason} SUGGEST is read-only; file left in inbox.`,
        ...buildFolderCreationLogFields(plan, config),
      }),
    );
    return suggestSummary;
  }

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
          plan.requiresFolderCreation
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
        ...buildFolderCreationLogFields(plan, config),
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
    const appliedSummary = summarizeEffectiveAction(
      applied.effectiveAction,
      plan,
    );
    appliedSummary.createdFolders = applied.createdFolders.length;
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId: file.getId(),
        originalFilename,
        mimeType: originalMimeType,
        sizeBytes,
        classification: plan.classification,
        action: applied.effectiveAction,
        wouldAction: null,
        destinationFolderId: applied.destinationFolderId,
        destinationPath: applied.destinationPath,
        resultingFilename: applied.resultingFilename,
        duplicateOfFileId: applied.duplicateOfFileId,
        possibleDuplicateOfFileIds: applied.possibleDuplicateOfFileIds,
        errorKind: plan.errorKind,
        error:
          sourceError === null || plan.errorKind === null
            ? null
            : toStructuredLogError(sourceError, plan.errorKind, false),
        dryRun: false,
        durationMs: Date.now() - startedAt,
        reason: plan.reason,
        ...buildFolderCreationLogFields(
          plan,
          config,
          applied.createdFolders,
        ),
      }),
    );
    return appliedSummary;
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
    applyFolderProposalCounters(failed, plan);
    const createdFolders =
      partial?.createdFolders ??
      partialFolder?.createdFolders ??
      applied?.createdFolders ??
      [];
    failed.createdFolders = createdFolders.length;
    failed.partialFolderCreations = createdFolders.length;
    if (partial !== null || applied !== null) {
      const appliedAction = summarizeEffectiveAction(
        partial?.effectiveAction ?? applied?.effectiveAction ?? plan.action,
        plan,
      );
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
        duplicateOfFileId:
          partial?.duplicateOfFileId ??
          applied?.duplicateOfFileId ??
          plan.duplicateOfFileId,
        possibleDuplicateOfFileIds:
          partial?.possibleDuplicateOfFileIds ??
          applied?.possibleDuplicateOfFileIds ??
          plan.possibleDuplicateOfFileIds,
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
              ? `PARTIAL_FOLDER_CREATION: ${partialFolder.purpose.toLowerCase()} folder creation was confirmed, but the file stayed in inbox; the next run can reuse it.`
            : "The guarded Drive mutation was refused or failed before a confirmed move; file remains in inbox when possible.",
        ...buildFolderCreationLogFields(
          plan,
          config,
          createdFolders,
          createdFolders.length > 0,
        ),
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
