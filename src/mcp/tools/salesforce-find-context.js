import { createSalesforceConnection } from "../../salesforce/connection.js";
import { fetchWithTimeout, getTimeoutPolicy } from "../../utils/timeout.js";
import { parseSalesforceIdentifiers } from "../../salesforce/identifier-parser.js";
import { getQueryLimitPolicy } from "../../salesforce/query-limits/queryLimitService.js";
import { ValidationError } from "../../utils/errors.js";

// Maps Salesforce object names to the field that stores the human-readable number
const NAMED_IDENTIFIER_LOOKUP = {
  ServiceAppointment: "AppointmentNumber",
  WorkOrder: "WorkOrderNumber",
  Job__c: "Name"
};

async function resolveNamedIdentifiers(candidates, env) {
  const needsResolution = candidates.filter(
    (c) => !c.recordId && c.objectName && NAMED_IDENTIFIER_LOOKUP[c.objectName]
  );

  console.log("[resolve] candidates to resolve:", needsResolution.map((c) => c.displayName));

  if (needsResolution.length === 0) {
    console.log("[resolve] nothing to resolve, skipping Salesforce lookup");
    return candidates;
  }

  let conn;
  try {
    conn = await createSalesforceConnection(env);
    console.log("[resolve] Salesforce connection established, instanceUrl:", conn.instanceUrl);
  } catch (err) {
    console.log("[resolve] Salesforce connection failed:", err.message);
    return candidates;
  }

  const version = env.SALESFORCE_API_VERSION || "60.0";
  const timeoutPolicy = getTimeoutPolicy(env);

  return Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.recordId || !candidate.objectName) {
        return candidate;
      }

      const lookupField = NAMED_IDENTIFIER_LOOKUP[candidate.objectName];

      if (!lookupField) {
        console.log(`[resolve] no lookup field for objectName="${candidate.objectName}", skipping`);
        return candidate;
      }

      const safeValue = candidate.displayName.replace(/'/g, "\\'");
      const soql = `SELECT Id FROM ${candidate.objectName} WHERE ${lookupField} = '${safeValue}' LIMIT 1`;
      const url = `${conn.instanceUrl}/services/data/v${version}/query?q=${encodeURIComponent(soql)}`;

      console.log(`[resolve] running SOQL for ${candidate.displayName}:`, soql);

      try {
        const response = await fetchWithTimeout(
          url,
          { headers: { authorization: `Bearer ${conn.accessToken}` } },
          { timeoutMs: timeoutPolicy.salesforceQueryMs, label: `resolve ${candidate.displayName}` }
        );

        if (!response.ok) {
          const errText = await response.text();
          console.log(`[resolve] SOQL response not ok (${response.status}):`, errText);
          return candidate;
        }

        const data = await response.json();
        console.log(`[resolve] SOQL result for ${candidate.displayName}: totalSize=${data.totalSize}`);

        if (data.records && data.records.length > 0) {
          console.log(`[resolve] resolved ${candidate.displayName} → recordId=${data.records[0].Id}`);
          return { ...candidate, recordId: data.records[0].Id, confidence: 0.95 };
        }

        console.log(`[resolve] no records found for ${candidate.displayName}`);
      } catch (err) {
        console.log(`[resolve] SOQL fetch error for ${candidate.displayName}:`, err.message);
      }

      return candidate;
    })
  );
}

function inferIntent(userRequest) {
  const text = userRequest.toLowerCase();

  if (/\b(payment|deposit|pay-|invoice|stripe|stuck in submission)\b/i.test(text)) {
    return "payment_or_deposit_issue";
  }

  if (/\b(status|client approval|office approval|accepted|live|new)\b/i.test(text)) {
    return "status_change_request";
  }

  if (/\b(close job|app|logout|login|sync|stuck|in transit|visit complete)\b/i.test(text)) {
    return "app_sync_or_close_job_issue";
  }

  if (/\b(schedule|assign engineer|candidates|dispatch)\b/i.test(text)) {
    return "scheduling_issue";
  }

  if (/\b(permission|access|login|license|reactivate)\b/i.test(text)) {
    return "permission_or_access_issue";
  }

  return "unknown";
}

function candidateFromIdentifier(identifier, salesforceUrl) {
  if (identifier.type === "salesforce_record_id" && salesforceUrl) {
    return {
      objectName: salesforceUrl.objectName,
      recordId: salesforceUrl.recordId,
      displayName: `${salesforceUrl.objectName} ${salesforceUrl.recordId}`,
      identifierType: identifier.type,
      confidence: 0.98,
      whyMatched: "Matched Salesforce Lightning URL."
    };
  }

  return {
    objectName: identifier.objectHint,
    recordId: identifier.type === "salesforce_record_id" ? identifier.normalizedValue : null,
    displayName: identifier.normalizedValue,
    identifierType: identifier.type,
    confidence: identifier.confidence,
    whyMatched: `Matched ${identifier.type.replace(/_/g, " ")} in request.`
  };
}

function dedupeCandidates(candidates) {
  const seen = new Set();

  return candidates.filter((candidate) => {
    const key = [
      candidate.objectName || "",
      candidate.recordId || "",
      candidate.displayName || ""
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export async function handleSalesforceFindContext(args, context) {
  if (!args || typeof args.userRequest !== "string" || args.userRequest.trim() === "") {
    throw new ValidationError("userRequest is required.");
  }

  const recordHints = Array.isArray(args.recordHints) ? args.recordHints : [];
  const combinedInput = [
    args.userRequest,
    args.salesforceUrl,
    ...recordHints
  ]
    .filter(Boolean)
    .join(" ");
  const parsed = parseSalesforceIdentifiers(combinedInput);
  const policy = getQueryLimitPolicy(context.env);
  const requestedMaxRecords =
    Number.isInteger(args.maxRecords) && args.maxRecords > 0
      ? args.maxRecords
      : policy.defaultRecordLimit;
  const maxRecords = Math.min(requestedMaxRecords, policy.maxRecordLimit);
  let candidates = dedupeCandidates(
    parsed.identifiers.map((identifier) =>
      candidateFromIdentifier(identifier, parsed.salesforceUrl)
    )
  ).slice(0, maxRecords);

  if (context?.env) {
    candidates = await resolveNamedIdentifiers(candidates, context.env);
  }

  const hasClearIdentifier = candidates.length > 0;

  return {
    ok: true,
    intentGuess: inferIntent(args.userRequest),
    detectedIdentifiers: parsed.identifiers,
    candidates,
    needsClarification: !hasClearIdentifier,
    clarificationQuestion: hasClearIdentifier
      ? null
      : "Please share the Job, Work Order, Service Appointment, Invoice, Payment, Auth number, or Salesforce link."
  };
}
