const GOOGLE_WORKSPACE_MIME_PREFIX = "application/vnd.google-apps.";

function isHashableDriveFile(
  file: GoogleAppsScript.Drive.File,
  maxHashBytes: number,
): boolean {
  const size = file.getSize();
  return (
    !file.getMimeType().startsWith(GOOGLE_WORKSPACE_MIME_PREFIX) &&
    size >= 0 &&
    size <= maxHashBytes
  );
}

function sha256HexFromBytes(bytes: number[]): string {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    bytes,
  );
  return digest
    .map((value) => ((value + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
}

function computeFileSha256(
  file: GoogleAppsScript.Drive.File,
  maxHashBytes: number,
): string | null {
  if (!isHashableDriveFile(file, maxHashBytes)) {
    return null;
  }

  const bytes = file.getBlob().getBytes();
  if (bytes.length > maxHashBytes) {
    return null;
  }
  return sha256HexFromBytes(bytes);
}

function normalizeComparableFilename(filename: string): string {
  return filename.trim().toLowerCase();
}

/**
 * Declares a duplicate only after an exact SHA-256 match. Same-name files with
 * a different or unavailable digest are merely reported as possible matches.
 */
function findExactDuplicate(
  sourceFile: GoogleAppsScript.Drive.File,
  destinationFolder: GoogleAppsScript.Drive.Folder,
  config: AppConfig,
  deadlineEpochMs?: number,
): ExactDuplicateResult {
  const possibleDuplicateFileIds: string[] = [];
  const sourceFilename = normalizeComparableFilename(sourceFile.getName());
  const sourceSize = sourceFile.getSize();
  const sourceHashable = isHashableDriveFile(sourceFile, config.maxHashBytes);
  let sourceSha256: string | null = null;
  let comparedCandidateCount = 0;

  const candidates = destinationFolder.getFiles();
  while (candidates.hasNext()) {
    if (deadlineEpochMs !== undefined && Date.now() >= deadlineEpochMs) {
      throw new SorterError(
        "API_ERROR",
        "RUNTIME_DEADLINE_EXHAUSTED",
        "Runtime deadline reached during exact duplicate detection; file left in inbox.",
        { retryable: true },
      );
    }

    const candidate = candidates.next();
    if (candidate.getId() === sourceFile.getId()) {
      continue;
    }

    const sameName =
      normalizeComparableFilename(candidate.getName()) === sourceFilename;
    if (sameName) {
      possibleDuplicateFileIds.push(candidate.getId());
    }

    if (
      !sourceHashable ||
      candidate.getSize() !== sourceSize ||
      !isHashableDriveFile(candidate, config.maxHashBytes)
    ) {
      continue;
    }

    try {
      if (sourceSha256 === null) {
        sourceSha256 = computeFileSha256(sourceFile, config.maxHashBytes);
      }
      const candidateSha256 = computeFileSha256(
        candidate,
        config.maxHashBytes,
      );
      comparedCandidateCount += 1;
      if (
        sourceSha256 !== null &&
        candidateSha256 !== null &&
        sourceSha256 === candidateSha256
      ) {
        return {
          isDuplicate: true,
          duplicateOfFileId: candidate.getId(),
          duplicateOfFilename: candidate.getName(),
          sourceSha256,
          comparedCandidateCount,
          possibleDuplicateFileIds: possibleDuplicateFileIds.filter(
            (id) => id !== candidate.getId(),
          ),
        };
      }
    } catch (_error) {
      if (
        sameName &&
        !possibleDuplicateFileIds.includes(candidate.getId())
      ) {
        possibleDuplicateFileIds.push(candidate.getId());
      }
    }
  }

  return {
    isDuplicate: false,
    duplicateOfFileId: null,
    duplicateOfFilename: null,
    sourceSha256,
    comparedCandidateCount,
    possibleDuplicateFileIds,
  };
}
