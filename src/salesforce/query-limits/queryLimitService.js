import { getQueryLimitConfig } from "./queryLimitConfig.js";
import {
  QueryFieldLimitError,
  QueryLimitError,
  QueryMoreNotAllowedError,
  QueryRecordLimitError,
  QueryTooLongError
} from "./queryLimitErrors.js";

export function getQueryLimitPolicy(env) {
  return getQueryLimitConfig(env);
}

function parseRequestedLimit(requestedLimit) {
  if (requestedLimit === undefined || requestedLimit === null || requestedLimit === "") {
    return null;
  }

  const parsed = Number(requestedLimit);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new QueryRecordLimitError("Requested limit must be a positive integer.", {
      requestedLimit
    });
  }

  return parsed;
}

function trimTrailingSemicolon(soql) {
  return soql.trim().replace(/;+$/g, "").trim();
}

function splitSelectedFields(fields) {
  const selectedFields = [];
  let current = "";
  let depth = 0;

  for (const character of fields) {
    if (character === "(") {
      depth++;
    } else if (character === ")" && depth > 0) {
      depth--;
    }

    if (character === "," && depth === 0) {
      selectedFields.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim()) {
    selectedFields.push(current.trim());
  }

  return selectedFields;
}

export function countSelectedFields(soql) {
  if (typeof soql !== "string") {
    return null;
  }

  const match = soql.match(/^\s*select\s+([\s\S]+?)\s+from\s+/i);

  if (!match) {
    return null;
  }

  return splitSelectedFields(match[1]).filter(Boolean).length;
}

export function extractLimitFromSoql(soql) {
  if (typeof soql !== "string") {
    return null;
  }

  const matches = [...soql.matchAll(/\blimit\s+(\d+)\b/gi)];
  const finalMatch = matches[matches.length - 1];

  return finalMatch ? Number(finalMatch[1]) : null;
}

export function hasQueryMoreRequest(paramsOrUrl) {
  const params =
    paramsOrUrl instanceof URL
      ? paramsOrUrl.searchParams
      : paramsOrUrl instanceof URLSearchParams
        ? paramsOrUrl
        : new URLSearchParams(paramsOrUrl || "");

  return (
    params.get("queryMore") === "true" ||
    params.has("nextRecordsUrl") ||
    params.has("queryLocator")
  );
}

export function enforceQueryLimits({ soql, requestedLimit, env, paramsOrUrl }) {
  const policy = getQueryLimitPolicy(env);

  if (hasQueryMoreRequest(paramsOrUrl) && !policy.allowQueryMore) {
    throw new QueryMoreNotAllowedError("queryMore is disabled by policy.", {
      allowQueryMore: policy.allowQueryMore
    });
  }

  if (typeof soql !== "string" || soql.trim() === "") {
    throw new QueryLimitError("QUERY_REQUIRED", "SOQL query is required.", {});
  }

  if (soql.length > policy.maxQueryLength) {
    throw new QueryTooLongError("SOQL query exceeds maximum length.", {
      queryLength: soql.length,
      maxQueryLength: policy.maxQueryLength
    });
  }

  const selectedFieldCount = countSelectedFields(soql);

  if (
    selectedFieldCount !== null &&
    selectedFieldCount > policy.maxSelectedFields
  ) {
    throw new QueryFieldLimitError("SOQL query selects too many fields.", {
      selectedFieldCount,
      maxSelectedFields: policy.maxSelectedFields
    });
  }

  const queryLimit = extractLimitFromSoql(soql);

  if (queryLimit !== null && queryLimit > policy.maxRecordLimit) {
    throw new QueryRecordLimitError("SOQL LIMIT exceeds maximum record limit.", {
      queryLimit,
      maxRecordLimit: policy.maxRecordLimit
    });
  }

  const parsedRequestedLimit = parseRequestedLimit(requestedLimit);

  if (
    parsedRequestedLimit !== null &&
    parsedRequestedLimit > policy.maxRecordLimit
  ) {
    throw new QueryRecordLimitError("Requested limit exceeds maximum record limit.", {
      requestedLimit: parsedRequestedLimit,
      maxRecordLimit: policy.maxRecordLimit
    });
  }

  return {
    policy,
    queryLimit,
    requestedLimit: parsedRequestedLimit
  };
}

export function applyLimitToSoql({ soql, requestedLimit, env, paramsOrUrl }) {
  const { policy, queryLimit, requestedLimit: parsedRequestedLimit } =
    enforceQueryLimits({ soql, requestedLimit, env, paramsOrUrl });
  const normalizedSoql = trimTrailingSemicolon(soql);

  if (queryLimit !== null) {
    return normalizedSoql;
  }

  const limitToApply = parsedRequestedLimit || policy.defaultRecordLimit;

  return `${normalizedSoql} LIMIT ${limitToApply}`;
}
