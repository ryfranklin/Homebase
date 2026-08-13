export interface LoginScreenProps {
  onLogin: () => void;
  onGoogleLogin: () => void;
  error?: string;
}

export function LoginScreen({ onLogin, onGoogleLogin, error }: LoginScreenProps) {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true"></div>
        <h1 className="login-title">Homebase</h1>
        <p className="login-subtitle">Your private knowledge assistant.</p>
        {error && <p className="message-error">{error}</p>}
        <div className="login-actions">
          <button type="button" className="login-button primary" onClick={onGoogleLogin}>
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1 2.6-2.1 3.4l3.4 2.6c2-1.85 3.15-4.6 3.15-7.85 0-.75-.07-1.47-.2-2.15H12z" />
              <path fill="#34A853" d="M6.6 14.3l-.77.6-2.7 2.1C4.85 20 8.2 22 12 22c2.7 0 4.96-.9 6.6-2.42l-3.4-2.6c-.9.6-2.05.96-3.2.96-2.5 0-4.6-1.7-5.36-3.98z" />
              <path fill="#FBBC05" d="M3.13 7c-.66 1.3-1.05 2.76-1.05 4.3s.4 3 1.05 4.3l3.47-2.7c-.2-.6-.32-1.24-.32-1.9 0-.66.12-1.3.32-1.9L3.13 7z" />
              <path fill="#4285F4" d="M12 6.02c1.47 0 2.8.5 3.84 1.5l2.87-2.87C16.96 2.98 14.7 2 12 2 8.2 2 4.85 4 3.13 7l3.47 2.7C7.4 7.42 9.5 6.02 12 6.02z" />
            </svg>
            Continue with Google
          </button>
          <button type="button" className="login-button" onClick={onLogin}>
            Sign in with email
          </button>
        </div>
        <p className="login-foot">Private · single-tenant · yours</p>
      </div>
    </div>
  );
}
