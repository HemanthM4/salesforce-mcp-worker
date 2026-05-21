import { parseSalesforceIdentifiers } from "../../salesforce/identifier-parser.js";
import { getQueryLimitPolicy } from "../../salesforce/query-limits/queryLimitService.js";
import { ValidationError } from "../../utils/errors.js";

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
  const candidates = dedupeCandidates(
    parsed.identifiers.map((identifier) =>
      candidateFromIdentifier(identifier, parsed.salesforceUrl)
    )
  ).slice(0, maxRecords);
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
