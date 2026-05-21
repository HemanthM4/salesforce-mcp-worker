import {
  auditEvent,
  auditTimedOperation,
  getRequestAuditContext
} from "../audit/auditLogger.js";
import { assertKnownTool } from "./tool-registry.js";

export async function dispatchToolCall({ toolName, arguments: toolArguments, env, request }) {
  const tool = assertKnownTool(toolName);
  const requestContext = request ? getRequestAuditContext(request) : {};
  const auditBase = {
    ...requestContext,
    event: "mcp.tool.called",
    toolName,
    operation: "mcp_tool_call"
  };

  try {
    await auditEvent(env, auditBase);
    return await auditTimedOperation(
      env,
      auditBase,
      () =>
        tool.handler(toolArguments || {}, {
          env,
          request
        }),
      {
        successFields: {
          event: "mcp.tool.completed"
        },
        failureFields: {
          event: "mcp.tool.failed"
        }
      }
    );
  } catch (error) {
    throw error;
  }
}
