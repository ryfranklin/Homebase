// Client for finalizing a connector's 3LO consent.
//
// After the user consents to a connector in the browser, AgentCore redirects back
// to the SPA with ?session_id=<sessionUri>. We POST that to the BFF, which calls
// CompleteResourceTokenAuth to promote the OAuth token into the durable vault. The
// bearer token is required (the BFF scopes the finalize to the caller's tenant).

export async function completeConnectorAuth(
  apiBaseUrl: string,
  accessToken: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${apiBaseUrl}/api/connectors/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    throw new Error(`connector finalize failed: ${res.status}`);
  }
}
