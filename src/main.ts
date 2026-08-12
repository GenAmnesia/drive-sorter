/** Manual Apps Script entry point for the document sorter. */
function runSorter(): void {
  const startedAt = Date.now();
  const runId = createRunId();
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  let config: AppConfig | null = null;
  let context: DriveFolderContext | null = null;
  const totals = emptyFileProcessingSummary();

  try {
    lockAcquired = lock.tryLock(1_000);
    if (!lockAcquired) {
      setLogLevel(readLogLevelForDiagnostic());
      logBatch(
        createBatchLogRecord({
          runId,
          status: "LOCK_SKIPPED",
          dryRun: readDryRunForDiagnostic(),
          processed: 0,
          moved: 0,
          reviewed: 0,
          duplicates: 0,
          unsupported: 0,
          errors: 0,
          skipped: 1,
          ...folderCreationBatchCounters(totals),
          elapsedMs: Date.now() - startedAt,
          message: "Another runSorter execution holds the script lock.",
        }),
      );
      return;
    }

    setLogLevel(readLogLevelForDiagnostic());
    config = getAppConfig("FULL");
    setLogLevel(config.logLevel);
    context = validateDriveConfiguration(config);
    const auditLogFolder = ensureAuditLogFolder(config, context);
    const persistentAuditLog = startPersistentAuditLog(
      context.root,
      auditLogFolder.folder,
      runId,
      startedAt,
      config.logLevel,
    );
    logBatch(
      createBatchLogRecord({
        runId,
        status: "STARTED",
        dryRun: config.dryRun,
        processed: 0,
        moved: 0,
        reviewed: 0,
        duplicates: 0,
        unsupported: 0,
        errors: 0,
        skipped: 0,
        ...folderCreationBatchCounters(totals),
        elapsedMs: Date.now() - startedAt,
        message: safeJsonStringify({
          ...getSafeConfigSummary(config),
          persistentAuditDocumentId: persistentAuditLog.documentId,
          persistentAuditFilename: persistentAuditLog.filename,
          logFolderId: auditLogFolder.folder.getId(),
          logFolderCreated: auditLogFolder.created,
        }),
      }),
    );

    let index = buildFolderIndex(config, context);
    let fallbackCreated = false;
    const inboxHasFiles = context.inbox.getFiles().hasNext();
    if (index.folders.length === 0 && inboxHasFiles) {
      if (
        config.allowFolderCreation &&
        !config.dryRun
      ) {
        logPersistentAuditIntent({
          timestamp: isoTimestamp(),
          event: "FALLBACK_FOLDER_CREATION_INTENT",
          runId,
          fileId: null,
          action: "CREATE_FALLBACK_FOLDER",
          destinationFolderId: context.root.getId(),
          destinationPath: config.fallbackFolderName,
          dryRun: false,
          reason:
            "Application-controlled fallback creation may occur because the trusted candidate index is empty.",
        });
        assertPersistentAuditLogHealthy();
      }
      fallbackCreated = maybeCreateFallbackFolder(config, context, index);
      if (fallbackCreated) {
        index = buildFolderIndex(config, context);
      }
    }

    if (!index.isComplete) {
      throw new ConfigurationError([
        index.invalidReason ||
          "The folder index is incomplete; processing was refused.",
      ]);
    }
    if (index.folders.length > config.maxCandidateFolders) {
      throw new ConfigurationError([
        `The Drive tree has at least ${index.folders.length} candidate folders, above MAX_CANDIDATE_FOLDERS=${config.maxCandidateFolders}. Traversal stopped and no truncated candidate list was sent to Gemini.`,
      ]);
    }

    const deadlineEpochMs = startedAt + config.maxRunMillis;
    const processed = processInbox(
      config,
      context,
      index,
      runId,
      deadlineEpochMs,
    );
    mergeFileProcessingSummary(totals, processed);
    if (!index.isComplete) {
      throw new Error(
        index.invalidReason ||
          "Trusted folder index became incomplete; the batch was stopped.",
      );
    }

    const deadlineReached = Date.now() >= deadlineEpochMs - 30_000;
    logBatch(
      createBatchLogRecord({
        runId,
        status: "COMPLETED",
        dryRun: config.dryRun,
        processed: totals.processed,
        moved: totals.moved,
        reviewed: totals.reviewed,
        duplicates: totals.duplicates,
        unsupported: totals.unsupported,
        errors: totals.errors,
        skipped: totals.skipped,
        ...folderCreationBatchCounters(totals),
        elapsedMs: Date.now() - startedAt,
        message: [
          `candidateFolders=${index.folders.length}`,
          `fallbackCreated=${fallbackCreated}`,
          `deadlineGuardReached=${deadlineReached}`,
          `indexComplete=${index.isComplete}`,
          config.dryRun
            ? "countsArePlannedActions=true"
            : "countsAreAppliedActions=true",
          config.folderCreationMode === "SUGGEST"
            ? "folderProposalsAreSuggestions=true"
            : "folderProposalsAreSuggestions=false",
        ].join("; "),
      }),
    );
  } catch (error: unknown) {
    totals.errors += 1;
    logBatchFailureSafely(
      createBatchLogRecord({
        runId,
        status: "FAILED",
        dryRun: config?.dryRun ?? readDryRunForDiagnostic(),
        processed: totals.processed,
        moved: totals.moved,
        reviewed: totals.reviewed,
        duplicates: totals.duplicates,
        unsupported: totals.unsupported,
        errors: totals.errors,
        skipped: totals.skipped,
        ...folderCreationBatchCounters(totals),
        elapsedMs: Date.now() - startedAt,
        message: getErrorMessage(error),
      }),
    );
  } finally {
    finishPersistentAuditLog();
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}

function processInbox(
  config: AppConfig,
  context: DriveFolderContext,
  index: FolderIndex,
  runId: string,
  deadlineEpochMs: number,
): FileProcessingSummary {
  const totals = emptyFileProcessingSummary();
  const processedFileIds = new Set<string>();
  const files = context.inbox.getFiles();

  while (
    files.hasNext() &&
    totals.processed < config.maxFilesPerRun &&
    Date.now() < deadlineEpochMs - 30_000
  ) {
    // If the per-run Google Doc cannot accept another record, do not begin a
    // new file that might later require a Drive mutation without durable audit.
    assertPersistentAuditLogHealthy();
    let file: GoogleAppsScript.Drive.File;
    try {
      file = files.next();
    } catch (error: unknown) {
      totals.errors += 1;
      logPersistentAuditEvent({
        timestamp: isoTimestamp(),
        event: "INBOX_ITERATOR_ERROR",
        runId,
        error: getErrorMessage(error),
        action: "ERROR",
        reason: "Inbox iteration failed; batch stopped without mutating an unknown file.",
      });
      break;
    }

    let fileId = "<unavailable>";
    try {
      fileId = file.getId();
      if (processedFileIds.has(fileId)) {
        totals.skipped += 1;
        continue;
      }
      processedFileIds.add(fileId);

      const result = processFile(
        file,
        runId,
        config,
        context,
        index,
        deadlineEpochMs,
      );
      mergeFileProcessingSummary(totals, result);
      if (!index.isComplete) {
        logPersistentAuditEvent({
          timestamp: isoTimestamp(),
          event: "FOLDER_INDEX_INVALIDATED",
          runId,
          fileId,
          action: "ERROR",
          reason:
            index.invalidReason ||
            "Trusted folder index became incomplete; remaining batch stopped.",
        });
        break;
      }
    } catch (error: unknown) {
      // processFile isolates normal per-file failures. This final guard protects
      // the rest of the batch even if logging or metadata access also fails.
      totals.processed += 1;
      totals.errors += 1;
      logPersistentAuditEvent({
        timestamp: isoTimestamp(),
        event: "FILE_GUARD_ERROR",
        runId,
        fileId,
        error: getErrorMessage(error),
        action: "ERROR",
        reason: "File left in inbox when possible; batch continues.",
      });
      if (!index.isComplete) {
        break;
      }
    }
  }

  return totals;
}

/** A failed persistent log must not hide the original batch failure in console. */
function logBatchFailureSafely(record: BatchLogRecord): void {
  try {
    logBatch(record);
  } catch (loggingError: unknown) {
    console.error(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "BATCH_FAILURE_LOG_NOT_PERSISTED",
        runId: record.runId,
        error: getErrorMessage(loggingError),
        action: "ERROR",
        reason:
          "The batch failure is visible in console, but the persistent audit document could not be updated.",
      }),
    );
  }
}

function folderCreationBatchCounters(
  summary: FileProcessingSummary,
): Pick<
  BatchLogRecord,
  | "folderProposals"
  | "acceptedFolderProposals"
  | "rejectedFolderProposals"
  | "folderProposalApiErrors"
  | "createdFolders"
  | "partialFolderCreations"
> {
  return {
    folderProposals: summary.folderProposals,
    acceptedFolderProposals: summary.acceptedFolderProposals,
    rejectedFolderProposals: summary.rejectedFolderProposals,
    folderProposalApiErrors: summary.folderProposalApiErrors,
    createdFolders: summary.createdFolders,
    partialFolderCreations: summary.partialFolderCreations,
  };
}

function readDryRunForDiagnostic(): boolean {
  try {
    const value = PropertiesService.getScriptProperties().getProperty("DRY_RUN");
    return parseBoolean(value, true, "DRY_RUN");
  } catch (_error) {
    return true;
  }
}

function readLogLevelForDiagnostic(): LogLevel {
  try {
    const value = PropertiesService.getScriptProperties().getProperty("LOG_LEVEL");
    return parseLogLevel(value, "JSON");
  } catch (_error) {
    return "JSON";
  }
}

/** Kept as a harmless local deployment health check. */
function hello(): void {
  console.log("Drive Sorter alive");
}
