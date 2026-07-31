export interface LoginScreenProps {
  onLogin: () => void;
  onGoogleLogin: () => void;
  error?: string;
}

export function LoginScreen({ onLogin, onGoogleLogin, error }: LoginScreenProps) {
  return (
    <div className="login">
      <div className="login-card">
        <h1 className="login-title">Homebase</h1>
        <p className="login-subtitle">Your private knowledge assistant.</p>
        {error && <p className="message-error">{error}</p>}
        <button type="button" className="login-button primary" onClick={onGoogleLogin}>
          Continue with Google
        </button>
        <button type="button" className="login-button" onClick={onLogin}>
          Sign in
        </button>
      </div>
    </div>
  );
}
