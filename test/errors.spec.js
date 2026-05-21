import { describe, expect, it } from "vitest";
import { QueryRecordLimitError } from "../src/salesforce/query-limits/queryLimitErrors.js";
import { TimeoutError } from "../src/utils/timeout.js";
import {
  AppError,
  errorResponse,
  mapError,
  redactErrorDetails,
  ValidationError
} from "../src/utils/errors.js";

describe("structured error mapping", () => {
  it("maps AppError correctly", () => {
    expect(
      mapError(
        new AppError("App failed.", {
          code: "APP_TEST",
          status: 418,
          retryable: true,
          details: { reason: "test" }
        })
      )
    ).toEqual({
      status: 418,
      body: {
        ok: false,
        error: {
          code: "APP_TEST",
          message: "App failed.",
          retryable: true,
          details: { reason: "test" }
        }
      }
    });
  });

  it("maps ValidationError to 400", () => {
    const mapped = mapError(
      new ValidationError("Invalid input.", {
        details: { field: "q" }
      })
    );

    expect(mapped.status).toBe(400);
    expect(mapped.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid input.",
      retryable: false,
      details: { field: "q" }
    });
  });

  it("maps TimeoutError to 504 and retryable true", () => {
    const mapped = mapError(new TimeoutError("Test request", 10000));

    expect(mapped.status).toBe(504);
    expect(mapped.body.error).toEqual({
      code: "TIMEOUT",
      message: "Test request timed out after 10000ms.",
      retryable: true,
      details: {
        label: "Test request",
        timeoutMs: 10000
      }
    });
  });

  it("maps query limit errors to 400", () => {
    const mapped = mapError(
      new QueryRecordLimitError("Too many records.", {
        queryLimit: 11,
        maxRecordLimit: 10
      })
    );

    expect(mapped.status).toBe(400);
    expect(mapped.body.error).toEqual({
      code: "QUERY_RECORD_LIMIT_EXCEEDED",
      message: "Too many records.",
      retryable: false,
      details: {
        queryLimit: 11,
        maxRecordLimit: 10
      }
    });
  });

  it("maps Salesforce OAuth JSON to SALESFORCE_AUTH_ERROR", () => {
    const mapped = mapError(
      new Error(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "user has not approved this consumer"
        })
      )
    );

    expect(mapped.status).toBe(401);
    expect(mapped.body.error).toEqual({
      code: "SALESFORCE_AUTH_ERROR",
      message: "user has not approved this consumer",
      retryable: false,
      details: {
        salesforceError: "invalid_grant"
      }
    });
  });

  it("maps Salesforce REST error arrays to SALESFORCE_REST_ERROR", () => {
    const mapped = mapError(
      new Error(
        JSON.stringify([
          {
            message: "No such column 'BadField' on entity 'Account'.",
            errorCode: "INVALID_FIELD"
          }
        ])
      )
    );

    expect(mapped.status).toBe(400);
    expect(mapped.body.error).toEqual({
      code: "SALESFORCE_REST_ERROR",
      message: "No such column 'BadField' on entity 'Account'.",
      retryable: false,
      details: {
        salesforceErrorCode: "INVALID_FIELD"
      }
    });
  });

  it("maps unknown errors to UNKNOWN_ERROR", () => {
    const mapped = mapError(new Error("internal implementation detail"));

    expect(mapped.status).toBe(500);
    expect(mapped.body.error).toEqual({
      code: "UNKNOWN_ERROR",
      message: "Unexpected error.",
      retryable: false,
      details: {}
    });
  });

  it("redacts sensitive keys", () => {
    expect(
      redactErrorDetails({
        access_token: "token",
        client_secret: "secret",
        nested: {
          MCP_SHARED_SECRET: "shared"
        }
      })
    ).toEqual({
      access_token: "[REDACTED]",
      client_secret: "[REDACTED]",
      nested: {
        MCP_SHARED_SECRET: "[REDACTED]"
      }
    });
  });

  it("redacts bearer token strings", () => {
    expect(redactErrorDetails("Authorization: Bearer abc.def.ghi")).toBe(
      "Authorization: Bearer [REDACTED]"
    );
  });

  it("errorResponse returns application/json", async () => {
    const response = errorResponse(new ValidationError("Bad request."));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR"
      }
    });
  });
});
