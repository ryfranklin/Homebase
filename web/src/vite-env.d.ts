/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_COGNITO_HOSTED_UI_DOMAIN: string;
  readonly VITE_COGNITO_SCOPES?: string;
  readonly VITE_REDIRECT_URI: string;
  readonly VITE_LOGOUT_URI: string;
  readonly VITE_API_BASE_URL: string;
  // Optional chat model choices: comma-separated "id|Label" pairs. Unset -> no selector.
  readonly VITE_CHAT_MODELS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
