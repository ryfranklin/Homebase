// Cognito JWT validation, in-function, using only Node's built-in crypto.
//
// We do not use API Gateway's JWT authorizer because the streaming endpoint is a
// Lambda Function URL, not behind API Gateway. So the handler verifies the token
// itself: RS256 signature against the pool JWKS, then issuer, audience, and
// expiry. Issuer, audience, and JWKS all come from configuration sourced from
// SSM (P3 outputs), never literals.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export class JwtError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "JwtError";
    this.code = code;
  }
}

function b64urlToBuffer(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function decodeSegment(segment) {
  return JSON.parse(b64urlToBuffer(segment).toString("utf8"));
}

function publicKeyFromJwk(jwk) {
  return createPublicKey({ key: jwk, format: "jwk" });
}

// verifyJwt(token, { issuer, audience, jwks, now, clockToleranceSec })
// Returns the decoded claims, or throws JwtError with a specific code.
export function verifyJwt(token, opts) {
  const { issuer, audience, jwks } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const clockTolerance = opts.clockToleranceSec ?? 60;

  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new JwtError("malformed_token", "token is not a JWS");
  }
  const [headerB64, payloadB64, signatureB64] = token.split(".");

  let header;
  try {
    header = decodeSegment(headerB64);
  } catch {
    throw new JwtError("malformed_token", "unparseable header");
  }
  if (header.alg !== "RS256") {
    throw new JwtError("unsupported_alg", `unsupported alg ${header.alg}`);
  }

  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new JwtError("unknown_kid", "no JWKS key matches the token kid");
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBuffer(signatureB64);
  const ok = cryptoVerify("RSA-SHA256", signingInput, publicKeyFromJwk(jwk), signature);
  if (!ok) {
    throw new JwtError("invalid_signature", "signature verification failed");
  }

  let claims;
  try {
    claims = decodeSegment(payloadB64);
  } catch {
    throw new JwtError("malformed_token", "unparseable payload");
  }

  if (claims.iss !== issuer) {
    throw new JwtError("wrong_issuer", "iss does not match the configured issuer");
  }

  // Access tokens carry client_id; id tokens carry aud. Accept either matching.
  const tokenAudience = claims.aud ?? claims.client_id;
  const audiences = Array.isArray(tokenAudience) ? tokenAudience : [tokenAudience];
  if (!audiences.includes(audience)) {
    throw new JwtError("wrong_audience", "aud/client_id does not match the app client");
  }

  if (typeof claims.exp !== "number" || claims.exp + clockTolerance < now) {
    throw new JwtError("token_expired", "token is expired");
  }
  if (typeof claims.nbf === "number" && claims.nbf - clockTolerance > now) {
    throw new JwtError("token_not_yet_valid", "token not yet valid");
  }

  return claims;
}
