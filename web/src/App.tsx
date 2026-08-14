import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { useAuth } from "./auth/useAuth";
import { LoginScreen } from "./components/LoginScreen";
import { loadConfig } from "./config";
import { useChat } from "./chat/useChat";
import { useVault } from "./vault/useVault";
import { useConnectorStatus } from "./chat/useConnectorStatus";
import { ConnectorBanner } from "./connectors/ConnectorBanner";
import { useConnectorCallback } from "./connectors/useConnectorCallback";

// The workspace views carry the heavy Markdown/highlight/mermaid code. Lazy-load
// them so the initial bundle is just the shell + login; the vault (default) or
// chat chunk loads once the user is authenticated.
const VaultView = lazy(() => import("./components/VaultView").then((m) => ({ default: m.VaultView })));
const ChatView = lazy(() => import("./components/ChatView").then((m) => ({ default: m.ChatView })));

type Mode = "vault" | "chat";

export function App() {
  const config = useMemo(() => loadConfig(), []);
  const auth = useAuth(config);
  const chat = useChat(config.apiBaseUrl, auth.getAccessToken);
  const vault = useVault(config.apiBaseUrl, auth.getAccessToken, auth.getIdToken);
  // Vault-first: Homebase is primarily the knowledge-vault workspace, with the
  // agent chat one click away. Both hooks live here, so switching modes preserves
  // their state.
  const [mode, setMode] = useState<Mode>("vault");
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

  return (
    <>
      <ConnectorBanner status={connector.status} onDismiss={connector.dismiss} />
      <Suspense fallback={<div className="app-loading" aria-label="Loading" />}>
        {mode === "vault" ? (
          <VaultView vault={vault} onOpenChat={() => setMode("chat")} onSignOut={auth.logout} />
        ) : (
          <ChatView
            messages={chat.messages}
            streaming={chat.streaming}
            onSend={(text) => void chat.send(text)}
            onStop={chat.stop}
            onSignOut={auth.logout}
            onOpenVault={() => setMode("vault")}
            connectors={connStatus.connectors}
            onConnect={(url) => window.location.assign(url)}
          />
        )}
      </Suspense>
    </>
  );
}
