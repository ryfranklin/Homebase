import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

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

// Render text as Markdown. react-markdown does NOT render raw HTML by default, so
// model/note output can't inject markup - safe to show. GFM adds tables, task
// lists, strikethrough, autolinks; rehype-highlight adds syntax highlighting to
// fenced code. External links open in a new tab; when onWikiLink is provided,
// [[wikilinks]] become clickable in-app navigation instead.
export function Markdown({ text, onWikiLink }: { text: string; onWikiLink?: (target: string) => void }) {
  const source = onWikiLink ? preprocessWikilinks(text) : text;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: true }]]}
        components={{
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
