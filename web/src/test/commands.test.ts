import { describe, expect, it } from "vitest";

import { parseChatCommand, matchCommands, CHAT_COMMANDS } from "../chat/commands";

describe("parseChatCommand", () => {
  it("passes a plain message through with no options", () => {
    expect(parseChatCommand("what happened in phoenix")).toEqual({ text: "what happened in phoenix", opts: {} });
  });

  it("routes /web to a forced web search in general scope, stripping the command", () => {
    expect(parseChatCommand("/web events in phoenix")).toEqual({
      text: "events in phoenix",
      opts: { scope: "general", forceWeb: true },
    });
  });

  it("routes /vault to the vault scope", () => {
    expect(parseChatCommand("/vault what did we decide")).toEqual({ text: "what did we decide", opts: { scope: "vault" } });
  });

  it("routes /general to general scope", () => {
    expect(parseChatCommand("/general explain quicksort")).toEqual({ text: "explain quicksort", opts: { scope: "general" } });
  });

  it("routes /plan to plan mode", () => {
    expect(parseChatCommand("/plan build a billing app")).toEqual({ text: "build a billing app", opts: { mode: "plan" } });
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    expect(parseChatCommand("  /WEB   hi there ")).toEqual({ text: "hi there", opts: { scope: "general", forceWeb: true } });
  });

  it("treats an unknown command as a normal message", () => {
    expect(parseChatCommand("/etc/hosts is a file")).toEqual({ text: "/etc/hosts is a file", opts: {} });
  });

  it("returns empty text for a bare command (no query yet)", () => {
    expect(parseChatCommand("/web")).toEqual({ text: "", opts: { scope: "general", forceWeb: true } });
  });
});

describe("matchCommands", () => {
  it("returns all commands for a lone slash", () => {
    expect(matchCommands("/").map((c) => c.name)).toEqual(CHAT_COMMANDS.map((c) => c.name));
  });

  it("narrows by the typed prefix", () => {
    expect(matchCommands("/v").map((c) => c.name)).toEqual(["vault"]);
    expect(matchCommands("/w").map((c) => c.name)).toEqual(["web"]);
  });

  it("returns nothing once past the command name (a space) or with no slash", () => {
    expect(matchCommands("/web hi")).toEqual([]);
    expect(matchCommands("hello")).toEqual([]);
  });
});
