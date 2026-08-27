import type { SendOptions } from "./useChat";

// Chat slash commands: a leading /token in the chat box routes a single message without
// touching any persistent setting. `/web` forces a web search, `/vault` restricts to the
// knowledge base + connectors, `/general` allows general knowledge, `/plan` starts a
// planning interview. With no command, the default grounded-first behavior applies.

export interface ChatCommand {
  name: string;
  usage: string;
  description: string;
}

// Display order in the discoverability menu.
export const CHAT_COMMANDS: ChatCommand[] = [
  { name: "web", usage: "/web <question>", description: "Search the web for a live answer" },
  { name: "vault", usage: "/vault <question>", description: "Answer only from your vault (knowledge base + connected accounts)" },
  { name: "general", usage: "/general <question>", description: "Allow the model's general knowledge" },
  { name: "plan", usage: "/plan <goal>", description: "Start a planning interview for a goal" },
];

// The per-message SendOptions each command implies.
const COMMAND_OPTS: Record<string, SendOptions> = {
  web: { scope: "general", forceWeb: true },
  vault: { scope: "vault" },
  general: { scope: "general" },
  plan: { mode: "plan" },
};

// Parse a leading slash command. Returns the remaining text plus the SendOptions the
// command implies. An absent or unknown command passes the input through verbatim with
// no options (so "/etc/hosts ..." or a stray slash is just a normal message).
// Case-insensitive and tolerant of extra whitespace.
export function parseChatCommand(input: string): { text: string; opts: SendOptions } {
  const m = /^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!m) return { text: input, opts: {} };
  const opts = COMMAND_OPTS[m[1].toLowerCase()];
  if (!opts) return { text: input, opts: {} };
  return { text: (m[2] ?? "").trim(), opts: { ...opts } };
}

// Commands whose display name starts with the (slash-stripped) prefix the user is typing,
// for the hint menu. Empty prefix returns all commands.
export function matchCommands(input: string): ChatCommand[] {
  const m = /^\/([a-zA-Z]*)$/.exec(input);
  if (!m) return [];
  const prefix = m[1].toLowerCase();
  return CHAT_COMMANDS.filter((c) => c.name.startsWith(prefix));
}
