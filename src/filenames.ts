const MAX_SAFE_FILENAME_LENGTH = 200;
const MAX_FILENAME_COLLISION_ATTEMPTS = 10000;

interface FilenameParts {
  stem: string;
  extension: string;
}

function splitFilename(filename: string): FilenameParts {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return { stem: trimmed, extension: "" };
  }

  return {
    stem: trimmed.slice(0, lastDot),
    extension: trimmed.slice(lastDot),
  };
}

function sanitizeFilenameComponent(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .trim();
}

function clampFilename(stem: string, extension: string): string {
  const safeExtension = extension.slice(0, 24);
  const maximumStemLength = Math.max(
    1,
    MAX_SAFE_FILENAME_LENGTH - safeExtension.length,
  );
  const clampedStem = stem.slice(0, maximumStemLength).replace(/[\s.]+$/g, "");
  return `${clampedStem || "documento"}${safeExtension}`;
}

/**
 * Sanitizes a name while always preserving the original file extension. The
 * model-provided extension, if any, is deliberately ignored.
 */
function buildSafeFilename(
  originalFilename: string,
  suggestedFilename: string | null,
): string {
  const original = splitFilename(originalFilename);
  const sanitizedOriginalStem =
    sanitizeFilenameComponent(original.stem) || "documento";
  const sanitizedExtension = original.extension
    .replace(/[^.A-Za-z0-9_-]/g, "")
    .slice(0, 24);

  if (!suggestedFilename) {
    // An existing Drive filename is already valid. With renaming disabled it
    // must remain byte-for-byte unchanged unless collision handling adds a
    // suffix later.
    return originalFilename;
  }

  const suggestion = splitFilename(suggestedFilename);
  const suggestedStem = sanitizeFilenameComponent(suggestion.stem);
  return clampFilename(
    suggestedStem || sanitizedOriginalStem,
    sanitizedExtension,
  );
}

function appendFilenameCounter(filename: string, counter: number): string {
  const parts = splitFilename(filename);
  const suffix = ` (${counter})`;
  const maximumStemLength = Math.max(
    1,
    MAX_SAFE_FILENAME_LENGTH - parts.extension.length - suffix.length,
  );
  const stem = parts.stem.slice(0, maximumStemLength).replace(/[\s.]+$/g, "");
  return `${stem || "documento"}${suffix}${parts.extension}`;
}

function generateNonConflictingFilenameFromNames(
  desiredFilename: string,
  existingFilenames: string[],
): string {
  const existing = new Set(existingFilenames);
  if (!existing.has(desiredFilename)) {
    return desiredFilename;
  }

  for (let counter = 2; counter <= MAX_FILENAME_COLLISION_ATTEMPTS; counter += 1) {
    const candidate = appendFilenameCounter(desiredFilename, counter);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Impossibile generare un filename non in conflitto.");
}

function generateNonConflictingFilename(
  folder: GoogleAppsScript.Drive.Folder,
  desiredFilename: string,
  additionalReservedNames: string[] = [],
): string {
  const reserved = new Set(additionalReservedNames);
  const isAvailable = (filename: string): boolean =>
    !reserved.has(filename) && !folder.getFilesByName(filename).hasNext();

  if (isAvailable(desiredFilename)) {
    return desiredFilename;
  }
  for (let counter = 2; counter <= MAX_FILENAME_COLLISION_ATTEMPTS; counter += 1) {
    const candidate = appendFilenameCounter(desiredFilename, counter);
    if (isAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error("Impossibile generare un filename Drive non in conflitto.");
}

function sanitizeFolderName(value: string): string {
  return sanitizeFilenameComponent(value).slice(0, 100);
}
