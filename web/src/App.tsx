import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "./auth/useAuth";
import { LoginScreen } from "./components/LoginScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { loadConfig } from "./config";
import { useChat } from "./chat/useChat";
import { useVault } from "./vault/useVault";
import { useConnectorStatus } from "./chat/useConnectorStatus";
import { ConnectorBanner } from "./connectors/ConnectorBanner";
import { useConnectorCallback } from "./connectors/useConnectorCallback";
import { makeVaultPlanStore } from "./plan/store";
import { planOwnerFromIdToken } from "./plan/identity";
import { useMissions } from "./missions/useMissions";
import { useChatThreads } from "./chat/useChatThreads";
import { useEvals } from "./evals/useEvals";

// The workspace views carry the heavy Markdown/highlight/mermaid code. Lazy-load
// them so the initial bundle is just the shell + login; the vault (default) or
// chat chunk loads once the user is authenticated.
const VaultView = lazy(() => import("./components/VaultView").then((m) => ({ default: m.VaultView })));
const FlightPlanner = lazy(() => import("./plan/FlightPlanner").then((m) => ({ default: m.FlightPlanner })));
const MissionControl = lazy(() => import("./components/MissionControl").then((m) => ({ default: m.MissionControl })));
const EvalsView = lazy(() => import("./components/EvalsView").then((m) => ({ default: m.EvalsView })));
const DocsView = lazy(() => import("./components/DocsView").then((m) => ({ default: m.DocsView })));

// Chat is merged into the Vault surface (a docked chat panel), so there is no
// standalone Chat mode; Evals and Docs are their own surfaces.
type Mode = "vault" | "plan" | "mission" | "evals" | "docs";
type ChatScope = "vault" | "general";

export function App() {
  const config = useMemo(() => loadConfig(), []);
  const auth = useAuth(config);
  // Settings-level default chat model: persisted per browser, seeded from the first
  // configured model. A ref backs the getter so useChat reads the current choice on
  // each send without re-creating the hook. No-op when no models are configured.
  const [model, setModel] = useState<string>(
    () => localStorage.getItem("homebase.model") || config.models[0]?.id || "",
  );
  const modelRef = useRef(model);
  modelRef.current = model;
  const selectModel = useCallback((id: string) => {
    setModel(id);
    localStorage.setItem("homebase.model", id);
  }, []);
  const getModel = useCallback(() => modelRef.current || undefined, []);
  // Chat scope for the Vault chat panel: "vault" (only KB + connectors) by default,
  // "general" opens the model up. Persisted per browser; a ref backs the getter so
  // useChat reads the current choice per send without re-creating the hook.
  const [chatScope, setChatScope] = useState<ChatScope>(
    () => (localStorage.getItem("homebase.chatScope") === "general" ? "general" : "vault"),
  );
  const scopeRef = useRef(chatScope);
  scopeRef.current = chatScope;
  const setScope = useCallback((s: ChatScope) => {
    setChatScope(s);
    localStorage.setItem("homebase.chatScope", s);
  }, []);
  const getScope = useCallback(() => scopeRef.current, []);
  const chat = useChat(config.apiBaseUrl, auth.getAccessToken, undefined, getModel, getScope);
  const vault = useVault(config.apiBaseUrl, auth.getAccessToken, auth.getIdToken, auth.authenticated);
  // Vault-first: Homebase is primarily the knowledge-vault workspace, with the
  // agent chat one click away. Both hooks live here, so switching modes preserves
  // their state.
  const [mode, setMode] = useState<Mode>("vault");
  // Chat thread memory: lists saved threads and auto-saves the current one to the
  // vault when an exchange completes. Active on the Vault surface (where chat lives).
  const chatThreads = useChatThreads(config.apiBaseUrl, auth.getAccessToken, chat, getScope, mode === "vault");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Flight plans persist as vault notes. Keep the store identity stable across token
  // refreshes (read the latest token via refs) so the Plan board doesn't reload on
  // every refresh; derive the plan owner from the ID token for display.
  const getTokenRef = useRef(auth.getAccessToken);
  getTokenRef.current = auth.getAccessToken;
  const getIdTokenRef = useRef(auth.getIdToken);
  getIdTokenRef.current = auth.getIdToken;
  const planStore = useMemo(
    () => makeVaultPlanStore(config.apiBaseUrl, () => getTokenRef.current(), () => getIdTokenRef.current()),
    [config.apiBaseUrl],
  );
  const planOwner = useMemo(() => planOwnerFromIdToken(auth.tokens?.idToken), [auth.tokens?.idToken]);
  // Mission Control deck: only polls the engine while the Mission tab is open.
  const missions = useMissions(config.apiBaseUrl, auth.getAccessToken, mode === "mission");
  // Evals deck: only fetches run data while the Evals tab is open.
  const evals = useEvals(config.apiBaseUrl, auth.getAccessToken, mode === "evals");
  // Finalize a connector consent if the browser returned with ?session_id=.
  const connector = useConnectorCallback(config.apiBaseUrl, auth.getAccessToken, auth.authenticated);
  // What's actually connected (from the token vault), for the chat's source display.
  const connStatus = useConnectorStatus(config.apiBaseUrl, auth.getAccessToken, auth.authenticated);
  // Re-check after a consent finalize so a freshly linked account shows connected.
  useEffect(() => {
    void connStatus.refresh();
  }, [connector.status, connStatus.refresh]);

  if (!auth.authenticated) {
    return (
      <LoginScreen
        onLogin={() => void auth.login()}
        onGoogleLogin={() => void auth.loginWithGoogle()}
        error={auth.error}
      />
    );
  }

  const openSettings = () => setSettingsOpen(true);

  return (
    <>
      <ConnectorBanner status={connector.status} onDismiss={connector.dismiss} />
      {settingsOpen && (
        <SettingsPanel apiBaseUrl={config.apiBaseUrl} getToken={auth.getAccessToken} onClose={() => setSettingsOpen(false)} />
      )}
      <Suspense fallback={<div className="app-loading" aria-label="Loading" />}>
        {mode === "plan" ? (
          <FlightPlanner
            onNavigate={setMode}
            onSignOut={auth.logout}
            onOpenSettings={openSettings}
            store={planStore}
            user={planOwner}
            apiBaseUrl={config.apiBaseUrl}
            getToken={auth.getAccessToken}
          />
        ) : mode === "mission" ? (
          <MissionControl missions={missions} onNavigate={setMode} onSignOut={auth.logout} onOpenSettings={openSettings} />
        ) : mode === "evals" ? (
          <EvalsView evals={evals} onNavigate={setMode} onSignOut={auth.logout} onOpenSettings={openSettings} />
        ) : mode === "docs" ? (
          <DocsView onNavigate={setMode} onSignOut={auth.logout} onOpenSettings={openSettings} />
        ) : (
          <VaultView
            vault={vault}
            chat={chat}
            threads={chatThreads}
            scope={chatScope}
            onScopeChange={setScope}
            models={config.models}
            model={model}
            onModelChange={selectModel}
            onNavigate={setMode}
            onSignOut={auth.logout}
            onOpenSettings={openSettings}
            connectors={connStatus.connectors}
            onConnect={(url) => window.location.assign(url)}
          />
        )}
      </Suspense>
    </>
  );
}
