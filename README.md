# salesforce-mcp-worker
salesforce-mcp-worker

## Salesforce JWT setup

Generate a certificate and a PKCS#8 DER private key payload for the Worker secret:

```sh
rm -rf certs
mkdir certs

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out certs/server.pkcs8.key

openssl req -new -x509 \
  -key certs/server.pkcs8.key \
  -out certs/server.crt \
  -days 3650 \
  -subj "/C=GB/O=Chumley/CN=salesforce-mcp-worker"

openssl pkcs8 -topk8 -nocrypt \
  -in certs/server.pkcs8.key \
  -outform DER | openssl base64 -A > certs/server.pkcs8.der.b64
```

`SALESFORCE_PRIVATE_KEY_DER_B64` must be generated from a PKCS#8 DER private key. Do not paste a PEM block into the Worker secret.

Upload `certs/server.crt` to the Salesforce External Client App.

Put the contents of `certs/server.pkcs8.der.b64` into `.dev.vars` as `SALESFORCE_PRIVATE_KEY_DER_B64`.

For production, run:

```sh
npx wrangler secret put SALESFORCE_PRIVATE_KEY_DER_B64
```

Expected checks:

- `http://localhost:8787/debug/env` should show `hasPrivateKeyDerB64: true`.
- `http://localhost:8787/debug/salesforce-login` should return `ok: true` when the Salesforce app, certificate, and user are configured correctly.

## Flag 4.5 query size limits

Dynamic SOQL is temporarily allowed, but every dynamic Salesforce query must pass through `applyLimitToSoql` from `src/salesforce/query-limits/queryLimitService.js` before execution.

Default policy:

- Default record limit is `5`.
- Max record limit is `10`.
- Max query length is `4000`.
- Max selected fields is `50`.
- `queryMore` is disabled by default.

Future query routes and MCP tools must use the shared query limit service instead of hardcoded route-level constants. Future developers can increase the maximum record size through the safe non-secret env var `SALESFORCE_MAX_RECORD_LIMIT`.

Debug checks:

- `http://localhost:8787/debug/query-limits` returns the active policy.
- `http://localhost:8787/debug/limited-query?q=SELECT%20Id,Name%20FROM%20Account` executes `SELECT Id,Name FROM Account LIMIT 5`.
- `http://localhost:8787/debug/limited-query?q=SELECT%20Id,Name%20FROM%20Account%20LIMIT%2011` is rejected because it exceeds the default max record limit.

## Flag 4.6 timeout handling

Salesforce token requests time out after `8000ms` by default. Salesforce query requests time out after `10000ms` by default. Route-level timeout defaults to `15000ms`, and future MCP tool timeout defaults to `12000ms`.

Developers can change these values through safe Wrangler vars:

- `SALESFORCE_TOKEN_TIMEOUT_MS`
- `SALESFORCE_QUERY_TIMEOUT_MS`
- `ROUTE_TIMEOUT_MS`
- `MCP_TOOL_TIMEOUT_MS`

All future Salesforce REST fetches and MCP tools should use `fetchWithTimeout` or `withTimeout` from `src/utils/timeout.js`.

Debug check:

- `http://localhost:8787/debug/timeouts` returns the active timeout policy.

## Flag 4.7 structured error mapping

All routes and future MCP tools must return failures through `errorResponse(error)` from `src/utils/errors.js`.

Standard error shape:

```json
{
  "ok": false,
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "Safe user/developer-readable message.",
    "retryable": false,
    "details": {}
  }
}
```

No stack traces or secrets are returned. Salesforce OAuth errors, Salesforce REST errors, timeout errors, and query limit errors are normalized into the standard shape.

Debug checks:

- `http://localhost:8787/debug/error-test?type=timeout`
- `http://localhost:8787/debug/error-test?type=validation`
- `http://localhost:8787/debug/error-test?type=salesforce-auth`
- `http://localhost:8787/debug/error-test?type=unknown`

## Flag 4.13 audit logging

Audit logging uses structured JSON console logs through `src/audit/`. Logs are sanitized and redacted before emission. Access tokens, refresh tokens, private keys, JWT assertions, client secrets, `MCP_SHARED_SECRET`, Authorization headers, and Bearer tokens must not be logged.

Currently audited routes:

- `/debug/salesforce-login`
- `/debug/salesforce-userinfo`
- `/debug/limited-query`
- `/debug/error-test`
- `/debug/audit-test`

Future MCP tools should call `auditEvent` or `auditTimedOperation` rather than writing to `console` directly. The audit API is sink-oriented so a D1 audit sink can be added later without changing route code.

Debug check:

- `http://localhost:8787/debug/audit-test` emits a redacted audit event to the Wrangler dev terminal.

## Flag 4.14 MCP tool contracts and structure

This phase intentionally defines only 3 broad read-only tools because real users often ask vague questions:

1. `salesforce_find_context` finds likely records and identifiers from a raw request, Salesforce URL, or record numbers.
2. `salesforce_get_record_context` reads one selected record into a compact context packet.
3. `salesforce_explain_record_issue` turns a request plus context packet into a diagnosis-style summary.

Recommended flow:

```text
User vague request
-> salesforce_find_context
-> salesforce_get_record_context
-> salesforce_explain_record_issue
-> agent answer
```

This is the contract and skeleton layer, not full business diagnostics yet. Tools are read-only. Query limits, timeouts, structured errors, and audit logging still apply.

Start local dev:

```sh
npm run dev
```

List tools:

```text
http://localhost:8787/debug/tools
```

Find context example:

```js
fetch("http://localhost:8787/debug/tool-call?tool=salesforce_find_context&args=" + encodeURIComponent(JSON.stringify({
  userRequest: "PAY-000274365 stuck in submission please help"
}))).then(r => r.json()).then(console.log);
```

Salesforce URL example:

```js
fetch("http://localhost:8787/debug/tool-call?tool=salesforce_find_context&args=" + encodeURIComponent(JSON.stringify({
  userRequest: "please check this SA",
  salesforceUrl: "https://chumley.lightning.force.com/lightning/r/ServiceAppointment/08pWS000002paWXYAY/view"
}))).then(r => r.json()).then(console.log);
```

Explain issue example:

```js
fetch("http://localhost:8787/debug/tool-call?tool=salesforce_explain_record_issue&args=" + encodeURIComponent(JSON.stringify({
  userRequest: "engineer cannot close job",
  contextPacket: {
    primary: {
      objectName: "ServiceAppointment",
      recordId: "08p...",
      displayName: "SA-123"
    }
  }
}))).then(r => r.json()).then(console.log);
```
