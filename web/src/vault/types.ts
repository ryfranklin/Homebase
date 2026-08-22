// Shapes returned by the BFF /api/vault/* routes.

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  title?: string;
  children?: TreeNode[];
}

export interface Note {
  key: string;
  content: string;
  title: string;
  frontMatter: Record<string, string>;
  links: string[];
  updatedBy: string | null;
  updatedById: string | null;
  updatedAt: string | null;
}

export interface NoteVersion {
  versionId: string;
  updatedAt: string | null;
  updatedBy: string | null;
  size: number | null;
  isCurrent: boolean;
}

export interface SearchResult {
  key: string;
  title: string;
  snippet: string;
  score: number;
}

export interface Backlink {
  key: string;
  title: string;
}

// A note skeleton under templates/. Light metadata for the New-document picker;
// the body is fetched with get(path) when a template is chosen.
export interface TemplateMeta {
  path: string;
  name: string;
  label: string;
  title: string;
  tags: string[];
  type: string | null;
}
