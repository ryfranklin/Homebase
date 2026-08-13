import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// Render assistant text as Markdown. react-markdown does NOT render raw HTML by
// default, so model output can't inject markup — safe to show. GFM adds tables,
// task lists, strikethrough, and autolinks; rehype-highlight adds syntax
// highlighting to fenced code (ignoreMissing so unknown languages don't throw,
// detect so unlabeled blocks are still highlighted). Links open in a new tab.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: true }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
