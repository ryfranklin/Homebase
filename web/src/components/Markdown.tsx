import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { renderMermaid } from "../docs/diagrams";

// Turn Obsidian-style [[target]] / [[target|alias]] into markdown links with a
// wiki: scheme, so the anchor renderer can intercept them for in-app navigation.
function preprocessWikilinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const [target, alias] = inner.split("|");
    const t = target.split("#")[0].trim();
    const label = (alias ?? target).trim();
    return `[${label}](wiki:${encodeURIComponent(t)})`;
  });
}

// A ```mermaid fence rendered as a diagram. Mermaid is dynamically imported by
// renderMermaid, so it stays a separate chunk loaded only when a diagram appears.
// While rendering it shows a placeholder; on a syntax error it falls back to the
// raw source so nothing is lost.
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSvg(null);
    setFailed(false);
    renderMermaid(code)
      .then((out) => live && setSvg(out))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [code]);

  if (failed) {
    return (
      <div className="hb-mermaid hb-mermaid-error">
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (!svg) return <div className="hb-mermaid hb-mermaid-loading">Rendering diagram…</div>;
  // Mermaid runs with securityLevel "strict" (see diagrams.ts), so the SVG is sanitized.
  return <div className="hb-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function nodeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(nodeText).join("");
  return String(children ?? "");
}

// Render text as Markdown. react-markdown does NOT render raw HTML by default, so
// model/note output can't inject markup - safe to show. GFM adds tables, task
// lists, strikethrough, autolinks; rehype-highlight adds syntax highlighting to
// fenced code (mermaid is left as plain text so its raw source reaches the diagram
// renderer). ```mermaid fences render as diagrams. External links open in a new tab;
// when onWikiLink is provided, [[wikilinks]] become in-app navigation.
export function Markdown({ text, onWikiLink }: { text: string; onWikiLink?: (target: string) => void }) {
  const source = onWikiLink ? preprocessWikilinks(text) : text;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: true, plainText: ["mermaid"] }]]}
        components={{
          code: ({ className, children, ...props }) => {
            if (/\blanguage-mermaid\b/.test(className ?? "")) {
              return <MermaidBlock code={nodeText(children).replace(/\n$/, "")} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          a: ({ href, children }) => {
            if (onWikiLink && href && href.startsWith("wiki:")) {
              const target = decodeURIComponent(href.slice("wiki:".length));
              return (
                <a
                  href={`#${href}`}
                  className="wikilink"
                  onClick={(e) => {
                    e.preventDefault();
                    onWikiLink(target);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
