import jsforce from "jsforce";
import { getSalesforceAccessToken } from "./auth.js";

export async function createSalesforceConnection(env) {
  const tokenData = await getSalesforceAccessToken(env);

  return new jsforce.Connection({
    instanceUrl: tokenData.instance_url,
    accessToken: tokenData.access_token,
    version: env.SALESFORCE_API_VERSION || "60.0"
  });
}
