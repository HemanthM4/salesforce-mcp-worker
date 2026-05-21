const SALESFORCE_ID_PATTERN =
  /\b(?=[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b)(?=[a-zA-Z0-9]*\d)[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g;

const IDENTIFIER_PATTERNS = [
  { type: "job_number", pattern: /\bJ-?\s*\d{3,}\b/gi },
  { type: "service_appointment_number", pattern: /\bSA-?\s*\d{3,}\b/gi },
  { type: "work_order_number", pattern: /\bWO-?\s*\d{3,}\b/gi },
  { type: "payment_number", pattern: /\bPAY-\d{3,}\b/gi },
  { type: "invoice_number", pattern: /\bINV-\d{3,}\b/gi },
  { type: "authorisation_number", pattern: /\bAUTH-\d{3,}\b/gi },
  { type: "account_number", pattern: /\bA\d{3,}\b/gi },
  { type: "work_order_number", pattern: /\b00[5]\d{5,}\b/g }
];

function normalizeIdentifier(value) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function addUniqueIdentifier(identifiers, identifier) {
  const exists = identifiers.some(
    (existing) =>
      existing.type === identifier.type &&
      existing.normalizedValue === identifier.normalizedValue
  );

  if (!exists) {
    identifiers.push(identifier);
  }
}

export function parseSalesforceUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  const match = url.match(
    /\/lightning\/r\/([^/?#]+)\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view/i
  );

  if (!match) {
    return null;
  }

  return {
    objectName: decodeURIComponent(match[1]),
    recordId: match[2],
    url
  };
}

export function inferObjectFromPrefixOrUrl(value) {
  const normalized = normalizeIdentifier(value || "");
  const parsedUrl = parseSalesforceUrl(value);

  if (parsedUrl?.objectName) {
    return parsedUrl.objectName;
  }

  if (normalized.startsWith("J")) {
    return "Job__c";
  }

  if (normalized.startsWith("SA")) {
    return "ServiceAppointment";
  }

  if (normalized.startsWith("WO") || /^005\d{5,}$/.test(normalized)) {
    return "WorkOrder";
  }

  if (normalized.startsWith("PAY-")) {
    return "Payment__c_OR_CUSTOM";
  }

  if (normalized.startsWith("INV-")) {
    return "Invoice__c_OR_CUSTOM";
  }

  if (normalized.startsWith("AUTH-")) {
    return "Authorisation__c_OR_CUSTOM";
  }

  if (/^A\d+$/.test(normalized)) {
    return "Account__c_OR_CUSTOM";
  }

  return undefined;
}

export function parseSalesforceIdentifiers(input) {
  const text = Array.isArray(input)
    ? input.filter(Boolean).join(" ")
    : String(input || "");
  const identifiers = [];
  const salesforceUrl = parseSalesforceUrl(text);

  if (salesforceUrl) {
    addUniqueIdentifier(identifiers, {
      type: "salesforce_record_id",
      value: salesforceUrl.recordId,
      normalizedValue: salesforceUrl.recordId,
      objectHint: salesforceUrl.objectName,
      confidence: 0.98
    });
  }

  for (const { type, pattern } of IDENTIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const normalizedValue = normalizeIdentifier(value);

      addUniqueIdentifier(identifiers, {
        type,
        value,
        normalizedValue,
        objectHint: inferObjectFromPrefixOrUrl(normalizedValue),
        confidence: 0.8
      });
    }
  }

  for (const match of text.matchAll(SALESFORCE_ID_PATTERN)) {
    const value = match[0];

    addUniqueIdentifier(identifiers, {
      type: "salesforce_record_id",
      value,
      normalizedValue: value,
      objectHint: inferObjectFromPrefixOrUrl(value),
      confidence: 0.9
    });
  }

  return {
    identifiers,
    salesforceUrl
  };
}
