// Chat thread memory, stored in the vault. Each thread is a Markdown note under
// chat/<id>.md, so it is git-versioned, browsable in the vault, and KB-indexed
// (the vault worker mirrors git -> S3 -> Knowledge Base on write). Reusing the
// vault dep means no new storage; the agent can later recall past conversations.
//
// Messages are delimited by HTML comment markers (<!-- role:user -->), which are
// invisible in rendered Markdown, so the readable transcript is what the KB
// indexes while parsing back to structured messages stays robust even when an
// answer itself contains "## " headers.

import { httpError, splitFrontMatter } from "./vault.mjs";

const CHAT_PREFIX = "chat/";
const ROLE_MARKER = /<!--\s*role:(user|assistant)\s*-->/g;

// A thread id is the chat session id (web-<uuid>): letters, digits, dot, dash,
// underscore only, so it maps to a safe note key with no traversal.
export function assertThreadId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(id)) {
    throw httpError(400, "invalid_thread_id", "invalid thread id");
  }
  return id;
}

export function threadKey(id) {
  return `${CHAT_PREFIX}${assertThreadId(id)}.md`;
}

function titleFrom(messages, fallback) {
  const firstUser = messages.find((m) => m.role === "user" && m.text?.trim());
  const raw = (firstUser?.text || fallback || "Chat").replace(/\s+/g, " ").trim();
  return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
}

// Serialize a thread to Markdown with front matter + role-delimited messages.
export function serializeThread({ title, scope, created, updated, tenantId, userId, messages }) {
  const fm = [
    "---",
    `title: ${JSON.stringify(title)}`,
    "type: chat",
    `created: ${created}`,
    `updated: ${updated}`,
    `scope: ${scope === "vault" ? "vault" : "general"}`,
    `tenant_id: ${tenantId}`,
    `user_id: ${userId}`,
    "---",
    "",
  ].join("\n");
  const body = messages
    .filter((m) => (m.text ?? "").trim())
    .map((m) => `<!-- role:${m.role === "assistant" ? "assistant" : "user"} -->\n${m.text.trim()}`)
    .join("\n\n");
  return `${fm}\n${body}\n`;
}

// Parse a stored thread note back into { meta, messages }.
export function parseThread(content) {
  const { frontMatter, body } = splitFrontMatter(content || "");
  const messages = [];
  let match;
  ROLE_MARKER.lastIndex = 0;
  const markers = [];
  while ((match = ROLE_MARKER.exec(body))) {
    markers.push({ role: match[1], start: match.index, end: ROLE_MARKER.lastIndex });
  }
  for (let i = 0; i < markers.length; i += 1) {
    const next = markers[i + 1];
    const text = body.slice(markers[i].end, next ? next.start : body.length).trim();
    if (text) messages.push({ role: markers[i].role, text });
  }
  return { meta: frontMatter, messages };
}

export function makeChatThreads({ vault, retentionDays = 30, now = () => Date.now() }) {
  const cutoffIso = () => new Date(now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  async function listKeys() {
    const { tree } = await vault.tree();
    const keys = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.type === "dir") walk(n.children);
        else if (n.path.startsWith(CHAT_PREFIX)) keys.push(n.path);
      }
    };
    walk(tree);
    return keys;
  }

  return {
    // List threads newest-first, pruning any past the retention window as we go
    // (lazy retention: no standing infra, and the KB drops them on delete).
    async list(actor) {
      const keys = await listKeys();
      const cutoff = cutoffIso();
      const summaries = [];
      for (const key of keys) {
        const note = await vault.get(key);
        const { meta } = parseThread(note.content);
        const updated = meta.updated || meta.created || note.updatedAt || "";
        if (updated && updated < cutoff) {
          // Past retention: delete from the vault (and thus the KB).
          try {
            await vault.del(key, actor);
          } catch {
            /* best effort */
          }
          continue;
        }
        summaries.push({
          id: key.slice(CHAT_PREFIX.length).replace(/\.(md|markdown)$/i, ""),
          title: meta.title || note.title,
          scope: meta.scope || "general",
          updated,
        });
      }
      summaries.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
      return { threads: summaries };
    },

    async get(id) {
      const note = await vault.get(threadKey(id));
      const { meta, messages } = parseThread(note.content);
      return { id, title: meta.title || note.title, scope: meta.scope || "general", updated: meta.updated || "", messages };
    },

    async save(id, { title, scope, messages }, actor) {
      if (!Array.isArray(messages)) throw httpError(400, "invalid_messages", "messages must be an array");
      const clean = messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
        .map((m) => ({ role: m.role, text: m.text }));
      if (!clean.length) throw httpError(400, "empty_thread", "a thread needs at least one message");
      const nowIso = new Date(now()).toISOString();
      // Preserve the original created date if the thread already exists.
      let created = nowIso;
      try {
        const existing = await vault.get(threadKey(id));
        const { meta } = parseThread(existing.content);
        if (meta.created) created = meta.created;
      } catch {
        /* new thread */
      }
      const finalTitle = title || titleFrom(clean);
      const content = serializeThread({
        title: finalTitle,
        scope,
        created,
        updated: nowIso,
        tenantId: actor?.tenantId || "homebase",
        userId: actor?.userId || "system",
        messages: clean,
      });
      await vault.put(threadKey(id), content, actor);
      return { ok: true, id, title: finalTitle, updated: nowIso };
    },

    async remove(id, actor) {
      await vault.del(threadKey(id), actor);
      return { ok: true, id };
    },
  };
}
