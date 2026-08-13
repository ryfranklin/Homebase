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
