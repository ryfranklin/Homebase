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

// The workspace views carry the heavy Markdown/highlight/mermaid code. Lazy-load
// them so the initial bundle is just the shell + login; the vault (default) or
// chat chunk loads once the user is authenticated.
const VaultView = lazy(() => import("./components/VaultView").then((m) => ({ default: m.VaultView })));
const ChatView = lazy(() => import("./components/ChatView").then((m) => ({ default: m.ChatView })));
const FlightPlanner = lazy(() => import("./plan/FlightPlanner").then((m) => ({ default: m.FlightPlanner })));
const MissionControl = lazy(() => import("./components/MissionControl").then((m) => ({ default: m.MissionControl })));

type Mode = "vault" | "chat" | "plan" | "mission";

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
  const chat = useChat(config.apiBaseUrl, auth.getAccessToken, undefined, getModel);
  const vault = useVault(config.apiBaseUrl, auth.getAccessToken, auth.getIdToken, auth.authenticated);
  // Vault-first: Homebase is primarily the knowledge-vault workspace, with the
  // agent chat one click away. Both hooks live here, so switching modes preserves
  // their state.
  const [mode, setMode] = useState<Mode>("vault");
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
        {mode === "vault" ? (
          <VaultView vault={vault} onNavigate={setMode} onSignOut={auth.logout} onOpenSettings={openSettings} />
        ) : mode === "plan" ? (
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
        ) : (
          <ChatView
            messages={chat.messages}
            streaming={chat.streaming}
            onSend={(text) => void chat.send(text)}
            onStop={chat.stop}
            onSignOut={auth.logout}
            onNavigate={setMode}
            onOpenSettings={openSettings}
            connectors={connStatus.connectors}
            onConnect={(url) => window.location.assign(url)}
            models={config.models}
            model={model}
            onModelChange={selectModel}
          />
        )}
      </Suspense>
    </>
  );
}
