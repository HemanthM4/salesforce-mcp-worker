import { describe, expect, it } from "vitest";
import {
  getToolContractByName,
  getToolContracts
} from "../src/mcp/tool-contracts.js";
import { dispatchToolCall } from "../src/mcp/tool-dispatcher.js";
import {
  assertKnownTool,
  getTool,
  listTools
} from "../src/mcp/tool-registry.js";
import {
  parseSalesforceIdentifiers,
  parseSalesforceUrl
} from "../src/salesforce/identifier-parser.js";
import { handleSalesforceExplainRecordIssue } from "../src/mcp/tools/salesforce-explain-record-issue.js";
import { handleSalesforceFindContext } from "../src/mcp/tools/salesforce-find-context.js";

const testEnv = {
  AUDIT_ENABLED: "false"
};

describe("MCP tool contracts and structure", () => {
  it("listTools returns exactly 3 tools", () => {
    expect(listTools()).toHaveLength(3);
    expect(listTools().map((tool) => tool.name)).toEqual([
      "salesforce_find_context",
      "salesforce_get_record_context",
      "salesforce_explain_record_issue"
    ]);
  });

  it("getToolContractByName works", () => {
    expect(getToolContractByName("salesforce_find_context")).toMatchObject({
      name: "salesforce_find_context",
      readOnly: true
    });
    expect(getToolContracts()).toHaveLength(3);
  });

  it("unknown tool returns null or throws through assertKnownTool", () => {
    expect(getTool("missing_tool")).toBeNull();
    expect(() => assertKnownTool("missing_tool")).toThrow("Unknown tool.");
  });

  it("dispatchToolCall calls correct handler", async () => {
    await expect(
      dispatchToolCall({
        toolName: "salesforce_find_context",
        arguments: {
          userRequest: "PAY-000274365 stuck in submission please help"
        },
        env: testEnv
      })
    ).resolves.toMatchObject({
      ok: true,
      intentGuess: "payment_or_deposit_issue",
      candidates: [
        {
          objectName: "Payment__c_OR_CUSTOM",
          displayName: "PAY-000274365"
        }
      ]
    });
  });

  it("dispatchToolCall rejects unknown tool", async () => {
    await expect(
      dispatchToolCall({
        toolName: "unknown",
        arguments: {},
        env: testEnv
      })
    ).rejects.toThrow("Unknown tool.");
  });

  it("parseSalesforceUrl extracts objectName and recordId", () => {
    expect(
      parseSalesforceUrl(
        "https://chumley.lightning.force.com/lightning/r/ServiceAppointment/08pWS000002paWXYAY/view"
      )
    ).toEqual({
      objectName: "ServiceAppointment",
      recordId: "08pWS000002paWXYAY",
      url: "https://chumley.lightning.force.com/lightning/r/ServiceAppointment/08pWS000002paWXYAY/view"
    });
  });

  it("parseSalesforceIdentifiers detects common business identifiers", () => {
    const parsed = parseSalesforceIdentifiers(
      "J-346589 SA- 686822 PAY-000274365 INV-304550 AUTH-000166374"
    );

    expect(parsed.identifiers.map((identifier) => identifier.type)).toEqual(
      expect.arrayContaining([
        "job_number",
        "service_appointment_number",
        "payment_number",
        "invoice_number",
        "authorisation_number"
      ])
    );
  });

  it("salesforce_find_context returns needsClarification=true when no identifier", async () => {
    await expect(
      handleSalesforceFindContext(
        { userRequest: "please assist this is not working" },
        { env: testEnv }
      )
    ).resolves.toMatchObject({
      ok: true,
      needsClarification: true,
      clarificationQuestion:
        "Please share the Job, Work Order, Service Appointment, Invoice, Payment, Auth number, or Salesforce link."
    });
  });

  it("salesforce_find_context returns candidate when Salesforce URL is passed", async () => {
    const result = await handleSalesforceFindContext(
      {
        userRequest: "please check this SA",
        salesforceUrl:
          "https://chumley.lightning.force.com/lightning/r/ServiceAppointment/08pWS000002paWXYAY/view"
      },
      { env: testEnv }
    );

    expect(result).toMatchObject({
      ok: true,
      needsClarification: false,
      candidates: [
        {
          objectName: "ServiceAppointment",
          recordId: "08pWS000002paWXYAY"
        }
      ]
    });
    expect(result.detectedIdentifiers).toHaveLength(1);
  });

  it("parseSalesforceIdentifiers does not treat object API names as record IDs", () => {
    const parsed = parseSalesforceIdentifiers(
      "https://chumley.lightning.force.com/lightning/r/ServiceAppointment/08pWS000002paWXYAY/view"
    );

    expect(parsed.identifiers.map((identifier) => identifier.value)).toEqual([
      "08pWS000002paWXYAY"
    ]);
  });

  it("salesforce_explain_record_issue returns payment category for payment wording", async () => {
    await expect(
      handleSalesforceExplainRecordIssue({
        userRequest: "payment is stuck",
        contextPacket: {
          primary: {
            objectName: "Payment__c_OR_CUSTOM",
            recordId: "a00xx",
            displayName: "PAY-000274365"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      diagnosis: {
        category: "payment_or_deposit_issue"
      },
      safeForUser: true
    });
  });

  it("salesforce_explain_record_issue returns unknown when vague with incomplete context", async () => {
    await expect(
      handleSalesforceExplainRecordIssue({
        userRequest: "please assist",
        contextPacket: {
          primary: {}
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      diagnosis: {
        category: "unknown",
        missingInformation: [
          "primary.objectName",
          "primary.recordId",
          "primary.displayName"
        ]
      }
    });
  });

  it("tool results do not include known secret fields", async () => {
    const result = await dispatchToolCall({
      toolName: "salesforce_find_context",
      arguments: {
        userRequest: "J-346589 client accepted but no invoice generated"
      },
      env: testEnv
    });
    const serialized = JSON.stringify(result).toLowerCase();

    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("client_secret");
    expect(serialized).not.toContain("mcp_shared_secret");
    expect(serialized).not.toContain("bearer ");
  });
});
