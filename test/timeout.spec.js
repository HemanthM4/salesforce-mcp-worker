import { describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  getTimeoutPolicy,
  TimeoutError,
  withTimeout
} from "../src/utils/timeout.js";
import { errorResponse } from "../src/utils/errors.js";

function delay(ms, value) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

describe("timeout utilities", () => {
  it("returns defaults when env is empty", () => {
    expect(getTimeoutPolicy({})).toEqual({
      tokenRequestMs: 8000,
      salesforceQueryMs: 10000,
      routeMs: 15000,
      mcpToolMs: 12000
    });
  });

  it("uses valid env overrides", () => {
    expect(
      getTimeoutPolicy({
        SALESFORCE_TOKEN_TIMEOUT_MS: "2000",
        SALESFORCE_QUERY_TIMEOUT_MS: "3000",
        ROUTE_TIMEOUT_MS: "4000",
        MCP_TOOL_TIMEOUT_MS: "5000"
      })
    ).toEqual({
      tokenRequestMs: 2000,
      salesforceQueryMs: 3000,
      routeMs: 4000,
      mcpToolMs: 5000
    });
  });

  it("falls back to defaults for invalid env overrides", () => {
    expect(
      getTimeoutPolicy({
        SALESFORCE_TOKEN_TIMEOUT_MS: "bad",
        SALESFORCE_QUERY_TIMEOUT_MS: "1.5",
        ROUTE_TIMEOUT_MS: "",
        MCP_TOOL_TIMEOUT_MS: "false"
      })
    ).toEqual({
      tokenRequestMs: 8000,
      salesforceQueryMs: 10000,
      routeMs: 15000,
      mcpToolMs: 12000
    });
  });

  it("falls back to defaults for too-small overrides", () => {
    expect(
      getTimeoutPolicy({
        SALESFORCE_TOKEN_TIMEOUT_MS: "999"
      }).tokenRequestMs
    ).toBe(8000);
  });

  it("falls back to defaults for too-large overrides", () => {
    expect(
      getTimeoutPolicy({
        SALESFORCE_QUERY_TIMEOUT_MS: "30001"
      }).salesforceQueryMs
    ).toBe(10000);
  });

  it("withTimeout resolves when promise completes in time", async () => {
    await expect(
      withTimeout(Promise.resolve("ok"), {
        timeoutMs: 1000,
        label: "Fast operation"
      })
    ).resolves.toBe("ok");
  });

  it("withTimeout rejects with TimeoutError when promise is too slow", async () => {
    await expect(
      withTimeout(delay(50, "late"), {
        timeoutMs: 1,
        label: "Slow operation"
      })
    ).rejects.toMatchObject({
      name: "TimeoutError",
      code: "TIMEOUT",
      retryable: true,
      details: {
        label: "Slow operation",
        timeoutMs: 1
      }
    });
  });

  it("fetchWithTimeout preserves normal fetch responses", async () => {
    const originalFetch = globalThis.fetch;
    const response = new Response("ok", { status: 503 });

    globalThis.fetch = vi.fn(async () => response);

    try {
      await expect(
        fetchWithTimeout(
          "https://example.com",
          {},
          { timeoutMs: 1000, label: "Normal fetch" }
        )
      ).resolves.toBe(response);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetchWithTimeout throws TimeoutError when aborted", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn(
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    try {
      await expect(
        fetchWithTimeout(
          "https://example.com",
          {},
          { timeoutMs: 1, label: "Slow fetch" }
        )
      ).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("errorResponse maps TimeoutError safely", async () => {
    const response = errorResponse(new TimeoutError("Test operation", 1234));

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "TIMEOUT",
        message: "Test operation timed out after 1234ms.",
        retryable: true,
        details: {
          label: "Test operation",
          timeoutMs: 1234
        }
      }
    });
  });
});
