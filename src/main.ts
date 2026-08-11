/** Manual Apps Script entry point for the document sorter. */
function runSorter(): void {
  const startedAt = Date.now();
  const runId = createRunId();
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  let config: AppConfig | null = null;
  const totals = emptyFileProcessingSummary();

  try {
    lockAcquired = lock.tryLock(1_000);
    if (!lockAcquired) {
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
          elapsedMs: Date.now() - startedAt,
          message: "Another runSorter execution holds the script lock.",
        }),
      );
      return;
    }

    config = getAppConfig("FULL");
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
        elapsedMs: Date.now() - startedAt,
        message: safeJsonStringify(getSafeConfigSummary(config)),
      }),
    );

    const context = validateDriveConfiguration(config);
    let index = buildFolderIndex(config, context);
    let fallbackCreated = false;
    const inboxHasFiles = context.inbox.getFiles().hasNext();
    if (index.folders.length === 0 && inboxHasFiles) {
      fallbackCreated = maybeCreateFallbackFolder(config, context, index);
      if (fallbackCreated) {
        index = buildFolderIndex(config, context);
      }
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
        elapsedMs: Date.now() - startedAt,
        message: [
          `candidateFolders=${index.folders.length}`,
          `fallbackCreated=${fallbackCreated}`,
          `deadlineGuardReached=${deadlineReached}`,
          config.dryRun ? "countsArePlannedActions=true" : "countsAreAppliedActions=true",
        ].join("; "),
      }),
    );
  } catch (error: unknown) {
    totals.errors += 1;
    logBatch(
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
        elapsedMs: Date.now() - startedAt,
        message: getErrorMessage(error),
      }),
    );
  } finally {
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
    let file: GoogleAppsScript.Drive.File;
    try {
      file = files.next();
    } catch (error: unknown) {
      totals.errors += 1;
      console.error(
        safeJsonStringify({
          timestamp: isoTimestamp(),
          event: "INBOX_ITERATOR_ERROR",
          runId,
          error: getErrorMessage(error),
          action: "ERROR",
          reason: "Inbox iteration failed; batch stopped without mutating an unknown file.",
        }),
      );
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
    } catch (error: unknown) {
      // processFile isolates normal per-file failures. This final guard protects
      // the rest of the batch even if logging or metadata access also fails.
      totals.processed += 1;
      totals.errors += 1;
      console.error(
        safeJsonStringify({
          timestamp: isoTimestamp(),
          event: "FILE_GUARD_ERROR",
          runId,
          fileId,
          error: getErrorMessage(error),
          action: "ERROR",
          reason: "File left in inbox when possible; batch continues.",
        }),
      );
    }
  }

  return totals;
}

function readDryRunForDiagnostic(): boolean {
  try {
    const value = PropertiesService.getScriptProperties().getProperty("DRY_RUN");
    return parseBoolean(value, true, "DRY_RUN");
  } catch (_error) {
    return true;
  }
}

/** Kept as a harmless local deployment health check. */
function hello(): void {
  console.log("Drive Sorter alive");
}
