// A PlanStore backed by the git vault: flight plans live as notes under plans/ and
// are read/written through the same authenticated vault API as the rest of the
// workspace, so every save is a git commit (versioned + attributed) and the board
// survives reloads. The dev preview passes no store and stays in-memory.

import { makeVaultApi } from "../vault/api";
import type { TreeNode } from "../vault/types";
import type { ChatMessage, FlightPlan } from "./types";
import { chatFromMarkdown, chatToMarkdown, planChatKey, planFromMarkdown, planKey, planToMarkdown } from "./persist";

export interface PlanStore {
  list(): Promise<FlightPlan[]>;
  save(plan: FlightPlan): Promise<void>;
  remove(plan: FlightPlan): Promise<void>;
  // The copilot transcript for a plan (async-shared: persisted to the vault so the
  // whole team can read and resume it). Empty array when the plan has no chat yet.
  loadChat(plan: Pick<FlightPlan, "id" | "title">): Promise<ChatMessage[]>;
  saveChat(plan: Pick<FlightPlan, "id" | "title">, messages: ChatMessage[]): Promise<void>;
}

// Markdown note keys under plans/, flattened from the vault tree.
function planKeys(tree: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === "file" && n.path.startsWith("plans/") && n.path.endsWith(".md")) out.push(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function makeVaultPlanStore(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  getIdToken?: () => Promise<string>,
): PlanStore {
  const api = makeVaultApi(apiBaseUrl, getToken, getIdToken);
  return {
    async list() {
      const { tree } = await api.tree();
      const notes = await Promise.all(planKeys(tree).map((k) => api.get(k).catch(() => null)));
      return notes
        .map((n) => (n ? planFromMarkdown(n.content) : null))
        .filter((p): p is FlightPlan => Boolean(p))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    },
    async save(plan) {
      await api.put(planKey(plan), planToMarkdown(plan));
    },
    async remove(plan) {
      await api.remove(planKey(plan));
      // Best-effort: drop the transcript too, but never let its absence fail the delete.
      await api.remove(planChatKey(plan)).catch(() => {});
    },
    async loadChat(plan) {
      const note = await api.get(planChatKey(plan)).catch(() => null);
      return note ? chatFromMarkdown(note.content) : [];
    },
    async saveChat(plan, messages) {
      await api.put(planChatKey(plan), chatToMarkdown(plan, messages));
    },
  };
}
