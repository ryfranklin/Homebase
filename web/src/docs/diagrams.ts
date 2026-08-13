// Parse docs/diagrams.md (served at /diagrams.md) into renderable diagrams, and
// render Mermaid lazily with a theme that matches the app (near-black, monochrome,
// hairline borders). Mermaid is dynamically imported so it is a separate chunk,
// loaded only when the Docs → Diagrams tab is opened.

export interface Diagram {
  id: string;
  title: string;
  description: string;
  code: string;
}

// Each `## Heading` section that contains a ```mermaid fence becomes one diagram;
// the prose between the heading and the fence is its description.
export function parseDiagrams(md: string): Diagram[] {
  const lines = md.split("\n");
  const out: Diagram[] = [];
  let title = "";
  let desc: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let n = 0;

  for (const line of lines) {
    if (!inCode && line.startsWith("## ")) {
      title = line.slice(3).trim();
      desc = [];
      code = [];
      continue;
    }
    if (!inCode && line.trim().startsWith("```mermaid")) {
      inCode = true;
      code = [];
      continue;
    }
    if (inCode && line.trim() === "```") {
      inCode = false;
      if (title && code.length) {
        out.push({ id: `mmd-${n++}`, title, description: desc.join(" ").trim(), code: code.join("\n") });
      }
      continue;
    }
    if (inCode) {
      code.push(line);
    } else if (title && line.trim()) {
      desc.push(line.trim());
    }
  }
  return out;
}

let initialized = false;

async function loadMermaid() {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      themeVariables: {
        darkMode: true,
        background: "#0a0a0a",
        primaryColor: "#161618",
        primaryTextColor: "#f4f4f5",
        primaryBorderColor: "rgba(255,255,255,0.22)",
        secondaryColor: "#1b1b1f",
        tertiaryColor: "#121214",
        lineColor: "#8a8a8e",
        textColor: "#d4d4d8",
        mainBkg: "#161618",
        nodeBorder: "rgba(255,255,255,0.22)",
        clusterBkg: "rgba(255,255,255,0.02)",
        clusterBorder: "rgba(255,255,255,0.12)",
        edgeLabelBackground: "#0a0a0a",
        titleColor: "#f4f4f5",
        // sequence
        actorBkg: "#161618",
        actorBorder: "rgba(255,255,255,0.22)",
        actorTextColor: "#f4f4f5",
        actorLineColor: "#6a6a6e",
        signalColor: "#9a9a9e",
        signalTextColor: "#d4d4d8",
        loopTextColor: "#d4d4d8",
        labelBoxBkgColor: "#161618",
        labelBoxBorderColor: "rgba(255,255,255,0.18)",
        labelTextColor: "#f4f4f5",
        noteBkgColor: "#1b1b1f",
        noteBorderColor: "rgba(255,255,255,0.18)",
        noteTextColor: "#d4d4d8",
        // er / class
        attributeBackgroundColorOdd: "#141416",
        attributeBackgroundColorEven: "#1b1b1f",
      },
    });
    initialized = true;
  }
  return mermaid;
}

export async function renderMermaid(id: string, code: string): Promise<string> {
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(`svg-${id}`, code);
  return svg;
}
