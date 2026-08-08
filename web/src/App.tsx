import { useMemo } from "react";

import { useAuth } from "./auth/useAuth";
import { ChatView } from "./components/ChatView";
import { LoginScreen } from "./components/LoginScreen";
import { loadConfig } from "./config";
import { useChat } from "./chat/useChat";
import { ConnectorBanner } from "./connectors/ConnectorBanner";
import { useConnectorCallback } from "./connectors/useConnectorCallback";

export function App() {
  const config = useMemo(() => loadConfig(), []);
  const auth = useAuth(config);
  const chat = useChat(config.apiBaseUrl, auth.getAccessToken);
  // Finalize a connector consent if the browser returned with ?session_id=.
  const connector = useConnectorCallback(config.apiBaseUrl, auth.getAccessToken, auth.authenticated);

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
      <ChatView
        messages={chat.messages}
        streaming={chat.streaming}
        onSend={(text) => void chat.send(text)}
        onStop={chat.stop}
        onSignOut={auth.logout}
      />
    </>
  );
}
