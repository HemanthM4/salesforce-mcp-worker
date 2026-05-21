import { getAuditConfig } from "./auditConfig.js";
import { sanitizeAuditEvent } from "./redact.js";

function normalizeLevel(level) {
  return ["info", "success", "failure", "error"].includes(level)
    ? level
    : "info";
}

function eventNameForLevel(eventName, level) {
  if (!eventName || !eventName.endsWith(".request")) {
    return eventName;
  }

  if (level === "success") {
    return eventName.replace(/\.request$/, ".success");
  }

  if (level === "failure" || level === "error") {
    return eventName.replace(/\.request$/, ".failure");
  }

  return eventName;
}

function buildAuditEvent(event, level, config) {
  const normalizedLevel = normalizeLevel(level || event.level);
  const auditEvent = {
    type: "audit",
    timestamp: new Date().toISOString(),
    ...event,
    level: normalizedLevel,
    event: eventNameForLevel(event.event, normalizedLevel)
  };

  return sanitizeAuditEvent(auditEvent, config);
}

function shouldSkip(config, level) {
  if (!config.enabled) {
    return true;
  }

  if (level === "success" && !config.logSuccess) {
    return true;
  }

  if ((level === "failure" || level === "error") && !config.logFailure) {
    return true;
  }

  return false;
}

function writeAuditLog(level, event) {
  const serialized = JSON.stringify(event);

  if (level === "failure") {
    console.warn(serialized);
    return;
  }

  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export function createAuditLogger(env) {
  function emit(level, event) {
    const config = getAuditConfig(env);
    const normalizedLevel = normalizeLevel(level);

    if (shouldSkip(config, normalizedLevel)) {
      return;
    }

    writeAuditLog(normalizedLevel, buildAuditEvent(event, normalizedLevel, config));
  }

  return {
    info(event) {
      emit("info", event);
    },
    success(event) {
      emit("success", event);
    },
    failure(event) {
      emit("failure", event);
    },
    error(event) {
      emit("error", event);
    }
  };
}

export async function auditEvent(env, event) {
  const logger = createAuditLogger(env);
  const level = normalizeLevel(event.level);

  if (level === "success") {
    logger.success(event);
    return;
  }

  if (level === "failure") {
    logger.failure(event);
    return;
  }

  if (level === "error") {
    logger.error(event);
    return;
  }

  logger.info(event);
}

export function getRequestAuditContext(request) {
  const url = new URL(request.url);

  return {
    requestId: request.headers.get("cf-ray") || crypto.randomUUID(),
    route: url.pathname,
    method: request.method,
    userAgent: request.headers.get("user-agent") || undefined
  };
}

export async function auditTimedOperation(env, baseEvent, operationFn, options = {}) {
  const start = performance.now();

  try {
    const result = await operationFn();
    const durationMs = Math.round(performance.now() - start);
    const successFields =
      typeof options.successFields === "function"
        ? options.successFields(result)
        : options.successFields || {};

    await auditEvent(env, {
      ...baseEvent,
      ...successFields,
      level: "success",
      status: "success",
      durationMs
    });

    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    const failureFields =
      typeof options.failureFields === "function"
        ? options.failureFields(error)
        : options.failureFields || {};

    await auditEvent(env, {
      ...baseEvent,
      ...failureFields,
      level: "failure",
      status: "failure",
      durationMs,
      errorCode: error.code || error.name || "UNKNOWN_ERROR",
      retryable: Boolean(error.retryable)
    });

    throw error;
  }
}
