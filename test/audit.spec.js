import { describe, expect, it, vi } from "vitest";
import { getAuditConfig } from "../src/audit/auditConfig.js";
import {
  auditEvent,
  auditTimedOperation,
  getRequestAuditContext
} from "../src/audit/auditLogger.js";
import { redactObject, safeStringPreview } from "../src/audit/redact.js";

function readLoggedEvent(spy) {
  return JSON.parse(spy.mock.calls[0][0]);
}

describe("audit logging", () => {
  it("getAuditConfig returns defaults", () => {
    expect(getAuditConfig({})).toEqual({
      enabled: true,
      sink: "console",
      logSuccess: true,
      logFailure: true,
      includeQueryPreview: true,
      queryPreviewMaxChars: 300,
      includeRecordCounts: true
    });
  });

  it("env booleans parse correctly", () => {
    expect(
      getAuditConfig({
        AUDIT_ENABLED: "false",
        AUDIT_LOG_SUCCESS: "false",
        AUDIT_LOG_FAILURE: "true",
        AUDIT_INCLUDE_QUERY_PREVIEW: "false",
        AUDIT_INCLUDE_RECORD_COUNTS: "true"
      })
    ).toMatchObject({
      enabled: false,
      logSuccess: false,
      logFailure: true,
      includeQueryPreview: false,
      includeRecordCounts: true
    });
  });

  it("audit disabled emits no console call", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await auditEvent({ AUDIT_ENABLED: "false" }, { event: "test.audit" });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("success logs are skipped when AUDIT_LOG_SUCCESS=false", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await auditEvent(
        { AUDIT_LOG_SUCCESS: "false" },
        { event: "test.audit", level: "success" }
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("failure logs are skipped when AUDIT_LOG_FAILURE=false", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await auditEvent(
        { AUDIT_LOG_FAILURE: "false" },
        { event: "test.audit", level: "failure" }
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("sensitive keys are redacted", () => {
    expect(
      redactObject({
        access_token: "token",
        authorization: "Bearer token",
        privateKey: "private",
        nested: {
          clientSecret: "secret"
        }
      })
    ).toEqual({
      access_token: "[REDACTED]",
      authorization: "Bearer [REDACTED]",
      privateKey: "[REDACTED]",
      nested: {
        clientSecret: "[REDACTED]"
      }
    });
  });

  it("Bearer token strings are redacted", () => {
    expect(safeStringPreview("Authorization: Bearer abc123", 300)).toBe(
      "Authorization: Bearer [REDACTED]"
    );
  });

  it("query preview is truncated", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await auditEvent(
        { AUDIT_QUERY_PREVIEW_MAX_CHARS: "50" },
        {
          event: "salesforce.query.request",
          queryPreview: `SELECT ${"A".repeat(100)} FROM Account`
        }
      );

      expect(readLoggedEvent(spy).queryPreview).toHaveLength(53);
      expect(readLoggedEvent(spy).queryPreview.endsWith("...")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("auditTimedOperation logs success and returns result", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(
        auditTimedOperation(
          {},
          { event: "salesforce.query.request" },
          async () => ({ recordCount: 2 }),
          { successFields: (result) => ({ recordCount: result.recordCount }) }
        )
      ).resolves.toEqual({ recordCount: 2 });

      const event = readLoggedEvent(spy);
      expect(event.event).toBe("salesforce.query.success");
      expect(event.status).toBe("success");
      expect(event.recordCount).toBe(2);
      expect(typeof event.durationMs).toBe("number");
    } finally {
      spy.mockRestore();
    }
  });

  it("auditTimedOperation logs failure and rethrows error", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("failed");
    error.code = "TEST_ERROR";

    try {
      await expect(
        auditTimedOperation(
          {},
          { event: "salesforce.query.request" },
          async () => {
            throw error;
          }
        )
      ).rejects.toThrow("failed");

      const event = readLoggedEvent(spy);
      expect(event.event).toBe("salesforce.query.failure");
      expect(event.status).toBe("failure");
      expect(event.errorCode).toBe("TEST_ERROR");
    } finally {
      spy.mockRestore();
    }
  });

  it("getRequestAuditContext returns route, method, and requestId", () => {
    const request = new Request("https://example.com/debug/audit-test", {
      method: "POST",
      headers: {
        "cf-ray": "abc-LHR",
        "user-agent": "vitest"
      }
    });

    expect(getRequestAuditContext(request)).toEqual({
      requestId: "abc-LHR",
      route: "/debug/audit-test",
      method: "POST",
      userAgent: "vitest"
    });
  });
});
