// Copy the canonical, self-contained architecture.html (repo root) into the SPA's
// public/ dir so it ships as a served asset the Docs tab can embed. Keeping the
// original at the repo root as the single source of truth; the copy is git-ignored.
// Runs automatically via the predev / prebuild npm hooks.

import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve(process.cwd(), "..", "architecture.html");
const publicDir = resolve(process.cwd(), "public");
const dest = resolve(publicDir, "architecture.html");

mkdirSync(publicDir, { recursive: true });
copyFileSync(src, dest);
console.log("copy-docs: architecture.html -> web/public/architecture.html");
