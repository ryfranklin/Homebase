// Derive a plan owner (a Contributor) from the Cognito ID token's profile claims,
// for display only. The authoritative record of who saved a plan is the git commit
// author, stamped by the BFF from the same ID token; this just labels the doc.

import type { Contributor } from "./types";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function planOwnerFromIdToken(idToken: string | undefined): Contributor | undefined {
  if (!idToken) return undefined;
  const claims = decodeJwtPayload(idToken);
  if (!claims) return undefined;
  const name =
    (claims.name as string) ||
    [claims.given_name, claims.family_name].filter(Boolean).join(" ").trim() ||
    (claims.email as string) ||
    (claims.sub as string);
  const id = (claims.sub as string) || "you";
  if (!name) return undefined;
  return { id, name, kind: "human" };
}
