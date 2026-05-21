import { createSalesforceConnection } from "../../salesforce/connection.js";
import { fetchWithTimeout, getTimeoutPolicy } from "../../utils/timeout.js";
import { ValidationError } from "../../utils/errors.js";

function compactFields(record) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "attributes")
      .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
  );
}

function inferDisplayName(fields, fallback) {
  return fields.Name || fields.Subject || fields.WorkOrderNumber || fields.AppointmentNumber || fallback;
}

export async function handleSalesforceGetRecordContext(args, context) {
  const primaryRecord = args?.primaryRecord;

  if (!primaryRecord?.objectName || typeof primaryRecord.objectName !== "string") {
    throw new ValidationError("primaryRecord.objectName is required.");
  }

  if (!primaryRecord?.recordId || typeof primaryRecord.recordId !== "string") {
    throw new ValidationError(
      "A Salesforce recordId is required. Use salesforce_find_context first, then select a candidate with a recordId."
    );
  }

  const env = context.env;
  const conn = await createSalesforceConnection(env);
  const version = env.SALESFORCE_API_VERSION || "60.0";
  const timeoutPolicy = getTimeoutPolicy(env);
  const response = await fetchWithTimeout(
    `${conn.instanceUrl}/services/data/v${version}/sobjects/${encodeURIComponent(
      primaryRecord.objectName
    )}/${encodeURIComponent(primaryRecord.recordId)}`,
    {
      headers: {
        authorization: `Bearer ${conn.accessToken}`
      }
    },
    {
      timeoutMs: timeoutPolicy.salesforceQueryMs,
      label: "Salesforce record context request"
    }
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Salesforce record context failed: ${JSON.stringify(data)}`);
  }

  const fields = compactFields(data);

  return {
    ok: true,
    contextPacket: {
      source: "salesforce",
      contextType: "record_context",
      primary: {
        objectName: primaryRecord.objectName,
        recordId: primaryRecord.recordId,
        displayName: primaryRecord.displayName || inferDisplayName(fields, primaryRecord.recordId),
        fields
      },
      related: {},
      notes: ["Related records are not expanded yet in this phase."]
    }
  };
}
