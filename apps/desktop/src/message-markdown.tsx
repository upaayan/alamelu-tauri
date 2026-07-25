import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIcon } from "./icons";

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

export function MessageMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="message__content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
