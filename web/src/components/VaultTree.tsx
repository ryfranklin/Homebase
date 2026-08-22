import { useState } from "react";

import type { TreeNode } from "../vault/types";

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

// A small trash button revealed on row hover. Stops propagation so deleting never
// also opens the note or toggles the folder.
function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      className="vault-del"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}

function TreeItem({
  node,
  activeKey,
  onOpen,
  onDeleteFile,
  onDeleteDir,
  depth,
}: {
  node: TreeNode;
  activeKey: string | null;
  onOpen: (key: string) => void;
  onDeleteFile?: (key: string) => void;
  onDeleteDir?: (prefix: string) => void;
  depth: number;
}) {
  // Start every directory collapsed: the tree renders as just the top-level folders,
  // expanded on click. Avoids dumping the whole vault open on load.
  const [open, setOpen] = useState(false);
  const pad = { paddingLeft: 10 + depth * 14 };

  if (node.type === "file") {
    return (
      <div className="vault-row">
        <button
          type="button"
          className={`vault-file${activeKey === node.path ? " active" : ""}`}
          style={pad}
          onClick={() => onOpen(node.path)}
          title={node.path}
        >
          {stripExt(node.name)}
        </button>
        {onDeleteFile && <DeleteButton label={`Delete ${stripExt(node.name)}`} onDelete={() => onDeleteFile(node.path)} />}
      </div>
    );
  }

  return (
    <div className="vault-dir">
      <div className="vault-row">
        <button type="button" className="vault-dir-toggle" style={pad} onClick={() => setOpen((v) => !v)}>
          <span className={`vault-caret${open ? " open" : ""}`} aria-hidden="true">
            ▸
          </span>
          {node.name}
        </button>
        {onDeleteDir && <DeleteButton label={`Delete folder ${node.name} and its notes`} onDelete={() => onDeleteDir(node.path)} />}
      </div>
      {open &&
        node.children?.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            activeKey={activeKey}
            onOpen={onOpen}
            onDeleteFile={onDeleteFile}
            onDeleteDir={onDeleteDir}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export function VaultTree({
  tree,
  activeKey,
  onOpen,
  onDeleteFile,
  onDeleteDir,
}: {
  tree: TreeNode[];
  activeKey: string | null;
  onOpen: (key: string) => void;
  onDeleteFile?: (key: string) => void;
  onDeleteDir?: (prefix: string) => void;
}) {
  if (tree.length === 0) return <p className="vault-empty-tree">No notes yet. Create one to begin.</p>;
  return (
    <div className="vault-tree">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          activeKey={activeKey}
          onOpen={onOpen}
          onDeleteFile={onDeleteFile}
          onDeleteDir={onDeleteDir}
          depth={0}
        />
      ))}
    </div>
  );
}
