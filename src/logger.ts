/** Emit one complete, single-line JSON record for a processed file. */
function logOperation(record: StructuredLogRecord): void {
  console.log(safeJsonStringify(sanitizeStructuredLogRecord(record)));
}

/** Alias with an explicit name for callers that prefer it. */
function logFileOperation(record: StructuredLogRecord): void {
  logOperation(record);
}

/** Emit one complete, single-line JSON record for a batch lifecycle event. */
function logBatch(record: BatchLogRecord): void {
  console.log(safeJsonStringify(sanitizeBatchLogRecord(record)));
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
