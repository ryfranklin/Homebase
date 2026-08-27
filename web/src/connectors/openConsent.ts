// Open a connector's OAuth consent / re-consent in a centered popup, so the main
// app is NEVER reloaded and the user's on-screen work is not impeded. The popup
// relays its ?session_id= back to the opener and closes (see useConnectorCallback);
// if the browser blocks the popup, fall back to a full-page redirect.
//
// Shared by the vault "Connect" affordance, the app-level reconnect banner, and the
// plan pre-flight modal, so re-auth always happens in a separate window.
export function openConnectorConsent(url: string): void {
  if (!url) return;
  const w = 520;
  const h = 700;
  const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
  const popup = window.open(url, "homebase-connect", `popup,width=${w},height=${h},left=${left},top=${top}`);
  if (popup) popup.focus();
  else window.location.assign(url);
}
