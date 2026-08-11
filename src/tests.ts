/** Read-only Drive smoke test. This function never invokes a mutation helper. */
function testDriveAccess(): void {
  const config = getAppConfig("DRIVE");
  const context = validateDriveConfiguration(config);
  const files = context.inbox.getFiles();
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();
    console.log(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "TEST_DRIVE_FILE",
        name: file.getName(),
        id: file.getId(),
        mimeType: file.getMimeType(),
        sizeBytes: file.getSize(),
      }),
    );
    count += 1;
  }

  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TEST_DRIVE_COMPLETE",
      inboxId: context.inbox.getId(),
      fileCount: count,
      readOnly: true,
    }),
  );
}

/**
 * Create one append-only audit Google Doc in ROOT_FOLDER_ID and write a small
 * smoke-test record. Unlike the other manual tests, this intentionally writes
 * only the audit document; it never reads, renames, or moves inbox files.
 */
function testPersistentAuditLog(): void {
  const config = getAppConfig("DRIVE");
  const context = validateDriveConfiguration(config);
  const startedAt = Date.now();
  const runId = createRunId();
  const logFolder = ensureAuditLogFolder(config, context).folder;
  const audit = startPersistentAuditLog(context.root, logFolder, runId, startedAt);

  try {
    logPersistentAuditEvent({
      timestamp: isoTimestamp(),
      event: "TEST_PERSISTENT_AUDIT_LOG_COMPLETE",
      runId,
      auditDocumentId: audit.documentId,
      auditFilename: audit.filename,
      rootFolderId: context.root.getId(), logFolderId: logFolder.getId(),
      status: "ok",
      driveModified: "audit_document_only",
    });
  } finally {
    finishPersistentAuditLog();
  }
}

/**
 * End-to-end smoke test for the Gemini companion report. It writes only a new
 * synthetic raw audit and its report into ROOT_FOLDER_ID; no inbox file or
 * folder is read, moved, renamed, or created.
 */
function testHumanReadableReport(): void {
  const config = getAppConfig("FULL");
  const context = validateDriveConfiguration(config);
  const startedAt = Date.now();
  const deadlineEpochMs = startedAt + Math.min(config.maxRunMillis, 60_000);
  const runId = createRunId();
  const logFolder = ensureAuditLogFolder(config, context).folder;
  startPersistentAuditLog(context.root, logFolder, runId, startedAt);

  try {
    logOperation(
      createStructuredLogRecord({
        runId,
        fileId: "manual-human-report-smoke-test",
        originalFilename: "Esempio report leggibile.pdf",
        mimeType: "application/pdf",
        sizeBytes: 0,
        classification: null,
        action: "DRY_RUN",
        wouldAction: "MOVE",
        destinationFolderId: null,
        destinationPath: "Esempio/Destinazione",
        resultingFilename: "Esempio report leggibile.pdf",
        duplicateOfFileId: null,
        possibleDuplicateOfFileIds: [],
        errorKind: null,
        error: null,
        dryRun: true,
        durationMs: 0,
        reason: "Record sintetico per verificare il report leggibile.",
      }),
    );
    logBatch(
      createBatchLogRecord({
        runId,
        status: "COMPLETED",
        dryRun: true,
        processed: 1,
        moved: 0,
        reviewed: 0,
        duplicates: 0,
        unsupported: 0,
        errors: 0,
        skipped: 0,
        elapsedMs: Date.now() - startedAt,
        message: "Synthetic human-readable report smoke test.",
      }),
    );
    const report = finalizeHumanReadableRunReport(
      config,
      logFolder,
      runId,
      deadlineEpochMs,
    );
    if (report === null) {
      throw new Error(
        "Human-readable report was not created; inspect the raw audit log for HUMAN_REPORT_ERROR.",
      );
    }
  } finally {
    finishPersistentAuditLog();
  }
}

/** Build and print the exact candidate tree without creating any folder. */
function testFolderTree(): void {
  const config = getAppConfig("DRIVE");
  const context = validateDriveConfiguration(config);
  const index = buildFolderIndex(config, context);

  index.folders.forEach((folder) => {
    console.log(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "TEST_FOLDER_CANDIDATE",
        folderId: folder.id,
        path: folder.path,
        depth: folder.depth,
      }),
    );
  });
  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TEST_FOLDER_TREE_COMPLETE",
      candidateCount: index.folders.length,
      withinConfiguredLimit:
        index.folders.length <= config.maxCandidateFolders,
      readOnly: true,
    }),
  );
}

/** Minimal Gemini API health check; it does not read or modify Drive. */
function testGemini(): void {
  const config = getAppConfig("GEMINI");
  const ok = checkGeminiConnection(config);
  if (!ok) {
    throw new Error("Gemini health check returned an unexpected result.");
  }
  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TEST_GEMINI_COMPLETE",
      model: config.geminiModel,
      status: "ok",
      driveModified: false,
    }),
  );
}

/**
 * Read-only end-to-end smoke test for the optional missing-folder proposal.
 *
 * The test deliberately forces an in-memory SUGGEST/DRY_RUN configuration so
 * it remains read-only even if the stored rollout mode is AUTO and DRY_RUN is
 * false. It prepares only the first direct inbox file, builds one trusted
 * index, and makes at most one proposal request. It never calls the Drive
 * mutation boundary.
 */
function testFolderCreationProposal(): void {
  const storedConfig = getAppConfig("FULL");
  const testConfig: AppConfig = {
    ...storedConfig,
    dryRun: true,
    folderCreationMode: "SUGGEST",
    folderCreationConfidenceThreshold: Math.max(
      storedConfig.folderCreationConfidenceThreshold,
      storedConfig.confidenceThreshold,
    ),
  };
  const context = validateDriveConfiguration(testConfig);
  const index = buildFolderIndex(testConfig, context);
  const creationContexts = buildFolderCreationContexts(index, testConfig);
  const files = context.inbox.getFiles();

  if (creationContexts.length === 0) {
    console.log(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "TEST_FOLDER_PROPOSAL_COMPLETE",
        status: "no_eligible_creation_context",
        configuredMode: storedConfig.folderCreationMode,
        effectiveMode: testConfig.folderCreationMode,
        configuredCreationThreshold:
          storedConfig.folderCreationConfidenceThreshold,
        effectiveCreationThreshold:
          testConfig.folderCreationConfidenceThreshold,
        candidateFolderCount: index.folders.length,
        creationContextCount: 0,
        proposalRequestMade: false,
        readOnly: true,
        driveModified: false,
      }),
    );
    return;
  }

  if (!files.hasNext()) {
    console.log(
      safeJsonStringify({
        timestamp: isoTimestamp(),
        event: "TEST_FOLDER_PROPOSAL_COMPLETE",
        status: "inbox_empty",
        configuredMode: storedConfig.folderCreationMode,
        effectiveMode: testConfig.folderCreationMode,
        configuredCreationThreshold:
          storedConfig.folderCreationConfidenceThreshold,
        effectiveCreationThreshold:
          testConfig.folderCreationConfidenceThreshold,
        candidateFolderCount: index.folders.length,
        creationContextCount: creationContexts.length,
        proposalRequestMade: false,
        readOnly: true,
        driveModified: false,
      }),
    );
    return;
  }

  const file = files.next();
  const prepared = prepareDocument(file, testConfig);
  const evaluation = evaluateFolderCreationProposal(
    prepared,
    index,
    testConfig,
    Date.now() + testConfig.maxRunMillis,
  );

  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TEST_FOLDER_PROPOSAL_COMPLETE",
      status: evaluation.status,
      configuredMode: storedConfig.folderCreationMode,
      effectiveMode: testConfig.folderCreationMode,
      configuredCreationThreshold:
        storedConfig.folderCreationConfidenceThreshold,
      effectiveCreationThreshold:
        testConfig.folderCreationConfidenceThreshold,
      fileId: file.getId(),
      filename: file.getName(),
      mimeType: file.getMimeType(),
      candidateFolderCount: index.folders.length,
      creationContextCount: creationContexts.length,
      proposalRequestMade: true,
      proposal: evaluation.proposal,
      validationErrors: evaluation.errors,
      readOnly: true,
      driveModified: false,
    }),
  );
}

/** Deterministic SHA-256 self-test using a memory-only blob. */
function testHashing(): void {
  const actual = sha256HexFromBytes(
    Utilities.newBlob("abc", "text/plain").getBytes(),
  );
  const expected =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  if (actual !== expected) {
    throw new Error(`SHA-256 self-test failed: ${actual}`);
  }
  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TEST_HASHING_COMPLETE",
      status: "ok",
    }),
  );
}

/** Pure collision/extension test; it does not access Drive. */
function testFilenameCollision(): void {
  const actual = generateNonConflictingFilenameFromNames("documento.pdf", [
    "documento.pdf",
    "documento (2).pdf",
    "documento (3).pdf",
  ]);
  const expected = "documento (4).pdf";
  if (actual !== expected) {
    throw new Error(`Filename collision self-test failed: ${actual}`);
  }

  const preserved = buildSafeFilename("originale.PDF", "nuovo-nome.docx");
  if (preserved !== "nuovo-nome.PDF") {
    throw new Error(`Filename extension self-test failed: ${preserved}`);
  }
  console.log(
    safeJsonStringify({
      timestamp: isoTimestamp(),
      event: "TEST_FILENAME_COMPLETE",
      status: "ok",
      generatedFilename: actual,
    }),
  );
}
