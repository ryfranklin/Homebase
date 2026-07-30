// Fetches and caches the Cognito user pool JWKS.
//
// The JWKS URI is derived from the issuer (an SSM-sourced value), per the Cognito
// docs: https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json
// The fetch function is injectable so tests provide a static JWKS with no network.

export function jwksUri(issuer) {
  return `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
}

export class JwksCache {
  constructor({ issuer, fetchImpl, ttlMs = 3600_000, now = () => Date.now() }) {
    this._uri = jwksUri(issuer);
    this._fetch = fetchImpl ?? globalThis.fetch;
    this._ttlMs = ttlMs;
    this._now = now;
    this._cached = null;
    this._expiresAt = 0;
  }

  async get() {
    if (this._cached && this._now() < this._expiresAt) {
      return this._cached;
    }
    const response = await this._fetch(this._uri);
    if (!response.ok) {
      throw new Error(`failed to fetch JWKS: ${response.status}`);
    }
    this._cached = await response.json();
    this._expiresAt = this._now() + this._ttlMs;
    return this._cached;
  }
}

// A trivial static provider for tests or preloaded keys.
export function staticJwks(jwks) {
  return { get: async () => jwks };
}
