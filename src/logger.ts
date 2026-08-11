let activePersistentAuditLog: PersistentAuditLogInfo | null = null;
let persistentAuditLogFailure: string | null = null;
const HUMAN_REPORT_RAW_LOG_MAX_CHARS = 100_000;
let persistentAuditSerializedLines: string[] = [];
let persistentAuditSerializedChars = 0;
let persistentAuditInputTruncated = false;

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
  persistentAuditLogFailure = null;
  persistentAuditSerializedLines = [];
  persistentAuditSerializedChars = 0;
  persistentAuditInputTruncated = false;
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
    reason:
      "Persistent audit document initialized before document processing.",
  });
  return { ...activePersistentAuditLog };
}

/** End the in-memory session; every append is already saved and closed. */
function finishPersistentAuditLog(): void {
  activePersistentAuditLog = null;
  persistentAuditLogFailure = null;
  persistentAuditSerializedLines = [];
  persistentAuditSerializedChars = 0;
  persistentAuditInputTruncated = false;
}

function getPersistentAuditLogInfo(): PersistentAuditLogInfo | null {
  return activePersistentAuditLog === null
    ? null
    : { ...activePersistentAuditLog };
}

/** Return the bounded JSONL source that can safely be summarized by Gemini. */
function getPersistentAuditLogSnapshot(): PersistentAuditLogSnapshot | null {
  if (activePersistentAuditLog === null) {
    return null;
  }
  return {
    audit: { ...activePersistentAuditLog },
    serializedLines: persistentAuditSerializedLines.slice(),
    inputTruncated: persistentAuditInputTruncated,
  };
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
    capturePersistentAuditLine(serializedRecord);
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

/**
 * Keep an in-memory copy of the exact persisted JSONL for the one optional
 * report request. The authoritative document itself is never truncated.
 */
function capturePersistentAuditLine(serializedRecord: string): void {
  if (persistentAuditInputTruncated) {
    return;
  }
  const separatorLength =
    persistentAuditSerializedLines.length === 0 ? 0 : 1;
  const nextLength =
    persistentAuditSerializedChars + separatorLength + serializedRecord.length;
  if (nextLength > HUMAN_REPORT_RAW_LOG_MAX_CHARS) {
    persistentAuditInputTruncated = true;
    return;
  }
  persistentAuditSerializedLines.push(serializedRecord);
  persistentAuditSerializedChars = nextLength;
}

/** Console remains useful in the editor; the same sanitized line is persisted. */
function emitAuditLine(serializedRecord: string): void {
  console.log(serializedRecord);
  appendToPersistentAuditLog(serializedRecord);
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
  emitAuditLine(safeJsonStringify(sanitized));
}

/** Persist a bounded lifecycle record that is not a normal file/batch result. */
function logPersistentAuditEvent(record: Record<string, unknown>): void {
  emitAuditLine(safeJsonStringify(record));
}

/** Emit one complete, single-line JSON record for a processed file. */
function logOperation(record: StructuredLogRecord): void {
  emitAuditLine(safeJsonStringify(sanitizeStructuredLogRecord(record)));
}

/** Alias with an explicit name for callers that prefer it. */
function logFileOperation(record: StructuredLogRecord): void {
  logOperation(record);
}

/** Emit one complete, single-line JSON record for a batch lifecycle event. */
function logBatch(record: BatchLogRecord): void {
  emitAuditLine(safeJsonStringify(sanitizeBatchLogRecord(record)));
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
