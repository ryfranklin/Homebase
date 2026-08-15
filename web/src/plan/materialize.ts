// Materialize a cleared flight plan into Jira (epic + stories) via the BFF, which
// drives the write-gated jira.create_issue on the connector shim.

export interface MaterializeResult {
  project?: string;
  epic?: string;
  stories?: { key: string; title: string }[];
  requires_authorization?: boolean;
  authorization_url?: string | null;
}

export async function materializePlan(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  plan: unknown,
): Promise<MaterializeResult> {
  const token = await getToken();
  const res = await fetch(`${apiBaseUrl}/api/plan/materialize`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = JSON.parse(text).message || message;
    } catch {
      /* non-JSON */
    }
    throw new Error(message);
  }
  return JSON.parse(text) as MaterializeResult;
}
