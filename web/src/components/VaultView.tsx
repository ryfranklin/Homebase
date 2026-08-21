import { useEffect, useRef, useState } from "react";

import type { UseVault } from "../vault/useVault";
import type { UseChat } from "../chat/useChat";
import type { UseChatThreads } from "../chat/useChatThreads";
import { newNoteKey } from "../vault/resolve";
import { timeAgo } from "../vault/format";
import { Markdown } from "./Markdown";
import { VaultTree } from "./VaultTree";
import { VaultHistory } from "./VaultHistory";
import { VaultChatPanel, type ChatScope } from "./VaultChatPanel";
import { ModeSwitch, type AppMode } from "./ModeSwitch";
import type { ModelOption } from "../config";
import type { ConnectorStatuses } from "../chat/useConnectorStatus";

export interface VaultViewProps {
  vault: UseVault;
  // Chat is docked in the Vault surface (the merged Vault + Chat experience).
  chat: UseChat;
  threads: UseChatThreads;
  scope: ChatScope;
  onScopeChange: (scope: ChatScope) => void;
  models?: ModelOption[];
  model?: string;
  onModelChange?: (id: string) => void;
  onNavigate: (mode: AppMode) => void;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
  // What's connected + how to start a connector's consent flow, for the chat panel.
  connectors?: ConnectorStatuses;
  onConnect?: (url: string) => void;
}

// The vault workspace: a sidebar (search + file tree), a note reader/editor, and
// a Linked-references panel. Notes live in the S3 corpus; saving re-grounds the
// agent. The visual language matches the near-black chat theme.
export function VaultView({ vault, chat, threads, scope, onScopeChange, models, model, onModelChange, onNavigate, onSignOut, onOpenSettings, connectors, onConnect }: VaultViewProps) {
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Debounced search: empty term clears results.
  useEffect(() => {
    const id = setTimeout(() => void vault.search(term), 180);
    return () => clearTimeout(id);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd/Ctrl+S saves while editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (vault.editing && vault.dirty) {
          e.preventDefault();
          void vault.save();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vault.editing, vault.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitNew = () => {
    const key = newNoteKey(newName);
    if (!key) return;
    setCreating(false);
    setNewName("");
    setTerm("");
    void vault.create(key);
  };

  const onDelete = () => {
    if (!vault.note) return;
    if (window.confirm(`Delete "${vault.note.title}"? This removes it from the vault.`)) {
      void vault.remove(vault.note.key);
    }
  };

  // Delete a single note from the tree (hover trash), confirmed by name.
  const onDeleteFileFromTree = (key: string) => {
    const name = key.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
    if (window.confirm(`Delete "${name}"? This removes it from the vault.`)) {
      void vault.remove(key);
    }
  };

  // Delete a whole folder and every note under it. The confirm names the folder and
  // the exact count, since this removes many notes at once.
  const onDeleteDirFromTree = (prefix: string) => {
    const p = prefix.replace(/\/+$/, "");
    const count = vault.keys.filter((k) => k === p || k.startsWith(p + "/")).length;
    if (window.confirm(`Delete folder "${p}" and its ${count} note${count === 1 ? "" : "s"}? This cannot be undone.`)) {
      void vault.removeDir(p);
    }
  };

  return (
    <div className="vault">
      <header className="chat-header">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Homebase
        </span>
        <div className="header-actions">
          <ModeSwitch active="vault" onNavigate={onNavigate} onOpenSettings={onOpenSettings} />
          <button
            type="button"
            className={chatOpen ? "link-button chat-toggle chat-toggle-on" : "link-button chat-toggle"}
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
            title="Toggle the chat panel"
          >
            Chat
          </button>
          {onSignOut && (
            <button type="button" className="link-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="vault-body">
        <aside className="vault-sidebar">
          <div className="vault-side-top">
            <input
              className="vault-search"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
            />
            <button type="button" className="vault-new" onClick={() => setCreating((v) => !v)} aria-label="New note">
              +
            </button>
          </div>
          {creating && (
            <div className="vault-new-row">
              <input
                autoFocus
                className="vault-new-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="folder/new-note.md"
                aria-label="New note name"
              />
            </div>
          )}
          <div className="vault-count">
            {vault.count} {vault.count === 1 ? "note" : "notes"}
          </div>
          <VaultTree
            tree={vault.tree}
            activeKey={vault.note?.key ?? null}
            onOpen={(k) => void vault.open(k)}
            onDeleteFile={onDeleteFileFromTree}
            onDeleteDir={onDeleteDirFromTree}
          />
        </aside>

        <main className="vault-main">
          {vault.status.kind === "error" && <div className="vault-error">{vault.status.message}</div>}

          {vault.results ? (
            <div className="vault-results">
              <div className="vault-results-head">
                <span>
                  {vault.results.length} result{vault.results.length === 1 ? "" : "s"} for “{term}”
                </span>
                <button type="button" className="link-button" onClick={() => setTerm("")}>
                  Clear
                </button>
              </div>
              {vault.results.map((r) => (
                <button key={r.key} type="button" className="vault-result" onClick={() => void vault.open(r.key)}>
                  <span className="vault-result-title">{r.title}</span>
                  <span className="vault-result-key">{r.key}</span>
                  <span className="vault-result-snippet">{r.snippet}</span>
                </button>
              ))}
            </div>
          ) : vault.note ? (
            <article className="vault-note">
              <div className="vault-note-head">
                <div className="vault-note-titles">
                  <h1>
                    {vault.note.title}
                    {vault.dirty && <span className="vault-dirty" title="Unsaved changes">•</span>}
                  </h1>
                  <span className="vault-note-key">{vault.note.key}</span>
                  {vault.note.updatedBy && (
                    <span className="vault-attr">
                      Edited by {vault.note.updatedBy}
                      {vault.note.updatedAt ? ` · ${timeAgo(vault.note.updatedAt)}` : ""}
                    </span>
                  )}
                </div>
                <div className="vault-note-actions">
                  {vault.editing ? (
                    <>
                      <button
                        type="button"
                        className="vault-btn primary"
                        onClick={() => void vault.save()}
                        disabled={!vault.dirty || vault.status.kind === "saving"}
                      >
                        {vault.status.kind === "saving" ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="vault-btn" onClick={() => vault.setEditing(false)}>
                        Done
                      </button>
                    </>
                  ) : (
                    <button type="button" className="vault-btn" onClick={() => vault.setEditing(true)}>
                      Edit
                    </button>
                  )}
                  <button type="button" className="vault-btn" onClick={() => void vault.loadHistory()}>
                    History
                  </button>
                  <button type="button" className="vault-btn danger" onClick={onDelete}>
                    Delete
                  </button>
                </div>
              </div>

              {vault.editing ? (
                <div className="vault-editor-split">
                  <textarea
                    ref={editorRef}
                    className="vault-editor"
                    value={vault.draft}
                    onChange={(e) => vault.setDraft(e.target.value)}
                    spellCheck={false}
                    aria-label="Note source"
                  />
                  <div className="vault-preview">
                    <Markdown text={vault.draft} onWikiLink={vault.openWikilink} />
                  </div>
                </div>
              ) : (
                <div className="vault-reader">
                  <Markdown text={vault.note.content} onWikiLink={vault.openWikilink} />
                </div>
              )}

              {vault.backlinks.length > 0 && (
                <section className="vault-backlinks" aria-label="Linked references">
                  <h3>Linked references ({vault.backlinks.length})</h3>
                  <ul>
                    {vault.backlinks.map((b) => (
                      <li key={b.key}>
                        <button type="button" onClick={() => void vault.open(b.key)}>
                          {b.title}
                        </button>
                        <span className="vault-backlink-key">{b.key}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>
          ) : (
            <div className="vault-empty">
              <div className="vault-empty-mark" aria-hidden="true"></div>
              <h1>Your vault</h1>
              <p>Pick a note from the sidebar, search, or create a new one. Edits save to the cloud and re-ground the agent.</p>
              <button type="button" className="vault-btn primary" onClick={() => setCreating(true)}>
                New note
              </button>
            </div>
          )}
        </main>

        {chatOpen && (
          <VaultChatPanel
            messages={chat.messages}
            streaming={chat.streaming}
            onSend={(t) => void chat.send(t)}
            onStop={chat.stop}
            scope={scope}
            onScopeChange={onScopeChange}
            models={models}
            model={model}
            onModelChange={onModelChange}
            threads={threads.threads}
            activeId={threads.activeId}
            onSelectThread={(id) => void threads.selectThread(id)}
            onNewThread={threads.newThread}
            onClose={() => setChatOpen(false)}
            connectors={connectors}
            onConnect={onConnect}
          />
        )}
      </div>

      {vault.history && (
        <VaultHistory
          versions={vault.history}
          onRestore={(v) => void vault.restore(v)}
          onClose={vault.clearHistory}
        />
      )}
    </div>
  );
}
