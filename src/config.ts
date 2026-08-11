const CONFIG_DEFAULTS = Object.freeze({
  dryRun: true,
  confidenceThreshold: 0.85,
  maxFilesPerRun: 10,
  maxFolderDepth: 10,
  duplicateFolderName: "Duplicati",
  renameFiles: false,
  maxInputBytes: 10_485_760,
  maxHashBytes: 10_485_760,
  maxTextChars: 100_000,
  maxCandidateFolders: 500,
  maxRunMillis: 270_000,
  maxRetries: 3,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
  triggerMinutes: 15,
  allowFolderCreation: false,
  fallbackFolderName: "Altro",
});

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const ALLOWED_TRIGGER_MINUTES: readonly number[] = [1, 5, 10, 15, 30];

class ConfigurationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid Script Properties:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigurationError";
    this.problems = problems.slice();
  }
}

/**
 * Read and validate Script Properties for one operation scope.
 *
 * DRIVE does not require Gemini credentials, and GEMINI does not require Drive
 * IDs. FULL validates everything needed by runSorter(). Sensitive values are
 * returned to the caller but are never logged here.
 */
function getAppConfig(scope: ConfigScope = "FULL"): AppConfig {
  if (scope !== "DRIVE" && scope !== "GEMINI" && scope !== "FULL") {
    throw new ConfigurationError(["Configuration scope must be DRIVE, GEMINI, or FULL."]);
  }

  const properties = PropertiesService.getScriptProperties().getProperties();
  const problems: string[] = [];

  const rootFolderId = getTrimmedProperty(properties, "ROOT_FOLDER_ID");
  const inboxFolderId = getTrimmedProperty(properties, "INBOX_FOLDER_ID");
  const reviewFolderId = getTrimmedProperty(properties, "REVIEW_FOLDER_ID");
  const geminiApiKey = getTrimmedProperty(properties, "GEMINI_API_KEY");
  const geminiModel = getTrimmedProperty(properties, "GEMINI_MODEL");

  let dryRun: boolean = CONFIG_DEFAULTS.dryRun;
  let confidenceThreshold: number = CONFIG_DEFAULTS.confidenceThreshold;
  let maxFilesPerRun: number = CONFIG_DEFAULTS.maxFilesPerRun;
  let maxFolderDepth: number = CONFIG_DEFAULTS.maxFolderDepth;
  let duplicateFolderName: string = CONFIG_DEFAULTS.duplicateFolderName;
  let renameFiles: boolean = CONFIG_DEFAULTS.renameFiles;
  let maxInputBytes: number = CONFIG_DEFAULTS.maxInputBytes;
  let maxHashBytes: number = CONFIG_DEFAULTS.maxHashBytes;
  let maxTextChars: number = CONFIG_DEFAULTS.maxTextChars;
  let maxCandidateFolders: number = CONFIG_DEFAULTS.maxCandidateFolders;
  let maxRunMillis: number = CONFIG_DEFAULTS.maxRunMillis;
  let maxRetries: number = CONFIG_DEFAULTS.maxRetries;
  let retryBaseDelayMs: number = CONFIG_DEFAULTS.retryBaseDelayMs;
  let retryMaxDelayMs: number = CONFIG_DEFAULTS.retryMaxDelayMs;
  let triggerMinutes: number = CONFIG_DEFAULTS.triggerMinutes;
  let excludedFolderIds: string[] = [];
  let allowFolderCreation: boolean = CONFIG_DEFAULTS.allowFolderCreation;
  let fallbackFolderName: string = CONFIG_DEFAULTS.fallbackFolderName;

  dryRun = readConfigValue(
    () => parseBoolean(properties.DRY_RUN, CONFIG_DEFAULTS.dryRun, "DRY_RUN"),
    dryRun,
    problems,
  );
  confidenceThreshold = readConfigValue(
    () =>
      parseFloatNumber(
        properties.CONFIDENCE_THRESHOLD,
        CONFIG_DEFAULTS.confidenceThreshold,
        "CONFIDENCE_THRESHOLD",
        0,
        1,
      ),
    confidenceThreshold,
    problems,
  );
  maxFilesPerRun = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_FILES_PER_RUN,
        CONFIG_DEFAULTS.maxFilesPerRun,
        "MAX_FILES_PER_RUN",
        1,
        100,
      ),
    maxFilesPerRun,
    problems,
  );
  maxFolderDepth = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_FOLDER_DEPTH,
        CONFIG_DEFAULTS.maxFolderDepth,
        "MAX_FOLDER_DEPTH",
        1,
        100,
      ),
    maxFolderDepth,
    problems,
  );
  maxInputBytes = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_INPUT_BYTES,
        CONFIG_DEFAULTS.maxInputBytes,
        "MAX_INPUT_BYTES",
        1,
        12_582_912,
      ),
    maxInputBytes,
    problems,
  );
  maxHashBytes = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_HASH_BYTES,
        CONFIG_DEFAULTS.maxHashBytes,
        "MAX_HASH_BYTES",
        1,
        52_428_800,
      ),
    maxHashBytes,
    problems,
  );
  maxTextChars = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_TEXT_CHARS,
        CONFIG_DEFAULTS.maxTextChars,
        "MAX_TEXT_CHARS",
        1_000,
        1_000_000,
      ),
    maxTextChars,
    problems,
  );
  maxCandidateFolders = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_CANDIDATE_FOLDERS,
        CONFIG_DEFAULTS.maxCandidateFolders,
        "MAX_CANDIDATE_FOLDERS",
        1,
        2_000,
      ),
    maxCandidateFolders,
    problems,
  );
  maxRunMillis = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_RUN_MILLIS,
        CONFIG_DEFAULTS.maxRunMillis,
        "MAX_RUN_MILLIS",
        60_000,
        330_000,
      ),
    maxRunMillis,
    problems,
  );
  maxRetries = readConfigValue(
    () =>
      parseInteger(
        properties.MAX_RETRIES,
        CONFIG_DEFAULTS.maxRetries,
        "MAX_RETRIES",
        0,
        8,
      ),
    maxRetries,
    problems,
  );
  retryBaseDelayMs = readConfigValue(
    () =>
      parseInteger(
        properties.RETRY_BASE_DELAY_MS,
        CONFIG_DEFAULTS.retryBaseDelayMs,
        "RETRY_BASE_DELAY_MS",
        100,
        60_000,
      ),
    retryBaseDelayMs,
    problems,
  );
  retryMaxDelayMs = readConfigValue(
    () =>
      parseInteger(
        properties.RETRY_MAX_DELAY_MS,
        CONFIG_DEFAULTS.retryMaxDelayMs,
        "RETRY_MAX_DELAY_MS",
        100,
        120_000,
      ),
    retryMaxDelayMs,
    problems,
  );
  triggerMinutes = readConfigValue(
    () =>
      parseInteger(
        properties.TRIGGER_MINUTES,
        CONFIG_DEFAULTS.triggerMinutes,
        "TRIGGER_MINUTES",
        1,
        30,
      ),
    triggerMinutes,
    problems,
  );
  renameFiles = readConfigValue(
    () => parseBoolean(properties.RENAME_FILES, CONFIG_DEFAULTS.renameFiles, "RENAME_FILES"),
    renameFiles,
    problems,
  );
  allowFolderCreation = readConfigValue(
    () =>
      parseBoolean(
        properties.ALLOW_FOLDER_CREATION,
        CONFIG_DEFAULTS.allowFolderCreation,
        "ALLOW_FOLDER_CREATION",
      ),
    allowFolderCreation,
    problems,
  );

  const configuredDuplicateFolderName = readOptionalNameProperty(
    properties,
    "DUPLICATE_FOLDER_NAME",
    CONFIG_DEFAULTS.duplicateFolderName,
    problems,
  );
  if (configuredDuplicateFolderName !== null) {
    duplicateFolderName = configuredDuplicateFolderName;
  }

  const configuredFallbackFolderName = readOptionalNameProperty(
    properties,
    "FALLBACK_FOLDER_NAME",
    CONFIG_DEFAULTS.fallbackFolderName,
    problems,
  );
  if (configuredFallbackFolderName !== null) {
    fallbackFolderName = configuredFallbackFolderName;
  }

  excludedFolderIds = parseCsvStrings(properties.EXCLUDED_FOLDER_IDS);
  excludedFolderIds.forEach((folderId) => {
    if (!DRIVE_ID_PATTERN.test(folderId)) {
      problems.push("Every EXCLUDED_FOLDER_IDS entry must be a valid Drive folder ID.");
    }
  });

  if (scope === "DRIVE" || scope === "FULL") {
    validateRequiredDriveId(rootFolderId, "ROOT_FOLDER_ID", problems);
    validateRequiredDriveId(inboxFolderId, "INBOX_FOLDER_ID", problems);
    validateRequiredDriveId(reviewFolderId, "REVIEW_FOLDER_ID", problems);

    const requiredIds = [rootFolderId, inboxFolderId, reviewFolderId].filter(
      (id) => id !== "",
    );
    if (uniqueStrings(requiredIds).length !== requiredIds.length) {
      problems.push("ROOT_FOLDER_ID, INBOX_FOLDER_ID, and REVIEW_FOLDER_ID must be distinct.");
    }
    if (
      rootFolderId !== "" &&
      excludedFolderIds.includes(rootFolderId)
    ) {
      problems.push("EXCLUDED_FOLDER_IDS must not include ROOT_FOLDER_ID.");
    }
  }

  if (scope === "GEMINI" || scope === "FULL") {
    validateGeminiApiKey(geminiApiKey, problems);
    validateGeminiModel(geminiModel, problems);
  }

  if (!ALLOWED_TRIGGER_MINUTES.includes(triggerMinutes)) {
    problems.push("TRIGGER_MINUTES must be one of 1, 5, 10, 15, or 30.");
  }
  if (retryMaxDelayMs < retryBaseDelayMs) {
    problems.push("RETRY_MAX_DELAY_MS must be greater than or equal to RETRY_BASE_DELAY_MS.");
  }
  const normalizedDuplicateName = duplicateFolderName.toLowerCase();
  const normalizedFallbackName = fallbackFolderName.toLowerCase();
  const reservedOperationalNames = ["da smistare", "da controllare"];
  if (reservedOperationalNames.includes(normalizedDuplicateName)) {
    problems.push("DUPLICATE_FOLDER_NAME cannot use an inbox/review reserved name.");
  }
  if (
    [...reservedOperationalNames, "duplicati"].includes(
      normalizedFallbackName,
    )
  ) {
    problems.push(
      "FALLBACK_FOLDER_NAME cannot use an inbox/review/Duplicati reserved name.",
    );
  }
  if (normalizedDuplicateName === normalizedFallbackName) {
    problems.push("DUPLICATE_FOLDER_NAME and FALLBACK_FOLDER_NAME must be different.");
  }

  if (problems.length > 0) {
    throw new ConfigurationError(uniqueStrings(problems));
  }

  return {
    rootFolderId,
    inboxFolderId,
    reviewFolderId,
    dryRun,
    confidenceThreshold,
    maxFilesPerRun,
    maxFolderDepth,
    duplicateFolderName,
    geminiApiKey,
    geminiModel,
    renameFiles,
    maxInputBytes,
    maxHashBytes,
    maxTextChars,
    maxCandidateFolders,
    maxRunMillis,
    maxRetries,
    retryBaseDelayMs,
    retryMaxDelayMs,
    triggerMinutes,
    excludedFolderIds,
    allowFolderCreation,
    fallbackFolderName,
  };
}

function loadConfig(scope: ConfigScope = "FULL"): AppConfig {
  return getAppConfig(scope);
}

function getDriveConfig(): AppConfig {
  return getAppConfig("DRIVE");
}

function getGeminiConfig(): AppConfig {
  return getAppConfig("GEMINI");
}

/** A log-safe configuration view. It contains no credential value. */
function getSafeConfigSummary(config: AppConfig): Record<string, unknown> {
  return {
    rootFolderIdConfigured: config.rootFolderId !== "",
    inboxFolderIdConfigured: config.inboxFolderId !== "",
    reviewFolderIdConfigured: config.reviewFolderId !== "",
    geminiApiKeyConfigured: config.geminiApiKey !== "",
    geminiModel: config.geminiModel,
    dryRun: config.dryRun,
    confidenceThreshold: config.confidenceThreshold,
    maxFilesPerRun: config.maxFilesPerRun,
    maxFolderDepth: config.maxFolderDepth,
    duplicateFolderName: config.duplicateFolderName,
    renameFiles: config.renameFiles,
    maxInputBytes: config.maxInputBytes,
    maxHashBytes: config.maxHashBytes,
    maxTextChars: config.maxTextChars,
    maxCandidateFolders: config.maxCandidateFolders,
    maxRunMillis: config.maxRunMillis,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    triggerMinutes: config.triggerMinutes,
    excludedFolderCount: config.excludedFolderIds.length,
    allowFolderCreation: config.allowFolderCreation,
    fallbackFolderName: config.fallbackFolderName,
  };
}

/** Return setup help without reading or changing Script Properties. */
function getSetupInstructions(): string {
  return [
    "Drive Sorter - Script Properties setup",
    "",
    "Required for Drive operations:",
    "- ROOT_FOLDER_ID: ID of the configured document root folder",
    "- INBOX_FOLDER_ID: ID of the 'Da smistare' folder",
    "- REVIEW_FOLDER_ID: ID of the 'Da controllare' folder",
    "",
    "Required for Gemini operations:",
    "- GEMINI_API_KEY: Gemini API key (never put it in source code)",
    "- GEMINI_MODEL: currently available model name chosen for your account/tier",
    "",
    "Safety defaults (all optional):",
    "- DRY_RUN=true",
    "- CONFIDENCE_THRESHOLD=0.85",
    "- MAX_FILES_PER_RUN=10",
    "- MAX_FOLDER_DEPTH=10",
    "- DUPLICATE_FOLDER_NAME=Duplicati",
    "- RENAME_FILES=false",
    "- ALLOW_FOLDER_CREATION=false",
    "- FALLBACK_FOLDER_NAME=Altro",
    "",
    "Resource/rate defaults (all optional):",
    "- MAX_INPUT_BYTES=10485760",
    "- MAX_HASH_BYTES=10485760",
    "- MAX_TEXT_CHARS=100000",
    "- MAX_CANDIDATE_FOLDERS=500",
    "- MAX_RUN_MILLIS=270000",
    "- MAX_RETRIES=3",
    "- RETRY_BASE_DELAY_MS=1000",
    "- RETRY_MAX_DELAY_MS=30000",
    "- TRIGGER_MINUTES=15 (allowed: 1, 5, 10, 15, 30)",
    "- EXCLUDED_FOLDER_IDS=id1,id2 (optional CSV)",
    "",
    "Set these in Apps Script > Project Settings > Script Properties.",
    "Keep DRY_RUN=true until the manual tests and logs have been reviewed.",
  ].join("\n");
}

/** Log setup help only; this function never reads or writes Drive or properties. */
function showSetupInstructions(): void {
  console.log(getSetupInstructions());
}

function getTrimmedProperty(
  properties: Record<string, string>,
  propertyName: string,
): string {
  const value = properties[propertyName];
  return typeof value === "string" ? value.trim() : "";
}

function readConfigValue<T>(
  reader: () => T,
  fallback: T,
  problems: string[],
): T {
  try {
    return reader();
  } catch (error: unknown) {
    problems.push(getErrorMessage(error));
    return fallback;
  }
}

function readOptionalNameProperty(
  properties: Record<string, string>,
  propertyName: string,
  fallback: string,
  problems: string[],
): string | null {
  if (!Object.prototype.hasOwnProperty.call(properties, propertyName)) {
    return fallback;
  }

  const value = getTrimmedProperty(properties, propertyName);
  if (!isSafeFolderName(value)) {
    problems.push(
      `${propertyName} must be 1-200 characters and contain no slash or control character.`,
    );
    return null;
  }
  return value;
}

function isSafeFolderName(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 200 &&
    value !== "." &&
    value !== ".." &&
    !/[\\/\u0000-\u001F\u007F]/.test(value)
  );
}

function validateRequiredDriveId(
  value: string,
  propertyName: string,
  problems: string[],
): void {
  if (value === "") {
    problems.push(`${propertyName} is required for Drive operations.`);
    return;
  }
  if (!DRIVE_ID_PATTERN.test(value)) {
    problems.push(`${propertyName} must contain a Drive folder ID, not a URL.`);
  }
}

function validateGeminiApiKey(value: string, problems: string[]): void {
  if (value === "") {
    problems.push("GEMINI_API_KEY is required for Gemini operations.");
    return;
  }
  if (value.length < 10 || /\s/.test(value)) {
    problems.push("GEMINI_API_KEY is malformed.");
  }
}

function validateGeminiModel(value: string, problems: string[]): void {
  if (value === "") {
    problems.push("GEMINI_MODEL is required for Gemini operations.");
    return;
  }
  if (
    value.length > 120 ||
    !/^(?:models\/)?[A-Za-z0-9._-]+$/.test(value)
  ) {
    problems.push("GEMINI_MODEL contains unsupported characters.");
  }
}
