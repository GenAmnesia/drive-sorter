let activePersistentAuditLog: PersistentAuditLogInfo | null = null;
let persistentAuditLogFailure: string | null = null;
let activeLogLevel: LogLevel = "JSON";

class PersistentAuditLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistentAuditLogError";
    Object.setPrototypeOf(this, PersistentAuditLogError.prototype);
  }
}

/**
 * Start the append-only audit document for one validated run. It is created
 * before normal batch logging so a later failure still leaves a durable start
 * marker in the reserved root/logs folder whenever creation succeeded.
 */
function startPersistentAuditLog(
  root: GoogleAppsScript.Drive.Folder,
  logFolder: GoogleAppsScript.Drive.Folder,
  runId: string,
  startedAtEpochMs: number,
  logLevel: LogLevel = activeLogLevel,
): PersistentAuditLogInfo {
  if (activePersistentAuditLog !== null) {
    throw new PersistentAuditLogError(
      "A persistent audit log is already active for this execution.",
    );
  }

  activePersistentAuditLog = createPersistentAuditDocument(
    root,
    logFolder,
    runId,
    startedAtEpochMs,
  );
  setLogLevel(logLevel);
  persistentAuditLogFailure = null;
  logPersistentAuditEvent({
    timestamp: isoTimestamp(),
    event: "AUDIT_LOG_STARTED",
    runId,
    auditDocumentId: activePersistentAuditLog.documentId,
    auditFilename: activePersistentAuditLog.filename,
    rootFolderId: activePersistentAuditLog.rootFolderId,
    logFolderId: activePersistentAuditLog.logFolderId,
    logFolderPath: activePersistentAuditLog.logFolderPath,
    dryRun: false,
    reason: "Persistent audit document initialized before document processing.",
  });
  return { ...activePersistentAuditLog };
}

/** End the in-memory session; every append is already saved and closed. */
function finishPersistentAuditLog(): void {
  activePersistentAuditLog = null;
  persistentAuditLogFailure = null;
  activeLogLevel = "JSON";
}

function getPersistentAuditLogInfo(): PersistentAuditLogInfo | null {
  return activePersistentAuditLog === null
    ? null
    : { ...activePersistentAuditLog };
}

/**
 * Abort later mutations after a persistence failure. A missing active log is
 * tolerated for read-only manual tests and lock/configuration diagnostics.
 */
function assertPersistentAuditLogHealthy(): void {
  if (persistentAuditLogFailure !== null) {
    throw new PersistentAuditLogError(
      `Persistent audit logging is unavailable: ${persistentAuditLogFailure}`,
    );
  }
}

function appendToPersistentAuditLog(serializedRecord: string): void {
  if (activePersistentAuditLog === null) {
    return;
  }
  assertPersistentAuditLogHealthy();
  try {
    appendPersistentAuditDocumentLine(
      activePersistentAuditLog.documentId,
      serializedRecord,
    );
    activePersistentAuditLog.linesWritten += 1;
  } catch (error: unknown) {
    persistentAuditLogFailure = getErrorMessage(error, 500);
    console.error(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "PERSISTENT_AUDIT_LOG_APPEND_FAILED",
        auditDocumentId: activePersistentAuditLog.documentId,
        error: persistentAuditLogFailure,
        action: "ERROR",
        reason:
          "Further document and folder mutations are refused for this run.",
      }),
    );
    throw new PersistentAuditLogError(
      `Could not persist the audit record: ${persistentAuditLogFailure}`,
    );
  }
}

/** Select how regular run messages appear in console and the audit document. */
function setLogLevel(logLevel: LogLevel): void {
  activeLogLevel = logLevel;
}

/**
 * The audit document is an append-only mirror of logger console output. Each
 * item is emitted and persisted in the same order, including PRETTY/FULL
 * multi-line messages.
 */
function emitAuditLines(lines: readonly string[]): void {
  lines.forEach((line) => {
    console.log(line);
    appendToPersistentAuditLog(line);
  });
}

function selectLogOutput(pretty: string, json: string): string[] {
  if (activeLogLevel === "PRETTY") {
    return [pretty];
  }
  if (activeLogLevel === "FULL") {
    return [pretty, json];
  }
  return [json];
}

/** Emit an explicit before-mutation marker to the persistent audit document. */
function logPersistentAuditIntent(record: PersistentAuditIntentRecord): void {
  const sanitized: PersistentAuditIntentRecord = {
    ...record,
    timestamp: redactSensitiveText(record.timestamp),
    runId: redactSensitiveText(record.runId),
    fileId:
      record.fileId === null ? null : redactSensitiveText(record.fileId),
    destinationFolderId:
      record.destinationFolderId === null
        ? null
        : redactSensitiveText(record.destinationFolderId),
    destinationPath:
      record.destinationPath === null
        ? null
        : truncateString(redactSensitiveText(record.destinationPath), 1_000),
    reason: truncateString(redactSensitiveText(record.reason), 1_000),
  };
  const json = safeJsonStringify(sanitized);
  emitAuditLines(selectLogOutput(formatPrettyAuditIntent(sanitized), json));
}

/** Persist a bounded lifecycle record that is not a normal file/batch result. */
function logPersistentAuditEvent(record: Record<string, unknown>): void {
  const json = safeJsonStringify(record);
  emitAuditLines(selectLogOutput(formatPrettyAuditEvent(record), json));
}

/** Emit one complete file record in the configured logger representation. */
function logOperation(record: StructuredLogRecord): void {
  const sanitized = sanitizeStructuredLogRecord(record);
  const json = safeJsonStringify(sanitized);
  emitAuditLines(selectLogOutput(formatPrettyFileOperation(sanitized), json));
}

/** Alias with an explicit name for callers that prefer it. */
function logFileOperation(record: StructuredLogRecord): void {
  logOperation(record);
}

/** Emit one complete batch record in the configured logger representation. */
function logBatch(record: BatchLogRecord): void {
  const sanitized = sanitizeBatchLogRecord(record);
  const json = safeJsonStringify(sanitized);
  emitAuditLines(selectLogOutput(formatPrettyBatch(sanitized), json));
}

function logBatchEvent(record: BatchLogRecord): void {
  logBatch(record);
}

function createStructuredLogRecord(
  values: Omit<StructuredLogRecord, "timestamp" | "event">,
): StructuredLogRecord {
  return {
    timestamp: isoTimestamp(),
    event: "FILE",
    ...values,
  };
}

function createBatchLogRecord(
  values: Omit<BatchLogRecord, "timestamp" | "event">,
): BatchLogRecord {
  return {
    timestamp: isoTimestamp(),
    event: "BATCH",
    ...values,
  };
}

/**
 * Copy and sanitize text fields before serialization. This is deliberately
 * defensive even though safeJsonStringify() performs a second redaction pass.
 */
function sanitizeStructuredLogRecord(
  record: StructuredLogRecord,
): StructuredLogRecord {
  return {
    ...record,
    timestamp: redactSensitiveText(record.timestamp),
    runId: redactSensitiveText(record.runId),
    fileId: redactSensitiveText(record.fileId),
    originalFilename: truncateString(redactSensitiveText(record.originalFilename), 500),
    mimeType: truncateString(redactSensitiveText(record.mimeType), 200),
    classification:
      record.classification === null
        ? null
        : {
            ...record.classification,
            targetFolderId:
              record.classification.targetFolderId === null
                ? null
                : redactSensitiveText(record.classification.targetFolderId),
            targetFolderPath:
              record.classification.targetFolderPath === null
                ? null
                : truncateString(
                    redactSensitiveText(record.classification.targetFolderPath),
                    1_000,
                  ),
            documentType: truncateString(
              redactSensitiveText(record.classification.documentType),
              200,
            ),
            suggestedFilename:
              record.classification.suggestedFilename === null
                ? null
                : truncateString(
                    redactSensitiveText(record.classification.suggestedFilename),
                    500,
                  ),
            reason: truncateString(
              redactSensitiveText(record.classification.reason),
              1_000,
            ),
          },
    destinationFolderId:
      record.destinationFolderId === null
        ? null
        : redactSensitiveText(record.destinationFolderId),
    destinationPath:
      record.destinationPath === null
        ? null
        : truncateString(redactSensitiveText(record.destinationPath), 1_000),
    resultingFilename:
      record.resultingFilename === null
        ? null
        : truncateString(redactSensitiveText(record.resultingFilename), 500),
    duplicateOfFileId:
      record.duplicateOfFileId === null
        ? null
        : redactSensitiveText(record.duplicateOfFileId),
    possibleDuplicateOfFileIds: record.possibleDuplicateOfFileIds.map((id) =>
      redactSensitiveText(id),
    ),
    error:
      record.error === null
        ? null
        : {
            ...record.error,
            name: truncateString(redactSensitiveText(record.error.name), 100),
            message: truncateString(redactSensitiveText(record.error.message), 2_000),
          },
    reason:
      record.reason === null
        ? null
        : truncateString(redactSensitiveText(record.reason), 1_000),
    folderCreationProposal:
      record.folderCreationProposal === undefined ||
      record.folderCreationProposal === null
        ? record.folderCreationProposal
        : sanitizeFolderCreationProposalForLog(
            record.folderCreationProposal,
          ),
    folderCreationProposalErrors:
      record.folderCreationProposalErrors === undefined
        ? undefined
        : record.folderCreationProposalErrors
            .slice(0, 20)
            .map((error) =>
              truncateString(redactSensitiveText(error), 300),
            ),
    createdFolderId:
      record.createdFolderId === undefined || record.createdFolderId === null
        ? record.createdFolderId
        : redactSensitiveText(record.createdFolderId),
    createdFolderPath:
      record.createdFolderPath === undefined ||
      record.createdFolderPath === null
        ? record.createdFolderPath
        : truncateString(
            redactSensitiveText(record.createdFolderPath),
            1_000,
          ),
    createdFolders:
      record.createdFolders === undefined
        ? undefined
        : record.createdFolders.slice(0, 20).map((folder) => ({
            id: redactSensitiveText(folder.id),
            path: truncateString(redactSensitiveText(folder.path), 1_000),
            purpose: folder.purpose,
          })),
  };
}

function sanitizeFolderCreationProposalForLog(
  proposal: FolderCreationProposal,
): FolderCreationProposal {
  return {
    parentFolderId: redactSensitiveText(proposal.parentFolderId),
    parentFolderPath: truncateString(
      redactSensitiveText(proposal.parentFolderPath),
      1_000,
    ),
    proposedSegments: proposal.proposedSegments
      .slice(0, 10)
      .map((segment) =>
        truncateString(redactSensitiveText(segment), 100),
      ),
    patternType: proposal.patternType,
    evidenceFolderIds: proposal.evidenceFolderIds
      .slice(0, 100)
      .map((id) => redactSensitiveText(id)),
    confidence: proposal.confidence,
    reason: truncateString(redactSensitiveText(proposal.reason), 300),
  };
}

function sanitizeBatchLogRecord(record: BatchLogRecord): BatchLogRecord {
  return {
    ...record,
    timestamp: redactSensitiveText(record.timestamp),
    runId: redactSensitiveText(record.runId),
    message:
      record.message === null
        ? null
        : truncateString(redactSensitiveText(record.message), 2_000),
  };
}

const PRETTY_LOG_SEPARATOR = "================================================================";
const PRETTY_LOG_SUBSEPARATOR = "----------------------------------------------------------------";

/**
 * Render one file result as a compact, scan-friendly hierarchy. Labels are
 * deliberately English; values remain the already-sanitized source data.
 */
function formatPrettyFileOperation(record: StructuredLogRecord): string {
  const classification = record.classification;
  const operation = record.wouldAction === null
    ? record.action
    : `${record.action} (planned: ${record.wouldAction})`;
  const additional: string[] = [
    `File ID: ${formatPrettyValue(record.fileId)}`,
    `MIME type: ${formatPrettyValue(record.mimeType)}`,
    `Size: ${formatPrettyFileSize(record.sizeBytes)}`,
    `Execution: ${record.dryRun ? "Dry run — no file change applied" : "Live run"}`,
    `Duration: ${formatPrettyDuration(record.durationMs)}`,
  ];

  if (record.resultingFilename !== null) {
    additional.push(`Resulting file name: ${formatPrettyValue(record.resultingFilename)}`);
  }
  if (record.duplicateOfFileId !== null) {
    additional.push(`Exact duplicate of file ID: ${formatPrettyValue(record.duplicateOfFileId)}`);
  }
  if (record.possibleDuplicateOfFileIds.length > 0) {
    additional.push(
      `Possible duplicate file IDs (${record.possibleDuplicateOfFileIds.length}): ${record.possibleDuplicateOfFileIds.map(formatPrettyValue).join(", ")}`,
    );
  }
  if (record.errorKind !== null) {
    additional.push(`Error category: ${formatPrettyValue(record.errorKind)}`);
  }
  if (record.error !== null) {
    additional.push(`Error: ${formatPrettyValue(record.error.message)}`);
  }
  if (record.reason !== null && record.reason !== classification?.reason) {
    additional.push(`Processing reason: ${formatPrettyValue(record.reason)}`);
  }
  appendPrettyFolderCreationDetails(additional, record);

  return formatPrettyMessage("FILE OPERATION", [
    "File",
    `  Name: ${formatPrettyValue(record.originalFilename)}`,
    "Operation",
    `  Action: ${formatPrettyValue(operation)}`,
    "Destination",
    `  Path: ${formatPrettyNullableValue(record.destinationPath)}`,
    `  Folder ID: ${formatPrettyNullableValue(record.destinationFolderId)}`,
    "Gemini assessment",
    `  Document type: ${formatPrettyNullableValue(classification?.documentType ?? null)}`,
    `  Confidence: ${formatPrettyConfidence(classification?.confidence ?? null)}`,
    `  Reason: ${formatPrettyNullableValue(classification?.reason ?? null)}`,
    `  Suggested file name: ${formatPrettyNullableValue(classification?.suggestedFilename ?? null)}`,
    "Additional information",
    ...additional.map((detail) => `  ${detail}`),
  ]);
}

/** The STARTED and terminal batch records are the dedicated PRETTY run banners. */
function formatPrettyBatch(record: BatchLogRecord): string {
  if (record.status === "STARTED") {
    return formatPrettyMessage("DRIVE SORTER | RUN STARTED", [
      `Run ID: ${formatPrettyValue(record.runId)}`,
      `Execution mode: ${record.dryRun ? "DRY RUN" : "LIVE"}`,
      "The audit log is active. File processing is starting now.",
    ]);
  }

  const title = record.status === "COMPLETED"
    ? "DRIVE SORTER | RUN COMPLETED"
    : record.status === "FAILED"
      ? "DRIVE SORTER | RUN FAILED"
      : "DRIVE SORTER | RUN SKIPPED";
  const summary = [
    "Summary",
    `  Processed: ${record.processed}`,
    `  Moved: ${record.moved}`,
    `  Sent for review: ${record.reviewed}`,
    `  Duplicates: ${record.duplicates}`,
    `  Unsupported: ${record.unsupported}`,
    `  Errors: ${record.errors}`,
    `  Skipped: ${record.skipped}`,
    `  Folder proposals: ${record.folderProposals ?? 0}`,
    `  Accepted proposals: ${record.acceptedFolderProposals ?? 0}`,
    `  Created folders: ${record.createdFolders ?? 0}`,
    `  Elapsed time: ${formatPrettyDuration(record.elapsedMs)}`,
  ];
  if (record.message !== null) {
    summary.push(`Details: ${formatPrettyValue(record.message)}`);
  }
  return formatPrettyMessage(title, [
    `Run ID: ${formatPrettyValue(record.runId)}`,
    `Execution mode: ${record.dryRun ? "DRY RUN" : "LIVE"}`,
    ...summary,
  ]);
}

function formatPrettyAuditIntent(record: PersistentAuditIntentRecord): string {
  return formatPrettyMessage("ACTION INTENT", [
    `Action: ${formatPrettyValue(record.action)}`,
    `File ID: ${formatPrettyNullableValue(record.fileId)}`,
    "Destination",
    `  Path: ${formatPrettyNullableValue(record.destinationPath)}`,
    `  Folder ID: ${formatPrettyNullableValue(record.destinationFolderId)}`,
    `Execution mode: ${record.dryRun ? "DRY RUN" : "LIVE"}`,
    `Reason: ${formatPrettyValue(record.reason)}`,
  ]);
}

function formatPrettyAuditEvent(record: Record<string, unknown>): string {
  const event = typeof record.event === "string" ? record.event : "LOG_EVENT";
  const reason = typeof record.reason === "string" ? record.reason : null;
  const error = typeof record.error === "string" ? record.error : null;
  const failedAttempt = typeof record.failedAttempt === "number"
    ? record.failedAttempt
    : null;
  const nextAttempt = typeof record.nextAttempt === "number"
    ? record.nextAttempt
    : null;
  const httpStatus = typeof record.httpStatus === "number"
    ? record.httpStatus
    : null;
  const delayMs = typeof record.delayMs === "number" ? record.delayMs : null;
  const details = [
    `Event: ${formatPrettyValue(event)}`,
    ...(failedAttempt === null ? [] : [`Failed attempt: ${failedAttempt}`]),
    ...(nextAttempt === null ? [] : [`Next attempt: ${nextAttempt}`]),
    ...(httpStatus === null ? [] : [`HTTP status: ${httpStatus}`]),
    ...(delayMs === null ? [] : [`Retry delay: ${delayMs} ms`]),
    ...(reason === null ? [] : [`Details: ${formatPrettyValue(reason)}`]),
    ...(error === null ? [] : [`Error: ${formatPrettyValue(error)}`]),
  ];
  return formatPrettyMessage("RUN EVENT", details);
}

function appendPrettyFolderCreationDetails(
  details: string[],
  record: StructuredLogRecord,
): void {
  if (record.folderCreationMode !== undefined) {
    details.push(`Folder creation mode: ${formatPrettyValue(record.folderCreationMode)}`);
  }
  if (record.folderCreationDecision !== undefined) {
    details.push(`Folder creation decision: ${formatPrettyValue(record.folderCreationDecision)}`);
  }
  if (record.folderCreationThresholdPassed !== undefined && record.folderCreationThresholdPassed !== null) {
    details.push(`Folder creation confidence threshold: ${record.folderCreationThresholdPassed ? "Passed" : "Not passed"}`);
  }
  if (record.folderCreationProposal !== undefined && record.folderCreationProposal !== null) {
    details.push(`Proposed folder: ${formatPrettyValue(`${record.folderCreationProposal.parentFolderPath}/${record.folderCreationProposal.proposedSegments.join("/")}`)}`);
    details.push(`Proposal confidence: ${formatPrettyConfidence(record.folderCreationProposal.confidence)}`);
    details.push(`Proposal reason: ${formatPrettyValue(record.folderCreationProposal.reason)}`);
  }
  if (record.folderCreationProposalErrors !== undefined && record.folderCreationProposalErrors.length > 0) {
    details.push(`Folder proposal validation errors: ${record.folderCreationProposalErrors.map(formatPrettyValue).join(" | ")}`);
  }
  if (record.createdFolderPath !== undefined && record.createdFolderPath !== null) {
    details.push(`Created folder: ${formatPrettyValue(record.createdFolderPath)}`);
  }
  if (record.createdFolders !== undefined && record.createdFolders.length > 0) {
    details.push(`Created folders (${record.createdFolders.length}): ${record.createdFolders.map((folder) => `${folder.purpose}: ${formatPrettyValue(folder.path)}`).join(" | ")}`);
  }
  if (record.folderCreationPartialMutation === true) {
    details.push("Folder creation state: Partial mutation detected");
  }
}

function formatPrettyMessage(title: string, lines: readonly string[]): string {
  return [
    PRETTY_LOG_SEPARATOR,
    title,
    PRETTY_LOG_SUBSEPARATOR,
    ...lines,
    PRETTY_LOG_SEPARATOR,
  ].join("\n");
}

function formatPrettyNullableValue(value: string | null): string {
  return value === null ? "Not available" : formatPrettyValue(value);
}

function formatPrettyValue(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Not available";
}

function formatPrettyConfidence(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "Not available";
  }
  return `${(value * 100).toFixed(1)}% (${value.toFixed(2)})`;
}

function formatPrettyDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return "Not available";
  }
  return `${value} ms`;
}

function formatPrettyFileSize(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return "Not available";
  }
  if (value < 1_024) {
    return `${value} B`;
  }
  if (value < 1_048_576) {
    return `${(value / 1_024).toFixed(1)} KB`;
  }
  return `${(value / 1_048_576).toFixed(1)} MB`;
}
