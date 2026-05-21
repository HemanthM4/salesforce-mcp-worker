import {
  getToolContractByName,
  getToolContracts
} from "./tool-contracts.js";
import { handleSalesforceExplainRecordIssue } from "./tools/salesforce-explain-record-issue.js";
import { handleSalesforceFindContext } from "./tools/salesforce-find-context.js";
import { handleSalesforceGetRecordContext } from "./tools/salesforce-get-record-context.js";
import { ValidationError } from "../utils/errors.js";

export const MCP_TOOL_REGISTRY = {
  salesforce_find_context: {
    contract: getToolContractByName("salesforce_find_context"),
    handler: handleSalesforceFindContext
  },
  salesforce_get_record_context: {
    contract: getToolContractByName("salesforce_get_record_context"),
    handler: handleSalesforceGetRecordContext
  },
  salesforce_explain_record_issue: {
    contract: getToolContractByName("salesforce_explain_record_issue"),
    handler: handleSalesforceExplainRecordIssue
  }
};

export function listTools() {
  return getToolContracts();
}

export function getTool(name) {
  return MCP_TOOL_REGISTRY[name] || null;
}

export function assertKnownTool(name) {
  const tool = getTool(name);

  if (!tool) {
    throw new ValidationError("Unknown tool.", {
      details: { toolName: name }
    });
  }

  return tool;
}
