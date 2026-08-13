import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Render assistant text as Markdown. react-markdown does NOT render raw HTML by
// default, so model output can't inject markup — safe to show. GFM adds tables,
// task lists, strikethrough, and autolinks. Links open in a new tab.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
