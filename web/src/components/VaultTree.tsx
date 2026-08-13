import { useState } from "react";

import type { TreeNode } from "../vault/types";

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function TreeItem({
  node,
  activeKey,
  onOpen,
  depth,
}: {
  node: TreeNode;
  activeKey: string | null;
  onOpen: (key: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: 10 + depth * 14 };

  if (node.type === "file") {
    return (
      <button
        type="button"
        className={`vault-file${activeKey === node.path ? " active" : ""}`}
        style={pad}
        onClick={() => onOpen(node.path)}
        title={node.path}
      >
        {stripExt(node.name)}
      </button>
    );
  }

  return (
    <div className="vault-dir">
      <button type="button" className="vault-dir-toggle" style={pad} onClick={() => setOpen((v) => !v)}>
        <span className={`vault-caret${open ? " open" : ""}`} aria-hidden="true">
          ▸
        </span>
        {node.name}
      </button>
      {open &&
        node.children?.map((child) => (
          <TreeItem key={child.path} node={child} activeKey={activeKey} onOpen={onOpen} depth={depth + 1} />
        ))}
    </div>
  );
}

export function VaultTree({
  tree,
  activeKey,
  onOpen,
}: {
  tree: TreeNode[];
  activeKey: string | null;
  onOpen: (key: string) => void;
}) {
  if (tree.length === 0) return <p className="vault-empty-tree">No notes yet. Create one to begin.</p>;
  return (
    <div className="vault-tree">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} activeKey={activeKey} onOpen={onOpen} depth={0} />
      ))}
    </div>
  );
}
