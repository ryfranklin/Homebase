import { useMemo } from "react";

import { useAuth } from "./auth/useAuth";
import { ChatView } from "./components/ChatView";
import { LoginScreen } from "./components/LoginScreen";
import { loadConfig } from "./config";
import { useChat } from "./chat/useChat";

export function App() {
  const config = useMemo(() => loadConfig(), []);
  const auth = useAuth(config);
  const chat = useChat(config.apiBaseUrl, auth.getAccessToken);

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
    <ChatView
      messages={chat.messages}
      streaming={chat.streaming}
      onSend={(text) => void chat.send(text)}
      onStop={chat.stop}
      onSignOut={auth.logout}
    />
  );
}
