import { describe, expect, it } from "vitest";

import { timeAgo } from "../vault/format";

describe("timeAgo", () => {
  const now = Date.parse("2026-08-14T12:00:00Z");
  it("formats recent and older times", () => {
    expect(timeAgo("2026-08-14T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-08-14T11:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-08-14T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-08-12T12:00:00Z", now)).toBe("2d ago");
  });
  it("handles empty/invalid input", () => {
    expect(timeAgo(null, now)).toBe("");
    expect(timeAgo("not-a-date", now)).toBe("");
  });
});
