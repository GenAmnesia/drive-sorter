/**
 * Read-only preparation of Drive files for Gemini.
 *
 * This module never changes a Drive file. Binary data is included inline only
 * after enforcing MAX_INPUT_BYTES; long text is additionally bounded by
 * MAX_TEXT_CHARS to keep requests suitable for Apps Script and Free Tier use.
 */

const DOCUMENT_MIME_PDF = "application/pdf";
const DOCUMENT_MIME_JPEG = "image/jpeg";
const DOCUMENT_MIME_PNG = "image/png";
const DOCUMENT_MIME_TEXT = "text/plain";
const DOCUMENT_MIME_DOC = "application/msword";
const DOCUMENT_MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCUMENT_MIME_GOOGLE_DOC = "application/vnd.google-apps.document";

const DOCUMENT_INLINE_MIME_TYPES: Readonly<Record<string, true>> = Object.freeze({
  [DOCUMENT_MIME_PDF]: true,
  [DOCUMENT_MIME_JPEG]: true,
  [DOCUMENT_MIME_PNG]: true,
});

const DOCUMENT_CONVERT_TO_PDF_MIME_TYPES: Readonly<Record<string, true>> =
  Object.freeze({
    [DOCUMENT_MIME_DOC]: true,
    [DOCUMENT_MIME_DOCX]: true,
    [DOCUMENT_MIME_GOOGLE_DOC]: true,
  });

/**
 * Prepare one supported Drive file without mutating it.
 *
 * @throws {SorterError} with category UNSUPPORTED when the MIME type is not
 * supported or the source/prepared data is too large. Conversion failures are
 * treated as infrastructure errors because Apps Script does not expose a
 * reliable way to distinguish a permanent format issue from quota/outage.
 */
function prepareDocument(
  file: GoogleAppsScript.Drive.File,
  config: AppConfig,
): PreparedDocument {
  const fileId = file.getId();
  const filename = file.getName();
  const mimeType = normalizeDocumentMimeType(file.getMimeType());
  const sizeBytes = Math.max(0, file.getSize());

  assertDocumentLimit(config.maxInputBytes, "MAX_INPUT_BYTES");
  assertDocumentLimit(config.maxTextChars, "MAX_TEXT_CHARS");

  // Native Google files can report zero or implementation-specific sizes, so
  // every blob is checked again after reading or conversion.
  if (sizeBytes > config.maxInputBytes) {
    throw new SorterError(
      "UNSUPPORTED",
      "DOCUMENT_TOO_LARGE",
      "The document exceeds the configured input-size limit.",
      { retryable: false },
    );
  }

  if (mimeType === DOCUMENT_MIME_TEXT) {
    return prepareUtf8TextDocument(
      file,
      fileId,
      filename,
      mimeType,
      sizeBytes,
      config,
    );
  }

  if (DOCUMENT_INLINE_MIME_TYPES[mimeType] === true) {
    return prepareInlineBlobDocument(
      file.getBlob(),
      fileId,
      filename,
      mimeType,
      sizeBytes,
      mimeType,
      config.maxInputBytes,
    );
  }

  if (DOCUMENT_CONVERT_TO_PDF_MIME_TYPES[mimeType] === true) {
    let convertedBlob: GoogleAppsScript.Base.Blob;
    try {
      convertedBlob = file.getAs(DOCUMENT_MIME_PDF);
    } catch (_error) {
      throw new SorterError(
        "API_ERROR",
        "DOCUMENT_CONVERSION_FAILED",
        "Drive could not convert the document to PDF; it was left in the inbox.",
        { retryable: true },
      );
    }

    return prepareInlineBlobDocument(
      convertedBlob,
      fileId,
      filename,
      mimeType,
      sizeBytes,
      DOCUMENT_MIME_PDF,
      config.maxInputBytes,
    );
  }

  throw new SorterError(
    "UNSUPPORTED",
    "UNSUPPORTED_MIME_TYPE",
    "The document MIME type is not supported for classification.",
    { retryable: false },
  );
}

function prepareUtf8TextDocument(
  file: GoogleAppsScript.Drive.File,
  fileId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
  config: AppConfig,
): PreparedDocument {
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  assertPreparedByteLength(bytes.length, config.maxInputBytes);

  let text = blob.getDataAsString("UTF-8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const bounded = boundDocumentText(text, config.maxTextChars);
  return {
    fileId,
    filename,
    mimeType,
    sizeBytes,
    kind: "TEXT",
    parts: [{ text: bounded.text }],
    extractedText: bounded.text,
    truncated: bounded.truncated,
    unsupportedReason: null,
  };
}

function prepareInlineBlobDocument(
  blob: GoogleAppsScript.Base.Blob,
  fileId: string,
  filename: string,
  originalMimeType: string,
  originalSizeBytes: number,
  inlineMimeType: string,
  maxInputBytes: number,
): PreparedDocument {
  const bytes = blob.getBytes();
  assertPreparedByteLength(bytes.length, maxInputBytes);

  return {
    fileId,
    filename,
    mimeType: originalMimeType,
    sizeBytes: originalSizeBytes,
    kind: "INLINE_DATA",
    parts: [
      {
        inlineData: {
          mimeType: inlineMimeType,
          data: Utilities.base64Encode(bytes),
        },
      },
    ],
    extractedText: null,
    truncated: false,
    unsupportedReason: null,
  };
}

function assertPreparedByteLength(actualBytes: number, maxInputBytes: number): void {
  if (actualBytes > maxInputBytes) {
    throw new SorterError(
      "UNSUPPORTED",
      "DOCUMENT_TOO_LARGE",
      "The prepared document exceeds the configured input-size limit.",
      { retryable: false },
    );
  }
}

function assertDocumentLimit(value: number, propertyName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${propertyName} must be a positive integer.`);
  }
}

function normalizeDocumentMimeType(value: string): string {
  return value.trim().toLowerCase();
}

function boundDocumentText(
  text: string,
  maxTextChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxTextChars) {
    return { text, truncated: false };
  }

  let end = maxTextChars;
  // Do not leave a dangling UTF-16 high surrogate at the truncation boundary.
  if (end > 0) {
    const finalCodeUnit = text.charCodeAt(end - 1);
    if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
      end -= 1;
    }
  }

  return { text: text.slice(0, end), truncated: true };
}
