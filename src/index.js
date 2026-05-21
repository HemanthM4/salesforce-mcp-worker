import {
  auditEvent,
  auditTimedOperation,
  getRequestAuditContext
} from "./audit/auditLogger.js";
import { dispatchToolCall } from "./mcp/tool-dispatcher.js";
import { listTools } from "./mcp/tool-registry.js";
import { getSalesforceAccessToken } from "./salesforce/auth.js";
import { createSalesforceConnection } from "./salesforce/connection.js";
import {
  applyLimitToSoql,
  getQueryLimitPolicy
} from "./salesforce/query-limits/queryLimitService.js";
import { errorResponse } from "./utils/errorResponse.js";
import {
  fetchWithTimeout,
  getTimeoutPolicy,
  TimeoutError,
  withTimeout
} from "./utils/timeout.js";
import { ValidationError } from "./utils/errors.js";

function safeSalesforceUserInfo(identity) {
  return {
    id: identity.Id,
    name: identity.Name,
    username: identity.Username
  };
}

function escapeSoqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function extractObjectNameFromSoql(soql) {
  if (typeof soql !== "string") {
    return undefined;
  }

  return soql.match(/\bfrom\s+([A-Za-z][A-Za-z0-9_]*)\b/i)?.[1];
}

function parseToolArguments(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new ValidationError("Tool args must be valid JSON.");
  }
}

async function fetchCurrentSalesforceUser(conn, env) {
  const soql = `SELECT Id, Name, Username FROM User WHERE Username = '${escapeSoqlString(
    env.SALESFORCE_USERNAME
  )}' LIMIT 1`;
  const version = env.SALESFORCE_API_VERSION || "60.0";
  const timeoutPolicy = getTimeoutPolicy(env);
  const response = await fetchWithTimeout(
    `${conn.instanceUrl}/services/data/v${version}/query?q=${encodeURIComponent(soql)}`,
    {
      headers: {
        authorization: `Bearer ${conn.accessToken}`
      }
    },
    {
      timeoutMs: timeoutPolicy.salesforceQueryMs,
      label: "Salesforce query request"
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Salesforce user info failed: ${JSON.stringify(data)}`);
  }

  return data.records[0] || null;
}

async function executeSalesforceQuery(conn, env, soql) {
  const version = env.SALESFORCE_API_VERSION || "60.0";
  const timeoutPolicy = getTimeoutPolicy(env);
  const response = await fetchWithTimeout(
    `${conn.instanceUrl}/services/data/v${version}/query?q=${encodeURIComponent(soql)}`,
    {
      headers: {
        authorization: `Bearer ${conn.accessToken}`
      }
    },
    {
      timeoutMs: timeoutPolicy.salesforceQueryMs,
      label: "Salesforce query request"
    }
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Salesforce query failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function buildDebugLimitedQueryBody(request, env) {
  const url = new URL(request.url);
  const originalQuery = url.searchParams.get("q");
  const requestedLimit = url.searchParams.get("limit");
  const policy = getQueryLimitPolicy(env);
  const executedQuery = applyLimitToSoql({
    soql: originalQuery,
    requestedLimit,
    env,
    paramsOrUrl: url
  });
  const conn = await createSalesforceConnection(env);
  const result = await executeSalesforceQuery(conn, env, executedQuery);
  const responseBody = {
    ok: true,
    policy,
    originalQuery,
    executedQuery,
    totalSize: result.totalSize,
    done: result.done,
    recordCount: Array.isArray(result.records) ? result.records.length : 0,
    records: result.records || []
  };

  if (result.done === false) {
    responseBody.truncated = true;
    responseBody.message =
      "Additional Salesforce records were available but queryMore is disabled by policy.";
  }

  return responseBody;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "salesforce-mcp-worker",
        mode: env.MCP_ACCESS_MODE || "unknown"
      });
    }

    if (url.pathname === "/debug/env") {
      return Response.json({
        hasClientId: Boolean(env.SALESFORCE_CLIENT_ID),
        hasUsername: Boolean(env.SALESFORCE_USERNAME),
        hasPrivateKeyDerB64: Boolean(env.SALESFORCE_PRIVATE_KEY_DER_B64),
        loginUrl: env.SALESFORCE_LOGIN_URL,
        instanceUrl: env.SALESFORCE_INSTANCE_URL
      });
    }

    if (url.pathname === "/debug/salesforce-login") {
      const auditContext = getRequestAuditContext(request);
      const auditBase = {
        ...auditContext,
        event: "salesforce.auth.request",
        operation: "jwt_login",
        user: env.SALESFORCE_USERNAME
      };

      try {
        await auditEvent(env, auditBase);
        const tokenData = await auditTimedOperation(
          env,
          auditBase,
          () => getSalesforceAccessToken(env),
          {
            successFields: (result) => ({
              instanceUrl: result.instance_url
            })
          }
        );

        return Response.json({
          ok: true,
          instanceUrl: tokenData.instance_url,
          id: tokenData.id,
          tokenType: tokenData.token_type,
          hasAccessToken: Boolean(tokenData.access_token)
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/debug/salesforce-userinfo") {
      const auditContext = getRequestAuditContext(request);
      const auditBase = {
        ...auditContext,
        event: "salesforce.userinfo.request",
        operation: "userinfo",
        user: env.SALESFORCE_USERNAME
      };

      try {
        await auditEvent(env, auditBase);
        const user = await auditTimedOperation(
          env,
          auditBase,
          async () => {
            const conn = await createSalesforceConnection(env);
            return fetchCurrentSalesforceUser(conn, env);
          },
          {
            successFields: (result) => ({
              recordCount: result ? 1 : 0,
              userId: result?.Id
            })
          }
        );

        return Response.json({
          ok: true,
          user: user ? safeSalesforceUserInfo(user) : null
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/debug/query-limits") {
      return Response.json({
        ok: true,
        policy: getQueryLimitPolicy(env)
      });
    }

    if (url.pathname === "/debug/timeouts") {
      return Response.json({
        ok: true,
        policy: getTimeoutPolicy(env)
      });
    }

    if (url.pathname === "/debug/tools") {
      return Response.json({
        ok: true,
        tools: listTools()
      });
    }

    if (url.pathname === "/debug/tool-call") {
      try {
        const toolName = url.searchParams.get("tool");
        const parsedArgs = parseToolArguments(url.searchParams.get("args"));
        const result = await dispatchToolCall({
          toolName,
          arguments: parsedArgs,
          env,
          request
        });

        return Response.json(result);
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/debug/limited-query") {
      const auditContext = getRequestAuditContext(request);
      const originalQuery = url.searchParams.get("q");
      const requestedLimit = url.searchParams.get("limit");
      const auditBase = {
        ...auditContext,
        event: "salesforce.query.request",
        operation: "limited_query",
        user: env.SALESFORCE_USERNAME,
        objectName: extractObjectNameFromSoql(originalQuery),
        queryPreview: originalQuery,
        requestedLimit
      };

      try {
        await auditEvent(env, auditBase);
        const responseBody = await auditTimedOperation(
          env,
          auditBase,
          () =>
            withTimeout(buildDebugLimitedQueryBody(request, env), {
              timeoutMs: getTimeoutPolicy(env).routeMs,
              label: "Limited query route"
            }),
          {
            successFields: (result) => ({
              recordCount: result.recordCount
            })
          }
        );

        return Response.json(responseBody);
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/debug/error-test") {
      const auditContext = getRequestAuditContext(request);
      const auditBase = {
        ...auditContext,
        event: "debug.error_test.request",
        operation: "error_test",
        details: {
          type: url.searchParams.get("type")
        }
      };

      try {
        await auditEvent(env, auditBase);
        const type = url.searchParams.get("type");
        await auditTimedOperation(env, auditBase, async () => {
          if (type === "timeout") {
            throw new TimeoutError("Test timeout", 10000);
          }

          if (type === "validation") {
            throw new ValidationError("Test validation error", {
              details: { field: "q" }
            });
          }

          if (type === "salesforce-auth") {
            throw new Error(
              JSON.stringify({
                error: "invalid_grant",
                error_description: "test auth failure"
              })
            );
          }

          if (type === "unknown") {
            throw new Error("This raw internal message should not leak fully");
          }

          throw new ValidationError("Unknown error test type.", {
            details: { type }
          });
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/debug/audit-test") {
      await auditEvent(env, {
        ...getRequestAuditContext(request),
        event: "debug.audit_test",
        level: "info",
        details: {
          message: "audit logger working",
          access_token: "should redact",
          authorization: "Bearer fake-token"
        }
      });

      return Response.json({
        ok: true,
        message: "Audit test event emitted. Check wrangler dev terminal logs."
      });
    }

    return new Response("Not found", { status: 404 });
  }
};
