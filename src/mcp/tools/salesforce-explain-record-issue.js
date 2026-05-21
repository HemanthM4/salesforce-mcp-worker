import { ValidationError } from "../../utils/errors.js";

function inferCategory(userRequest, knownIssueHints = []) {
  const text = `${userRequest} ${knownIssueHints.join(" ")}`.toLowerCase();

  if (/\b(payment|deposit|pay-|stripe|payment_stuck)\b/i.test(text)) {
    return "payment_or_deposit_issue";
  }

  if (/\b(status|client approval|office approval|accepted|live|new|status_change)\b/i.test(text)) {
    return "status_change_request";
  }

  if (/\b(close job|cannot_close_job|app|logout|login|sync|stuck|in transit|visit complete)\b/i.test(text)) {
    return "app_sync_or_close_job_issue";
  }

  if (/\b(schedule|assign engineer|candidate|dispatch|date_conflict)\b/i.test(text)) {
    return "scheduling_issue";
  }

  if (/\b(permission|access|license|reactivate|permission_issue)\b/i.test(text)) {
    return "permission_or_access_issue";
  }

  if (/\b(report|invoice|inv-|pdf)\b/i.test(text)) {
    return "report_or_invoice_issue";
  }

  return "unknown";
}

function recommendedNextAction(category) {
  if (category === "unknown") {
    return "Ask for the record number or Salesforce link, plus any screenshot or exact error message.";
  }

  return "Review the identified Salesforce context and ask for any missing evidence before recommending a safe next step.";
}

export async function handleSalesforceExplainRecordIssue(args) {
  if (!args || typeof args.userRequest !== "string" || args.userRequest.trim() === "") {
    throw new ValidationError("userRequest is required.");
  }

  if (!args.contextPacket || typeof args.contextPacket !== "object") {
    throw new ValidationError("contextPacket is required.");
  }

  const primary = args.contextPacket.primary || {};
  const missingInformation = [];

  if (!primary.objectName) {
    missingInformation.push("primary.objectName");
  }

  if (!primary.recordId) {
    missingInformation.push("primary.recordId");
  }

  if (!primary.displayName) {
    missingInformation.push("primary.displayName");
  }

  const category = inferCategory(args.userRequest, args.knownIssueHints || []);

  return {
    ok: true,
    diagnosis: {
      category,
      confidence: category === "unknown" ? 0.3 : 0.65,
      summary:
        category === "unknown"
          ? "There is not enough structured context to classify the issue yet."
          : `The request most closely matches ${category.replace(/_/g, " ")}.`,
      evidence: [
        `User request: ${args.userRequest}`,
        primary.objectName && primary.recordId
          ? `Primary record: ${primary.objectName} ${primary.recordId}`
          : "Primary record context is incomplete."
      ].filter(Boolean),
      recommendedNextAction: recommendedNextAction(category),
      missingInformation
    },
    safeForUser: true
  };
}
