// Copy the canonical docs (repo root architecture.html + docs/diagrams.md) into
// the SPA's public/ dir so they ship as served assets the Docs tab embeds/renders.
// The originals stay the single source of truth; the copies are git-ignored. Runs
// automatically via the predev / prebuild npm hooks.

import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const publicDir = resolve(process.cwd(), "public");
mkdirSync(publicDir, { recursive: true });

const files = [
  ["..", "architecture.html", "architecture.html"],
  ["..", "docs/diagrams.md", "diagrams.md"],
];

for (const [base, src, dest] of files) {
  copyFileSync(resolve(process.cwd(), base, src), resolve(publicDir, dest));
  console.log(`copy-docs: ${src} -> web/public/${dest}`);
}
