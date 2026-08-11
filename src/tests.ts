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

