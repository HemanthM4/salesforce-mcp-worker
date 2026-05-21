export const DEFAULT_TIMEOUTS = {
  tokenRequestMs: 8000,
  salesforceQueryMs: 10000,
  routeMs: 15000,
  mcpToolMs: 12000
};

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;

export class TimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms.`);
    this.name = "TimeoutError";
    this.code = "TIMEOUT";
    this.retryable = true;
    this.details = {
      label,
      timeoutMs
    };
  }
}

function parseTimeoutOverride(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_TIMEOUT_MS ||
    parsed > MAX_TIMEOUT_MS
  ) {
    return fallback;
  }

  return parsed;
}

export function getTimeoutPolicy(env = {}) {
  return {
    tokenRequestMs: parseTimeoutOverride(
      env.SALESFORCE_TOKEN_TIMEOUT_MS,
      DEFAULT_TIMEOUTS.tokenRequestMs
    ),
    salesforceQueryMs: parseTimeoutOverride(
      env.SALESFORCE_QUERY_TIMEOUT_MS,
      DEFAULT_TIMEOUTS.salesforceQueryMs
    ),
    routeMs: parseTimeoutOverride(
      env.ROUTE_TIMEOUT_MS,
      DEFAULT_TIMEOUTS.routeMs
    ),
    mcpToolMs: parseTimeoutOverride(
      env.MCP_TOOL_TIMEOUT_MS,
      DEFAULT_TIMEOUTS.mcpToolMs
    )
  };
}

export async function withTimeout(promise, options) {
  const { timeoutMs, label } = options;
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutOptions) {
  const { timeoutMs, label } = timeoutOptions;
  const controller = new AbortController();
  const timerId = setTimeout(() => {
    controller.abort(new TimeoutError(label, timeoutMs));
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TimeoutError(label, timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timerId);
  }
}
