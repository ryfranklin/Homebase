// Cognito hosted UI (authorization-code + PKCE) helpers. No client secret.

import type { AppConfig } from "../config";
import { codeChallengeFor, generateCodeVerifier, randomString } from "./pkce";

export interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch seconds
}

const VERIFIER_KEY = "homebase.pkce.verifier";
const STATE_KEY = "homebase.pkce.state";

// Build the hosted UI authorize URL and stash the PKCE verifier + state.
// identityProvider="Google" jumps straight to Google federation.
export async function beginLogin(config: AppConfig, identityProvider?: string): Promise<string> {
  const verifier = generateCodeVerifier();
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const challenge = await codeChallengeFor(verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (identityProvider) params.set("identity_provider", identityProvider);

  return `${config.hostedUiDomain}/oauth2/authorize?${params.toString()}`;
}

export function logoutUrl(config: AppConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.logoutUri,
  });
  return `${config.hostedUiDomain}/logout?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

function toTokenSet(json: TokenResponse, now: number): TokenSet {
  return {
    accessToken: json.access_token,
    idToken: json.id_token,
    refreshToken: json.refresh_token,
    expiresAt: now + json.expires_in,
  };
}

// Exchange the authorization code for tokens. Verifies the returned state.
export async function exchangeCode(
  config: AppConfig,
  code: string,
  returnedState: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Math.floor(Date.now() / 1000),
): Promise<TokenSet> {
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!expectedState || returnedState !== expectedState) throw new Error("state mismatch");
  if (!verifier) throw new Error("missing PKCE verifier");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  const res = await fetchImpl(`${config.hostedUiDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  return toTokenSet((await res.json()) as TokenResponse, now);
}

export async function refreshTokens(
  config: AppConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Math.floor(Date.now() / 1000),
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  const res = await fetchImpl(`${config.hostedUiDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const set = toTokenSet((await res.json()) as TokenResponse, now);
  // Cognito omits refresh_token on refresh; keep the existing one.
  return { ...set, refreshToken: set.refreshToken ?? refreshToken };
}
