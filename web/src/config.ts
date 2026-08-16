// All identity and API config is injected via VITE_ env vars at build/runtime.
// Nothing is hardcoded, so the built bundle contains no real pool id, client id,
// hosted-UI domain, or app domain in this repo.

export interface ModelOption {
  id: string;
  label: string;
}

export interface AppConfig {
  userPoolId: string;
  clientId: string;
  hostedUiDomain: string;
  scopes: string;
  redirectUri: string;
  logoutUri: string;
  apiBaseUrl: string;
  // Chat model choices offered in the UI, from VITE_CHAT_MODELS. Empty when unset,
  // which hides the selector and lets the agent use its deploy-time default model.
  models: ModelOption[];
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

// Parse VITE_CHAT_MODELS, a comma-separated list of "id|Label" pairs (label
// optional, defaults to the id). No model id is hardcoded here, so the built
// bundle carries only what the deploy injects. Malformed entries are skipped.
export function parseModels(raw: string | undefined): ModelOption[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, label] = entry.split("|").map((s) => s.trim());
      return id ? { id, label: label || id } : null;
    })
    .filter((m): m is ModelOption => m !== null);
}

export function loadConfig(env: ImportMetaEnv = import.meta.env): AppConfig {
  return {
    userPoolId: required("VITE_COGNITO_USER_POOL_ID", env.VITE_COGNITO_USER_POOL_ID),
    clientId: required("VITE_COGNITO_CLIENT_ID", env.VITE_COGNITO_CLIENT_ID),
    hostedUiDomain: required("VITE_COGNITO_HOSTED_UI_DOMAIN", env.VITE_COGNITO_HOSTED_UI_DOMAIN),
    scopes: env.VITE_COGNITO_SCOPES ?? "openid email profile",
    redirectUri: required("VITE_REDIRECT_URI", env.VITE_REDIRECT_URI),
    logoutUri: required("VITE_LOGOUT_URI", env.VITE_LOGOUT_URI),
    apiBaseUrl: required("VITE_API_BASE_URL", env.VITE_API_BASE_URL),
    models: parseModels(env.VITE_CHAT_MODELS),
  };
}
