export const DEFAULT_RECORD_LIMIT = 5;
export const MAX_RECORD_LIMIT = 10;
export const MAX_QUERY_LENGTH = 4000;
export const MAX_SELECTED_FIELDS = 50;
export const ALLOW_QUERY_MORE = false;

export const DEFAULT_QUERY_LIMIT_POLICY = {
  defaultRecordLimit: DEFAULT_RECORD_LIMIT,
  maxRecordLimit: MAX_RECORD_LIMIT,
  maxQueryLength: MAX_QUERY_LENGTH,
  maxSelectedFields: MAX_SELECTED_FIELDS,
  allowQueryMore: ALLOW_QUERY_MORE
};

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export function getQueryLimitConfig(env = {}) {
  const maxRecordLimit = Math.max(
    1,
    parsePositiveInteger(env.SALESFORCE_MAX_RECORD_LIMIT, MAX_RECORD_LIMIT)
  );
  const defaultRecordLimit = Math.min(
    parsePositiveInteger(
      env.SALESFORCE_DEFAULT_RECORD_LIMIT,
      DEFAULT_RECORD_LIMIT
    ),
    maxRecordLimit
  );

  return {
    defaultRecordLimit,
    maxRecordLimit,
    maxQueryLength: parsePositiveInteger(
      env.SALESFORCE_MAX_QUERY_LENGTH,
      MAX_QUERY_LENGTH
    ),
    maxSelectedFields: parsePositiveInteger(
      env.SALESFORCE_MAX_SELECTED_FIELDS,
      MAX_SELECTED_FIELDS
    ),
    allowQueryMore: env.SALESFORCE_ALLOW_QUERY_MORE === "true"
  };
}

export default DEFAULT_QUERY_LIMIT_POLICY;
