import { describe, expect, it } from "vitest";

import { codeChallengeFor, generateCodeVerifier } from "../auth/pkce";
import { applyEvent, dedupeCitations, type ChatMessage } from "../chat/messages";

describe("pkce", () => {
  it("generates a URL-safe verifier and a matching S256 challenge", async () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    const challenge = await codeChallengeFor(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    // Deterministic for a given verifier.
    expect(await codeChallengeFor(verifier)).toBe(challenge);
    // Known vector: SHA-256 of "abc" base64url.
    expect(await codeChallengeFor("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});

describe("message reducer", () => {
  const base: ChatMessage = {
    id: "a1",
    role: "assistant",
    text: "",
    citations: [],
    toolEvents: [],
    streaming: true,
  };

  it("appends tokens and collects citations, then completes on done", () => {
    let m = applyEvent(base, { type: "token", text: "Hel" });
    m = applyEvent(m, { type: "token", text: "lo" });
    m = applyEvent(m, { type: "citation", source_path: "ops/x.md", score: 0.9 });
    m = applyEvent(m, { type: "done" });
    expect(m.text).toBe("Hello");
    expect(m.citations).toEqual([{ sourcePath: "ops/x.md", score: 0.9 }]);
    expect(m.streaming).toBe(false);
  });

  it("dedupes citations by source path", () => {
    const deduped = dedupeCitations([
      { sourcePath: "a.md" },
      { sourcePath: "a.md" },
      { sourcePath: "b.md" },
    ]);
    expect(deduped.map((c) => c.sourcePath)).toEqual(["a.md", "b.md"]);
  });
});
