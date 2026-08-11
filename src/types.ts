/**
 * Shared application contracts.
 *
 * Apps Script loads the compiled project as a single global program, so these
 * declarations intentionally do not use imports or exports.
 */

type ConfigScope = "DRIVE" | "GEMINI" | "FULL";

interface AppConfig {
  rootFolderId: string;
  inboxFolderId: string;
  reviewFolderId: string;
  dryRun: boolean;
  confidenceThreshold: number;
  maxFilesPerRun: number;
  maxFolderDepth: number;
  duplicateFolderName: string;
  geminiApiKey: string;
  geminiModel: string;
  renameFiles: boolean;
  maxInputBytes: number;
  maxHashBytes: number;
  maxTextChars: number;
  maxCandidateFolders: number;
  maxRunMillis: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  triggerMinutes: number;
  excludedFolderIds: string[];
  allowFolderCreation: boolean;
  fallbackFolderName: string;
}

interface FolderEntry {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  depth: number;
}

type FolderCandidate = FolderEntry;
type FolderLookup = Record<string, FolderEntry>;

interface FolderIndex {
  rootFolderId: string;
  folders: FolderEntry[];
  byId: FolderLookup;
  excludedFolderIds: string[];
  builtAt: string;
}

interface ClassificationResult {
  targetFolderId: string | null;
  targetFolderPath: string | null;
  documentType: string;
  suggestedFilename: string | null;
  confidence: number;
  reason: string;
}

type ClassificationValidationResult =
  | {
      valid: true;
      value: ClassificationResult;
      errors: [];
    }
  | {
      valid: false;
      value: null;
      errors: string[];
    };

interface GeminiTextPart {
  text: string;
}

interface GeminiInlineData {
  mimeType: string;
  data: string;
}

interface GeminiInlineDataPart {
  inlineData: GeminiInlineData;
}

type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiGenerationConfig {
  responseFormat: {
    text: {
      mimeType: "application/json";
      schema: unknown;
    };
  };
  maxOutputTokens?: number;
}

interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  generationConfig: GeminiGenerationConfig;
  systemInstruction?: {
    parts: GeminiTextPart[];
  };
}

interface GeminiResponsePart {
  text?: string;
}

interface GeminiResponseCandidate {
  content?: {
    parts?: GeminiResponsePart[];
    role?: string;
  };
  finishReason?: string;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiResponseCandidate[];
  promptFeedback?: unknown;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

type PreparedDocumentKind =
  | "TEXT"
  | "INLINE_DATA"
  | "GOOGLE_DOC_TEXT"
  | "UNSUPPORTED";

interface PreparedDocument {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: PreparedDocumentKind;
  parts: GeminiPart[];
  extractedText: string | null;
  truncated: boolean;
  unsupportedReason: string | null;
}

interface ExactDuplicateResult {
  isDuplicate: boolean;
  duplicateOfFileId: string | null;
  duplicateOfFilename: string | null;
  sourceSha256: string | null;
  comparedCandidateCount: number;
  possibleDuplicateFileIds: string[];
}

interface SourceFileSnapshot {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  lastUpdatedEpochMs: number;
}

type LogAction =
  | "MOVE"
  | "REVIEW"
  | "DUPLICATE"
  | "DRY_RUN"
  | "UNSUPPORTED"
  | "ERROR"
  | "SKIP";

type ProcessingErrorKind =
  | "CLASSIFICATION_UNCERTAIN"
  | "UNSUPPORTED"
  | "API_ERROR"
  | "INTERNAL_ERROR"
  | "CONFIG_ERROR"
  | "LOCK_UNAVAILABLE";

interface FileActionPlan {
  action: LogAction;
  destinationFolderId: string | null;
  destinationPath: string | null;
  destinationFilename: string | null;
  duplicateOfFileId: string | null;
  exactDuplicateSha256: string | null;
  possibleDuplicateOfFileIds: string[];
  sourceSnapshot: SourceFileSnapshot;
  classification: ClassificationResult | null;
  errorKind: ProcessingErrorKind | null;
  reason: string;
  requiresFolderCreation: boolean;
}

interface StructuredLogError {
  kind: ProcessingErrorKind;
  name: string;
  message: string;
  retryable: boolean;
}

interface StructuredLogRecord {
  timestamp: string;
  event: "FILE";
  runId: string;
  fileId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number | null;
  classification: ClassificationResult | null;
  action: LogAction;
  wouldAction: LogAction | null;
  destinationFolderId: string | null;
  destinationPath: string | null;
  resultingFilename: string | null;
  duplicateOfFileId: string | null;
  possibleDuplicateOfFileIds: string[];
  errorKind: ProcessingErrorKind | null;
  error: StructuredLogError | null;
  dryRun: boolean;
  durationMs: number | null;
  reason: string | null;
}

type BatchLogStatus =
  | "STARTED"
  | "COMPLETED"
  | "LOCK_SKIPPED"
  | "FAILED";

interface BatchLogRecord {
  timestamp: string;
  event: "BATCH";
  runId: string;
  status: BatchLogStatus;
  dryRun: boolean;
  processed: number;
  moved: number;
  reviewed: number;
  duplicates: number;
  unsupported: number;
  errors: number;
  skipped: number;
  elapsedMs: number;
  message: string | null;
}
