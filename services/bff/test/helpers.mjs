// Test helpers: generate an RSA keypair, expose it as a JWKS, and sign fake JWTs.
// All standard library, so the tests run offline with no network and no deps.

import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

export function makeKeypair(kid = "test-kid") {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { privateKey, jwk, kid };
}

export function jwksFor(...keys) {
  return { keys: keys.map((k) => k.jwk) };
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// signJwt(payload, key, { alg }) -> compact JWS. With alg "none" or a wrong key,
// produces an unverifiable token for negative tests.
export function signJwt(payload, key, { alg = "RS256" } = {}) {
  const header = { alg, kid: key.kid, typ: "JWT" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  let signature;
  if (alg === "RS256") {
    signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), key.privateKey);
  } else {
    signature = Buffer.from("not-a-real-signature");
  }
  return `${signingInput}.${b64url(signature)}`;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}
