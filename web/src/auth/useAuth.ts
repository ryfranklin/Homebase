import { useCallback, useEffect, useState } from "react";

import type { AppConfig } from "../config";
import { beginLogin, exchangeCode, logoutUrl, refreshTokens, type TokenSet } from "./cognito";

const STORAGE_KEY = "homebase.tokens";
const REFRESH_SKEW_SECONDS = 60;

function loadStored(): TokenSet | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

function store(tokens: TokenSet | null) {
  if (tokens) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  else sessionStorage.removeItem(STORAGE_KEY);
}

export interface Auth {
  tokens: TokenSet | null;
  authenticated: boolean;
  error?: string;
  login: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  getAccessToken: () => Promise<string>;
}

export function useAuth(config: AppConfig): Auth {
  const [tokens, setTokens] = useState<TokenSet | null>(() => loadStored());
  const [error, setError] = useState<string | undefined>();

  // Handle the hosted-UI redirect (?code=...&state=...) once on load.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return;
    exchangeCode(config, code, state)
      .then((set) => {
        setTokens(set);
        store(set);
        window.history.replaceState({}, "", url.pathname);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "login failed"));
  }, [config]);

  const login = useCallback(async () => {
    window.location.assign(await beginLogin(config));
  }, [config]);

  const loginWithGoogle = useCallback(async () => {
    window.location.assign(await beginLogin(config, "Google"));
  }, [config]);

  const logout = useCallback(() => {
    setTokens(null);
    store(null);
    window.location.assign(logoutUrl(config));
  }, [config]);

  // Always returns a valid access token, refreshing when close to expiry.
  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!tokens) throw new Error("not authenticated");
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt - REFRESH_SKEW_SECONDS > now) return tokens.accessToken;
    if (!tokens.refreshToken) throw new Error("session expired");
    const refreshed = await refreshTokens(config, tokens.refreshToken);
    setTokens(refreshed);
    store(refreshed);
    return refreshed.accessToken;
  }, [config, tokens]);

  return {
    tokens,
    authenticated: !!tokens,
    error,
    login,
    loginWithGoogle,
    logout,
    getAccessToken,
  };
}
