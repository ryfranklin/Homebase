import { describe, expect, it } from "vitest";

import { parseModels } from "../config";

describe("parseModels", () => {
  it("returns an empty list when unset (selector hidden)", () => {
    expect(parseModels(undefined)).toEqual([]);
    expect(parseModels("")).toEqual([]);
  });

  it("parses id|Label pairs and trims whitespace", () => {
    expect(parseModels("model-a|Opus 4.8, model-b|Sonnet 4.6")).toEqual([
      { id: "model-a", label: "Opus 4.8" },
      { id: "model-b", label: "Sonnet 4.6" },
    ]);
  });

  it("defaults the label to the id when no label is given", () => {
    expect(parseModels("model-a")).toEqual([{ id: "model-a", label: "model-a" }]);
  });

  it("skips malformed entries without an id", () => {
    expect(parseModels("|Label,model-b|B")).toEqual([{ id: "model-b", label: "B" }]);
  });
});
