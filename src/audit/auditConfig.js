export const DEFAULT_AUDIT_CONFIG = {
  enabled: true,
  sink: "console",
  logSuccess: true,
  logFailure: true,
  includeQueryPreview: true,
  queryPreviewMaxChars: 300,
  includeRecordCounts: true
};

const MIN_QUERY_PREVIEW_CHARS = 50;
const MAX_QUERY_PREVIEW_CHARS = 1000;

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value === "true";
}

function parseAuditEnabled(value) {
  return value === "false" ? false : DEFAULT_AUDIT_CONFIG.enabled;
}

function parseQueryPreviewMaxChars(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_AUDIT_CONFIG.queryPreviewMaxChars;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_QUERY_PREVIEW_CHARS ||
    parsed > MAX_QUERY_PREVIEW_CHARS
  ) {
    return DEFAULT_AUDIT_CONFIG.queryPreviewMaxChars;
  }

  return parsed;
}

export function getAuditConfig(env = {}) {
  return {
    enabled: parseAuditEnabled(env.AUDIT_ENABLED),
    sink: env.AUDIT_SINK || DEFAULT_AUDIT_CONFIG.sink,
    logSuccess: parseBoolean(
      env.AUDIT_LOG_SUCCESS,
      DEFAULT_AUDIT_CONFIG.logSuccess
    ),
    logFailure: parseBoolean(
      env.AUDIT_LOG_FAILURE,
      DEFAULT_AUDIT_CONFIG.logFailure
    ),
    includeQueryPreview: parseBoolean(
      env.AUDIT_INCLUDE_QUERY_PREVIEW,
      DEFAULT_AUDIT_CONFIG.includeQueryPreview
    ),
    queryPreviewMaxChars: parseQueryPreviewMaxChars(
      env.AUDIT_QUERY_PREVIEW_MAX_CHARS
    ),
    includeRecordCounts: parseBoolean(
      env.AUDIT_INCLUDE_RECORD_COUNTS,
      DEFAULT_AUDIT_CONFIG.includeRecordCounts
    )
  };
}
