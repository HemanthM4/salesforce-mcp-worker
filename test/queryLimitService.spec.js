import { describe, expect, it } from "vitest";
import {
  applyLimitToSoql,
  getQueryLimitPolicy
} from "../src/salesforce/query-limits/queryLimitService.js";
import {
  QueryFieldLimitError,
  QueryRecordLimitError,
  QueryTooLongError
} from "../src/salesforce/query-limits/queryLimitErrors.js";

describe("queryLimitService", () => {
  it("adds default LIMIT when query has no LIMIT", () => {
    expect(
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account",
        env: {}
      })
    ).toBe("SELECT Id, Name FROM Account LIMIT 5");
  });

  it("uses requestedLimit when valid", () => {
    expect(
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account",
        requestedLimit: "7",
        env: {}
      })
    ).toBe("SELECT Id, Name FROM Account LIMIT 7");
  });

  it("keeps query LIMIT when it is allowed", () => {
    expect(
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account LIMIT 10",
        env: {}
      })
    ).toBe("SELECT Id, Name FROM Account LIMIT 10");
  });

  it("rejects query LIMIT above max", () => {
    expect(() =>
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account LIMIT 11",
        env: {}
      })
    ).toThrow(QueryRecordLimitError);
  });

  it("rejects requestedLimit above max", () => {
    expect(() =>
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account",
        requestedLimit: "11",
        env: {}
      })
    ).toThrow(QueryRecordLimitError);
  });

  it("rejects very long queries", () => {
    expect(() =>
      applyLimitToSoql({
        soql: `SELECT Id FROM Account WHERE Name = '${"a".repeat(4000)}'`,
        env: {}
      })
    ).toThrow(QueryTooLongError);
  });

  it("rejects too many selected fields", () => {
    const fields = Array.from({ length: 51 }, (_, index) => `Field${index}`).join(
      ", "
    );

    expect(() =>
      applyLimitToSoql({
        soql: `SELECT ${fields} FROM Account`,
        env: {}
      })
    ).toThrow(QueryFieldLimitError);
  });

  it("removes trailing semicolon before appending LIMIT", () => {
    expect(
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account;",
        env: {}
      })
    ).toBe("SELECT Id, Name FROM Account LIMIT 5");
  });

  it("allows env override to increase max limit safely", () => {
    const env = {
      SALESFORCE_DEFAULT_RECORD_LIMIT: "8",
      SALESFORCE_MAX_RECORD_LIMIT: "25"
    };

    expect(getQueryLimitPolicy(env)).toMatchObject({
      defaultRecordLimit: 8,
      maxRecordLimit: 25
    });
    expect(
      applyLimitToSoql({
        soql: "SELECT Id, Name FROM Account",
        requestedLimit: "20",
        env
      })
    ).toBe("SELECT Id, Name FROM Account LIMIT 20");
  });

  it("falls back to defaults for invalid env overrides", () => {
    const env = {
      SALESFORCE_DEFAULT_RECORD_LIMIT: "not-a-number",
      SALESFORCE_MAX_RECORD_LIMIT: "0",
      SALESFORCE_MAX_QUERY_LENGTH: "-1",
      SALESFORCE_MAX_SELECTED_FIELDS: "1.5",
      SALESFORCE_ALLOW_QUERY_MORE: "TRUE"
    };

    expect(getQueryLimitPolicy(env)).toEqual({
      defaultRecordLimit: 5,
      maxRecordLimit: 10,
      maxQueryLength: 4000,
      maxSelectedFields: 50,
      allowQueryMore: false
    });
  });
});
