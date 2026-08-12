/**
 * Shared application contracts.
 *
 * Apps Script loads the compiled project as a single global program, so these
 * declarations intentionally do not use imports or exports.
 */

type ConfigScope = "DRIVE" | "GEMINI" | "FULL";
type LogLevel = "JSON" | "PRETTY" | "FULL";
type FolderCreationMode = "OFF" | "SUGGEST" | "AUTO";
type FolderCreationPatternType = "TEMPORAL" | "SEMANTIC" | "OTHER";
type CreatedFolderPurpose = "TAXONOMY" | "DUPLICATES";

interface CreatedFolderRecord {
  id: string;
  path: string;
  purpose: CreatedFolderPurpose;
}
type FolderCreationDecision =
  | "NOT_EVALUATED"
  | "NO_CONTEXT"
  | "MODEL_DECLINED"
  | "REJECTED"
  | "SUGGESTED"
  | "AUTO_APPROVED"
  | "API_ERROR";

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
  logFolderName: string;
  logLevel: LogLevel;
  allowFolderCreation: boolean;
  fallbackFolderName: string;
  folderCreationMode: FolderCreationMode;
  folderCreationConfidenceThreshold: number;
  folderCreationMaxFinalDepth: number;
  folderCreationMaxNewSegments: number;
  folderCreationMinSiblingEvidence: number;
  folderCreationSemanticGroups: string[][];
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
type FolderChildrenLookup = Record<string, FolderEntry[]>;
type FolderNameLookup = Record<string, FolderEntry[]>;
type FolderChildrenByNameLookup = Record<string, FolderNameLookup>;

interface FolderIndex {
  rootFolderId: string;
  folders: FolderEntry[];
  byId: FolderLookup;
  childrenByParentId: FolderChildrenLookup;
  childrenByNormalizedNameByParentId: FolderChildrenByNameLookup;
  excludedFolderIds: string[];
  reservedNormalizedNames: string[];
  isComplete: boolean;
  invalidReason: string | null;
  builtAt: string;
}

/**
 * Gemini may propose this value, but it never supplies a new Drive folder ID.
 * Every parent and evidence ID must be resolved again through FolderIndex.
 */
interface FolderCreationProposal {
  parentFolderId: string;
  parentFolderPath: string;
  proposedSegments: string[];
  patternType: FolderCreationPatternType;
  evidenceFolderIds: string[];
  confidence: number;
  reason: string;
}

interface TemporalSiblingEvidence {
  parentFolderId: string;
  parentFolderPath: string;
  evidenceFolderIds: string[];
  observedYears: number[];
  minimumYear: number;
  maximumYear: number;
}

interface FolderCreationContext {
  parentFolderId: string;
  parentFolderPath: string;
  parentDepth: number;
  childFolders: FolderEntry[];
  temporalEvidence: TemporalSiblingEvidence | null;
}

interface ValidatedFolderCreationProposal {
  proposal: FolderCreationProposal;
  parentFolder: FolderEntry;
  evidenceFolders: FolderEntry[];
  finalPath: string;
  finalDepth: number;
}

interface FolderCreationProposalEvaluation {
  status: "NO_PROPOSAL" | "VALID" | "INVALID";
  proposal: FolderCreationProposal | null;
  errors: string[];
}

type FolderCreationValidationResult =
  | {
      valid: true;
      value: ValidatedFolderCreationProposal;
      errors: [];
    }
  | {
      valid: false;
      value: null;
      errors: string[];
    };

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
      mimeType: "APPLICATION_JSON";
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
  | "SUGGEST_FOLDER"
  | "CREATE_FOLDER_AND_MOVE"
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
  folderCreationProposal?: FolderCreationProposal | null;
  folderCreationDecision?: FolderCreationDecision;
  folderCreationProposalErrors?: string[];
  folderCreationProposalRequestMade?: boolean;
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
  folderCreationMode?: FolderCreationMode;
  folderCreationDecision?: FolderCreationDecision;
  folderCreationProposal?: FolderCreationProposal | null;
  folderCreationProposalErrors?: string[];
  folderCreationThresholdPassed?: boolean | null;
  createdFolderId?: string | null;
  createdFolderPath?: string | null;
  createdFolders?: CreatedFolderRecord[];
  folderCreationPartialMutation?: boolean;
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
  folderProposals?: number;
  acceptedFolderProposals?: number;
  createdFolders?: number;
  rejectedFolderProposals?: number;
  folderProposalApiErrors?: number;
  partialFolderCreations?: number;
}

/**
 * Metadata for the append-only Google Doc created for one runSorter execution.
 * The document contains only already-sanitized logger output in the configured
 * JSON, PRETTY, or FULL representation.
 */
interface PersistentAuditLogInfo {
  runId: string;
  documentId: string;
  fileId: string;
  filename: string;
  rootFolderId: string;
  logFolderId: string;
  logFolderPath: string;
  startedAt: string;
  linesWritten: number;
}

/** A durable intent marker written immediately before a live Drive mutation. */
interface PersistentAuditIntentRecord {
  timestamp: string;
  event: "ACTION_INTENT" | "FALLBACK_FOLDER_CREATION_INTENT";
  runId: string;
  fileId: string | null;
  action: LogAction | "CREATE_FALLBACK_FOLDER";
  destinationFolderId: string | null;
  destinationPath: string | null;
  dryRun: boolean;
  reason: string;
}
