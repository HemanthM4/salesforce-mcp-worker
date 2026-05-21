import { fetchWithTimeout, getTimeoutPolicy } from "../utils/timeout.js";

export function base64UrlEncode(input) {
  let bytes;

  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64ToArrayBuffer(base64) {
  if (!base64) {
    throw new Error(
      "SALESFORCE_PRIVATE_KEY_DER_B64 is missing. Provide a single-line base64 DER PKCS8 private key."
    );
  }

  const normalized = base64.replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function signJwtWithPrivateKey(jwtHeaderAndPayload, env) {
  // SALESFORCE_PRIVATE_KEY_DER_B64 must be a single-line base64 DER PKCS8
  // private key. Upload the matching public certificate to the Salesforce
  // External Client App and pre-authorize that app for the Salesforce user.
  const keyData = base64ToArrayBuffer(env.SALESFORCE_PRIVATE_KEY_DER_B64);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(jwtHeaderAndPayload)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

export async function createSalesforceJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const loginUrl = env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iss: env.SALESFORCE_CLIENT_ID,
    sub: env.SALESFORCE_USERNAME,
    aud: loginUrl,
    exp: now + 180
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const encodedSignature = await signJwtWithPrivateKey(signingInput, env);

  return `${signingInput}.${encodedSignature}`;
}

export async function getSalesforceAccessToken(env) {
  const loginUrl = env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
  const timeoutPolicy = getTimeoutPolicy(env);
  const assertion = await createSalesforceJwt(env);

  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", assertion);

  const response = await fetchWithTimeout(
    `${loginUrl}/services/oauth2/token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    },
    {
      timeoutMs: timeoutPolicy.tokenRequestMs,
      label: "Salesforce token request"
    }
  );

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(`Salesforce JWT login failed: ${JSON.stringify(data)}`);
  }

  return data;
}
