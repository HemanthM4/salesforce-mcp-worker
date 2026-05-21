import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("salesforce-mcp-worker", () => {
	it("returns health status", async () => {
		const request = new Request("http://example.com/health");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			service: "salesforce-mcp-worker",
			mode: env.MCP_ACCESS_MODE || "unknown",
		});
	});

	it("returns debug environment flags", async () => {
		const response = await SELF.fetch("http://example.com/debug/env");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			hasClientId: Boolean(env.SALESFORCE_CLIENT_ID),
			hasUsername: Boolean(env.SALESFORCE_USERNAME),
			hasPrivateKeyDerB64: Boolean(env.SALESFORCE_PRIVATE_KEY_DER_B64),
			loginUrl: env.SALESFORCE_LOGIN_URL,
			instanceUrl: env.SALESFORCE_INSTANCE_URL,
		});
	});
});
