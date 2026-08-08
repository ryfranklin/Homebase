// AgentCore Identity client used to finalize a connector's 3LO consent.
//
// After the user completes consent in the browser, AgentCore redirects back with a
// session_id. CompleteResourceTokenAuth confirms that session and promotes the
// resulting OAuth token into the durable vault, so the connector shim can then
// fetch it headlessly.
//
// We sign the single request with SigV4 by hand (node:crypto + global fetch) rather
// than the AWS SDK: the token-vault APIs are newer than the @aws-sdk version the
// Lambda runtime bundles, and the BFF ships source-only with no bundled deps. This
// mirrors how the BFF already hand-writes JWT verification instead of pulling a lib.

import { createHash, createHmac } from "node:crypto";

const SERVICE = "bedrock-agentcore";
const PATH = "/identities/CompleteResourceTokenAuth";

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

// amzDate is like 20260808T221744Z; date is the leading 8 chars.
// Exported for tests: builds the signed headers for a POST to the given host/path.
export function sigv4Headers({ host, body, region, creds, amzDate }) {
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const signable = {
    "content-type": "application/json",
    host,
    "x-amz-date": amzDate,
  };
  if (creds.sessionToken) signable["x-amz-security-token"] = creds.sessionToken;

  const sortedKeys = Object.keys(signable).sort();
  const signedHeaders = sortedKeys.join(";");
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${signable[k]}\n`).join("");
  const canonicalRequest = ["POST", PATH, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${date}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...signable, authorization };
}

function amzDateFrom(date) {
  // 2026-08-08T22:17:44.263Z -> 20260808T221744Z
  return date.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
}

// makeIdentityClient(region, deps?) — deps injects { fetchImpl, env, now } in tests.
export async function makeIdentityClient(region, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const host = `${SERVICE}.${region}.amazonaws.com`;
  const url = `https://${host}${PATH}`;

  return {
    // userId is the AgentCore user identity the 3LO flow was initiated for (the
    // tenant id, matching the connector shim); sessionUri is the session_id the
    // browser returned with.
    async completeResourceTokenAuth({ userId, sessionUri }) {
      const body = JSON.stringify({ userIdentifier: { userId }, sessionUri });
      const creds = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      };
      const signed = sigv4Headers({ host, body, region, creds, amzDate: amzDateFrom(now()) });
      // undici manages the Host header itself; sign with it but don't set it on fetch.
      const { host: _host, ...headers } = signed;

      const res = await fetchImpl(url, { method: "POST", headers, body });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`CompleteResourceTokenAuth ${res.status}: ${text.slice(0, 200)}`);
      }
    },
  };
}
