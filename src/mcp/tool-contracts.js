export const SALESFORCE_MCP_TOOL_CONTRACTS = [
  {
    name: "salesforce_find_context",
    title: "Find Salesforce Context",
    description:
      "Finds the most likely Salesforce records and identifiers from a vague user request, Salesforce URL, or record number. Use this first when the user is broad or unclear.",
    readOnly: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        userRequest: {
          type: "string",
          description: "The raw user request or chat message."
        },
        salesforceUrl: {
          type: "string",
          description: "Optional Salesforce Lightning URL pasted by the user."
        },
        recordHints: {
          type: "array",
          items: { type: "string" },
          description: "Optional known record numbers or IDs extracted by the agent."
        },
        maxRecords: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Maximum candidate records to return. The Worker policy may reduce this."
        }
      },
      required: ["userRequest"]
    }
  },
  {
    name: "salesforce_get_record_context",
    title: "Get Salesforce Record Context",
    description:
      "Gets a compact context packet for one selected Salesforce record, including important fields and limited related records where safely available. Use this after salesforce_find_context identifies a likely record.",
    readOnly: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        primaryRecord: {
          type: "object",
          additionalProperties: false,
          properties: {
            objectName: { type: "string" },
            recordId: { type: "string" },
            displayName: { type: "string" }
          },
          required: ["objectName", "recordId"]
        },
        contextDepth: {
          type: "string",
          enum: ["minimal", "standard"],
          description:
            "minimal returns only the primary record; standard may include limited related records."
        },
        includeRelatedTypes: {
          type: "array",
          items: { type: "string" },
          description: "Optional related record types requested by the agent."
        }
      },
      required: ["primaryRecord"]
    }
  },
  {
    name: "salesforce_explain_record_issue",
    title: "Explain Salesforce Record Issue",
    description:
      "Builds a diagnosis-style explanation from a user request and Salesforce context packet. Use this to summarize likely issue, missing information, evidence, and next safe action.",
    readOnly: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        userRequest: {
          type: "string",
          description: "The raw user request or chat message."
        },
        contextPacket: {
          type: "object",
          description: "A context packet returned by salesforce_get_record_context."
        },
        knownIssueHints: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional hints like payment_stuck, cannot_close_job, date_conflict, status_change, permission_issue."
        }
      },
      required: ["userRequest", "contextPacket"]
    }
  }
];

export function getToolContracts() {
  return SALESFORCE_MCP_TOOL_CONTRACTS;
}

export function getToolContractByName(name) {
  return SALESFORCE_MCP_TOOL_CONTRACTS.find((contract) => contract.name === name) || null;
}
