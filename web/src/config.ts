// All identity and API config is injected via VITE_ env vars at build/runtime.
// Nothing is hardcoded, so the built bundle contains no real pool id, client id,
// hosted-UI domain, or app domain in this repo.

export interface AppConfig {
  userPoolId: string;
  clientId: string;
  hostedUiDomain: string;
  scopes: string;
  redirectUri: string;
  logoutUri: string;
  apiBaseUrl: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
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
  };
}
