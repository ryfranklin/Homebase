// Live Confluence search for the Flight Planner: find design pages to select as plan
// sources. Hits the BFF (which invokes the confluence connector shim with the
// tenant's vaulted Atlassian token).

import type { VaultDoc } from "./corpus";
import { slugify } from "./persist";

export interface ConfluencePage {
  id: string | null;
  title: string | null;
  url: string | null;
  excerpt: string;
}

export async function searchConfluence(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  query: string,
): Promise<ConfluencePage[]> {
  const token = await getToken();
  const res = await fetch(`${apiBaseUrl}/api/plan/confluence/search?q=${encodeURIComponent(query)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Confluence search is unavailable");
  const body = await res.json();
  return (body.results ?? []) as ConfluencePage[];
}

// A selected Confluence page becomes a plan source doc (origin confluence, linked
// out; the excerpt is snapshotted). A fuller snapshot of the page body is a later step.
export function confluenceToVaultDoc(page: ConfluencePage): VaultDoc {
  const title = page.title || "Confluence page";
  return {
    slug: `cf-${page.id ?? slugify(title)}`,
    title,
    path: "",
    kind: "design",
    origin: "confluence",
    excerpt: page.excerpt || "Confluence design page.",
    externalUrl: page.url ?? undefined,
  };
}
