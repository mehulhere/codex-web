import React, { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeSnippet } from "./CodeSnippet";
import { ImageLightbox } from "./ImageLightbox";

interface MarkdownTextProps {
  text: string;
  threadId?: string | undefined;
  itemId?: string | undefined;
}

function detectLanguage(className: string | undefined): string {
  if (!className) return "text";
  const prefix = "language-";
  if (!className.startsWith(prefix)) return "text";
  const name = className.slice(prefix.length).trim();
  return name.length > 0 ? name : "text";
}

const baseComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="markdown-table" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  code: ({ className, children }) => {
    const code = String(children ?? "");
    const isBlock = code.includes("\n") || (className?.startsWith("language-") ?? false);

    if (!isBlock) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
          {code}
        </code>
      );
    }

    return (
      <CodeSnippet
        code={code.replace(/\n$/, "")}
        language={detectLanguage(className)}
      />
    );
  }
};

const inlineVisualizationPattern =
  /^::codex-inline-vis\{file=(?:"([^"]+)"|([^}\s]+))\}$/u;

function readInlineVisualizationFilename(children: React.ReactNode): string | null {
  const value = React.Children.toArray(children)
    .filter((child): child is string => typeof child === "string")
    .join("")
    .trim();
  const match = inlineVisualizationPattern.exec(value);
  return match?.[1] ?? match?.[2] ?? null;
}

function InlineVisualization({
  filename,
  threadId
}: {
  filename: string;
  threadId: string;
}): React.JSX.Element {
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState(false);
  const src = `/api/threads/${encodeURIComponent(threadId)}/visualization-previews/${encodeURIComponent(filename)}`;

  if (unavailable) {
    return (
      <div className="my-4 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Visualization unavailable
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="my-4 block w-full overflow-hidden rounded-xl border border-border bg-black/20"
        onClick={() => setSelected(true)}
      >
        <img
          title={filename}
          src={src}
          alt={`Visualization: ${filename}`}
          loading="lazy"
          className="block h-auto w-full object-contain object-top"
          onError={() => setUnavailable(true)}
        />
      </button>
      {selected && <ImageLightbox src={src} onClose={() => setSelected(false)} />}
    </>
  );
}

function MarkdownImage({
  src,
  alt
}: {
  src: string;
  alt?: string | undefined;
}): React.JSX.Element {
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState(false);

  if (unavailable) {
    return (
      <span className="mx-1 inline-flex rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Image unavailable
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="mx-1 inline-flex max-w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-black/20 align-middle"
        onClick={() => setSelected(true)}
      >
        <img
          src={src}
          alt={alt || "Markdown image"}
          className="max-h-56 h-auto w-auto max-w-full object-contain"
          loading="lazy"
          onError={() => setUnavailable(true)}
        />
      </button>
      {selected && <ImageLightbox src={src} onClose={() => setSelected(false)} />}
    </>
  );
}

export const MarkdownText = React.memo(function MarkdownText({
  text,
  threadId,
  itemId
}: MarkdownTextProps) {
  let markdownImageIndex = 0;
  const components: Components = {
    ...baseComponents,
    p: ({ children }) => {
      const filename = readInlineVisualizationFilename(children);
      if (filename && threadId) {
        return <InlineVisualization filename={filename} threadId={threadId} />;
      }
      return <p>{children}</p>;
    },
    img: ({ alt, src }) => {
      const imageIndex = markdownImageIndex++;
      if (!threadId || !itemId || !src) {
        return <img src={src} alt={alt} />;
      }
      return (
        <MarkdownImage
          src={`/api/threads/${encodeURIComponent(threadId)}/media/${encodeURIComponent(itemId)}/${String(imageIndex)}`}
          alt={alt}
        />
      );
    }
  };

  return (
    <div className="markdown-content text-sm leading-relaxed text-foreground break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
