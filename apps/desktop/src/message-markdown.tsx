import { memo } from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIcon } from "./icons";
import { splitStreamingMarkdown } from "./message-markdown-split";

const REMARK_PLUGINS = [remarkGfm];

function CodeBlock({
  className,
  code,
  language,
}: {
  readonly className: string;
  readonly code: string;
  readonly language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="message__code">
      <button
        aria-label={copied ? "Copied" : "Copy code"}
        className="icon-button message__code-copy"
        type="button"
        onClick={handleCopy}
      >
        <CopyIcon />
      </button>
      <pre data-language={language}>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const language = className?.replace(/^language-/, "");
    const code = String(children).replace(/\n$/, "");
    if (!className) {
      return <code>{code}</code>;
    }
    return <CodeBlock className={className} code={code} {...(language ? { language } : {})} />;
  },
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
} as const;

const MarkdownBody = memo(function MarkdownBody({ text }: { readonly text: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  streaming = false,
}: {
  readonly text: string;
  readonly streaming?: boolean;
}) {
  if (!streaming) {
    return (
      <div className="message__content">
        <MarkdownBody text={text} />
      </div>
    );
  }

  const { stable, tail } = splitStreamingMarkdown(text);
  return (
    <div className="message__content">
      {stable ? <MarkdownBody text={stable} /> : null}
      {tail ? <span className="message__stream-tail">{tail}</span> : null}
    </div>
  );
});
