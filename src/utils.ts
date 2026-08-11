/** Return a useful, bounded message for any thrown JavaScript value. */
function getErrorMessage(error: unknown, maxLength = 2_000): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = safeJsonStringify(error);
  }

  return truncateString(redactSensitiveText(message), maxLength);
}

/** Return an error name without assuming the caught value is an Error. */
function getErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return truncateString(error.name, 100);
  }
  return "Error";
}

/** Convert an unknown caught value into an Error without leaking credentials. */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    const sanitized = new Error(getErrorMessage(error));
    sanitized.name = getErrorName(error);
    return sanitized;
  }
  return new Error(getErrorMessage(error));
}

function toStructuredLogError(
  error: unknown,
  kind: ProcessingErrorKind,
  retryable = false,
): StructuredLogError {
  return {
    kind,
    name: getErrorName(error),
    message: getErrorMessage(error),
    retryable,
  };
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const parsed = trimToNull(value);
  if (parsed === null) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return parsed;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateString(value: string, maxLength: number): string {
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new Error("maxLength must be a non-negative integer.");
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

/** Parse an optional strict boolean. Only true and false are accepted. */
function parseBoolean(
  value: string | null | undefined,
  fallback: boolean,
  fieldName = "value",
): boolean {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error(`${fieldName} must be either true or false.`);
}

/** Parse an optional base-10 integer and enforce inclusive bounds. */
function parseInteger(
  value: string | null | undefined,
  fallback: number,
  fieldName = "value",
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = value.trim();
  if (!/^[+-]?\d+$/.test(normalized)) {
    throw new Error(`${fieldName} must be a base-10 integer.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

/** Parse an optional finite number and enforce inclusive bounds. */
function parseFloatNumber(
  value: string | null | undefined,
  fallback: number,
  fieldName = "value",
  min = -Number.MAX_VALUE,
  max = Number.MAX_VALUE,
): number {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = value.trim();
  if (
    normalized === "" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
  ) {
    throw new Error(`${fieldName} must be a number.`);
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be a number from ${min} to ${max}.`);
  }
  return parsed;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen: Record<string, true> = Object.create(null) as Record<string, true>;
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = value.trim();
    if (normalized !== "" && seen[normalized] !== true) {
      seen[normalized] = true;
      result.push(normalized);
    }
  });

  return result;
}

function parseCsvStrings(value: string | null | undefined): string[] {
  if (value === null || value === undefined || value.trim() === "") {
    return [];
  }
  return uniqueStrings(value.split(","));
}

function toStringSet(values: readonly string[]): Record<string, true> {
  const result: Record<string, true> = Object.create(null) as Record<string, true>;
  uniqueStrings(values).forEach((value) => {
    result[value] = true;
  });
  return result;
}

function stringSetHas(set: Record<string, true>, value: string): boolean {
  return Object.prototype.hasOwnProperty.call(set, value);
}

function isoTimestamp(date = new Date()): string {
  return date.toISOString();
}

function createRunId(): string {
  return `${isoTimestamp()}_${Utilities.getUuid()}`;
}

/** Redact common credential forms from arbitrary log text. */
function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_API_KEY]");
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized === "key" ||
    normalized === "apikey" ||
    normalized.endsWith("apikey") ||
    normalized === "authorization" ||
    normalized === "password" ||
    normalized.endsWith("password") ||
    normalized === "secret" ||
    normalized.endsWith("secret") ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken"
  );
}

/**
 * JSON serialization for logs. It handles circular references, Error objects,
 * bigint values and known secret fields, and it never throws.
 */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (key: string, current: unknown) => {
      if (isSensitiveLogKey(key)) {
        return "[REDACTED]";
      }

      if (typeof current === "string") {
        return redactSensitiveText(current);
      }

      if (typeof current === "bigint") {
        return current.toString();
      }

      if (current instanceof Error) {
        return {
          name: getErrorName(current),
          message: getErrorMessage(current),
        };
      }

      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) {
          return "[Circular]";
        }
        seen.add(current);
      }

      return current;
    });

    return serialized === undefined ? "null" : serialized;
  } catch (error: unknown) {
    const fallbackMessage =
      error instanceof Error ? redactSensitiveText(error.message) : "Unknown error";
    return JSON.stringify({
      serializationError: truncateString(fallbackMessage, 500),
    });
  }
}
