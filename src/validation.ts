/** Runtime validation for model-generated classification proposals. */

const CLASSIFICATION_FIELDS: readonly string[] = Object.freeze([
  "targetFolderId",
  "targetFolderPath",
  "documentType",
  "suggestedFilename",
  "confidence",
  "reason",
]);

const CLASSIFICATION_MAX_DOCUMENT_TYPE_LENGTH = 120;
const CLASSIFICATION_MAX_REASON_LENGTH = 500;
const CLASSIFICATION_MAX_FILENAME_LENGTH = 255;
const CLASSIFICATION_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const CLASSIFICATION_FILENAME_FORBIDDEN_PATTERN =
  /[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

/**
 * Validate untrusted Gemini output against both its shape and the exact folder
 * ID/path pairs supplied to the model. TypeScript types alone are never used as
 * an authorization decision.
 */
function validateClassification(
  value: unknown,
  candidates: readonly FolderCandidate[],
): ClassificationValidationResult {
  const errors: string[] = [];

  if (!isClassificationRecord(value)) {
    return {
      valid: false,
      value: null,
      errors: ["Classification must be a JSON object."],
    };
  }

  const keys = Object.keys(value);
  for (const field of CLASSIFICATION_FIELDS) {
    if (!hasClassificationOwnProperty(value, field)) {
      errors.push(`Missing required field: ${field}.`);
    }
  }
  for (const key of keys) {
    if (!CLASSIFICATION_FIELDS.includes(key)) {
      errors.push(`Unexpected field: ${key}.`);
    }
  }

  const targetFolderId = value.targetFolderId;
  const targetFolderPath = value.targetFolderPath;
  const documentType = value.documentType;
  const suggestedFilename = value.suggestedFilename;
  const confidence = value.confidence;
  const reason = value.reason;

  const folderIdIsValidType =
    targetFolderId === null || isReasonableClassificationString(targetFolderId, 256);
  if (!folderIdIsValidType) {
    errors.push("targetFolderId must be null or a non-empty, trimmed string.");
  }

  const folderPathIsValidType =
    targetFolderPath === null ||
    isReasonableClassificationString(targetFolderPath, 1_000);
  if (!folderPathIsValidType) {
    errors.push("targetFolderPath must be null or a non-empty, trimmed string.");
  }

  if ((targetFolderId === null) !== (targetFolderPath === null)) {
    errors.push("targetFolderId and targetFolderPath must either both be null or both be strings.");
  }

  if (
    typeof targetFolderId === "string" &&
    typeof targetFolderPath === "string" &&
    folderIdIsValidType &&
    folderPathIsValidType
  ) {
    const exactCandidate = candidates.some(
      (candidate) =>
        candidate.id === targetFolderId && candidate.path === targetFolderPath,
    );
    if (!exactCandidate) {
      const idExists = candidates.some((candidate) => candidate.id === targetFolderId);
      errors.push(
        idExists
          ? "targetFolderPath does not match the supplied path for targetFolderId."
          : "targetFolderId is not in the supplied candidate list.",
      );
    }
  }

  if (
    !isReasonableClassificationString(
      documentType,
      CLASSIFICATION_MAX_DOCUMENT_TYPE_LENGTH,
    )
  ) {
    errors.push("documentType must be a short, non-empty, single-line string.");
  }

  if (
    suggestedFilename !== null &&
    !isReasonableSuggestedFilename(suggestedFilename)
  ) {
    errors.push("suggestedFilename must be null or a safe, non-empty filename.");
  }

  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    errors.push("confidence must be a finite number between 0 and 1.");
  }

  if (!isReasonableClassificationString(reason, CLASSIFICATION_MAX_REASON_LENGTH)) {
    errors.push("reason must be a brief, non-empty, single-line string.");
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: {
      targetFolderId: targetFolderId as string | null,
      targetFolderPath: targetFolderPath as string | null,
      documentType: documentType as string,
      suggestedFilename: suggestedFilename as string | null,
      confidence: confidence as number,
      reason: reason as string,
    },
    errors: [],
  };
}

function isClassificationRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasClassificationOwnProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isReasonableClassificationString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !CLASSIFICATION_CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isReasonableSuggestedFilename(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CLASSIFICATION_MAX_FILENAME_LENGTH ||
    value !== value.trim() ||
    CLASSIFICATION_FILENAME_FORBIDDEN_PATTERN.test(value)
  ) {
    return false;
  }

  return value !== "." && value !== "..";
}
