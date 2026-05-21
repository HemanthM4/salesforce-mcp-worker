import { QueryLimitError } from "../salesforce/query-limits/queryLimitErrors.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "assertion",
  "private_key",
  "client_secret",
  "salesforce_private_key_der_b64",
  "mcp_shared_secret",
  "authorization"
]);

export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = options.name || "AppError";
    this.code = options.code || "APP_ERROR";
    this.retryable = Boolean(options.retryable);
    this.status = options.status || 500;
    this.details = options.details || {};
    this.cause = options.cause;
  }
}

export class ValidationError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: options.name || "ValidationError",
      code: options.code || "VALIDATION_ERROR",
      status: options.status || 400,
      retryable: false
    });
  }
}

export class AuthError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: options.name || "AuthError",
      code: options.code || "AUTH_FAILED",
      status: options.status || 401,
      retryable: false
    });
  }
}

export class SalesforceError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: options.name || "SalesforceError",
      code: options.code || "SALESFORCE_ERROR",
      status: options.status || 502,
      retryable: Boolean(options.retryable)
    });
  }
}

export class QueryLimitMappedError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: options.name || "QueryLimitMappedError",
      code: options.code || "QUERY_LIMIT_ERROR",
      status: options.status || 400,
      retryable: false
    });
  }
}

export class TimeoutMappedError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: options.name || "TimeoutMappedError",
      code: options.code || "TIMEOUT",
      status: options.status || 504,
      retryable: true
    });
  }
}

export class UnknownMappedError extends AppError {
  constructor(message = "Unexpected error.", options = {}) {
    super(message, {
      ...options,
      name: options.name || "UnknownMappedError",
      code: options.code || "UNKNOWN_ERROR",
      status: options.status || 500,
      retryable: false,
      details: options.details || {}
    });
  }
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

function redactString(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /(access_token|refresh_token|assertion|private_key|client_secret|SALESFORCE_PRIVATE_KEY_DER_B64|MCP_SHARED_SECRET)\s*[:=]\s*["']?[^"',\s}]+/gi,
      "$1: [REDACTED]"
    );
}

export function redactErrorDetails(value) {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactErrorDetails(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redactErrorDetails(entryValue)
      ])
    );
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

function parseJsonFromErrorMessage(error) {
  if (!error || typeof error.message !== "string") {
    return null;
  }

  const jsonStart = error.message.search(/[\[{]/);

  if (jsonStart === -1) {
    return null;
  }

  try {
    return JSON.parse(error.message.slice(jsonStart));
  } catch {
    return null;
  }
}

function isInvalidSalesforceInput(errorCode) {
  return /INVALID|MALFORMED|REQUIRED|LIMIT_EXCEEDED|QUERY/i.test(
    errorCode || ""
  );
}

function normalizeStatus(status, fallback) {
  const parsed = Number(status);

  if (Number.isInteger(parsed) && parsed >= 400 && parsed <= 599) {
    return parsed;
  }

  return fallback;
}

function mappedResponse(status, code, message, retryable, details = {}) {
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message: redactErrorDetails(message),
        retryable,
        details: redactErrorDetails(details)
      }
    }
  };
}

export function mapError(error, options = {}) {
  if (error instanceof AppError) {
    return mappedResponse(
      error.status,
      error.code,
      error.message,
      error.retryable,
      error.details
    );
  }

  if (error?.name === "TimeoutError" || error?.code === "TIMEOUT") {
    const label = error.details?.label || "Operation";
    const timeoutMs = error.details?.timeoutMs;
    const message =
      typeof error.message === "string" && error.message
        ? error.message
        : `${label} timed out.`;

    return mappedResponse(504, "TIMEOUT", message, true, {
      label,
      ...(timeoutMs ? { timeoutMs } : {})
    });
  }

  if (error instanceof QueryLimitError || error?.code?.startsWith?.("QUERY_")) {
    return mappedResponse(
      400,
      error.code || "QUERY_LIMIT_ERROR",
      error.message || "Query limit validation failed.",
      false,
      error.details || {}
    );
  }

  const parsed = parseJsonFromErrorMessage(error);

  if (parsed?.error) {
    return mappedResponse(
      401,
      "SALESFORCE_AUTH_ERROR",
      parsed.error_description || "Salesforce authentication failed.",
      false,
      {
        salesforceError: parsed.error
      }
    );
  }

  if (Array.isArray(parsed) && parsed[0]?.errorCode) {
    const firstError = parsed[0];
    const status = isInvalidSalesforceInput(firstError.errorCode) ? 400 : 502;

    return mappedResponse(
      status,
      "SALESFORCE_REST_ERROR",
      firstError.message || "Salesforce REST request failed.",
      false,
      {
        salesforceErrorCode: firstError.errorCode
      }
    );
  }

  if (error?.status) {
    const status = normalizeStatus(error.status, 500);
    const retryable = status === 502 || status === 503 || status === 504;

    return mappedResponse(
      status >= 500 ? status : 400,
      status >= 500 ? "HTTP_UPSTREAM_ERROR" : "HTTP_REQUEST_ERROR",
      status >= 500 ? "Upstream request failed." : "Request failed.",
      retryable,
      {}
    );
  }

  const unknown = new UnknownMappedError(options.unknownMessage);

  return mappedResponse(
    unknown.status,
    unknown.code,
    unknown.message,
    unknown.retryable,
    unknown.details
  );
}

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init?.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {})
    }
  });
}

export function errorResponse(error, options = {}) {
  const mapped = mapError(error, options);
  return jsonResponse(mapped.body, { status: mapped.status });
}
