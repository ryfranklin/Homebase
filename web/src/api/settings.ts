// Client for the BFF's write-only settings endpoints. The GitHub token is sent once
// and never read back (there is no GET); the field is a fresh password input each time.

export async function setGithubToken(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${apiBaseUrl}/api/settings/github-token`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await getToken()}` },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    let message = `save failed: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
}
