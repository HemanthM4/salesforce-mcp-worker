const REDACTED = "[REDACTED]";
const MAX_DEPTH = 5;
const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "token",
  "assertion",
  "private_key",
  "privatekey",
  "client_secret",
  "clientsecret",
  "salesforce_private_key_der_b64",
  "mcp_shared_secret",
  "authorization"
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

function redactSensitiveKeyValue(key, value, maxChars) {
  if (
    String(key).toLowerCase() === "authorization" &&
    typeof value === "string" &&
    /^Bearer\s+/i.test(value)
  ) {
    return safeStringPreview(value, maxChars);
  }

  return REDACTED;
}

export function safeStringPreview(value, maxChars) {
  const stringValue = String(value).replace(
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    `Bearer ${REDACTED}`
  );

  if (stringValue.length <= maxChars) {
    return stringValue;
  }

  return `${stringValue.slice(0, maxChars)}...`;
}

export function redactValue(value, maxChars = 300, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") {
    return safeStringPreview(value, maxChars);
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return safeStringPreview(value, maxChars);
  }

  if (depth >= MAX_DEPTH) {
    return "[MaxDepth]";
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, maxChars, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [
          key,
          isSensitiveKey(key)
            ? redactSensitiveKeyValue(key, entryValue, maxChars)
            : redactValue(entryValue, maxChars, depth + 1, seen)
        ])
    );
  }

  return safeStringPreview(value, maxChars);
}

export function redactObject(value) {
  return redactValue(value);
}

export function sanitizeAuditEvent(event, config) {
  const sanitized = redactObject(event);

  if (!config.includeQueryPreview) {
    delete sanitized.queryPreview;
  } else if (sanitized.queryPreview !== undefined) {
    sanitized.queryPreview = safeStringPreview(
      sanitized.queryPreview,
      config.queryPreviewMaxChars
    );
  }

  if (!config.includeRecordCounts) {
    delete sanitized.recordCount;
  }

  return sanitized;
}
