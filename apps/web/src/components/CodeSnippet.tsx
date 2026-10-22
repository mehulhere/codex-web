import { memo } from "react";
import type {} from "react-syntax-highlighter";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import { useTheme } from "@/hooks/useTheme";

interface CodeSnippetProps {
  code: string;
  language: string;
  wrapLongLines?: boolean;
  className?: string;
}

export const CodeSnippet = memo(function CodeSnippet({ code, language, wrapLongLines = true, className }: CodeSnippetProps) {
  const { theme } = useTheme();
  if (code.length > 20_000 || ["text", "plaintext", "plain", "txt"].includes(language.toLowerCase())) {
    return (
      <div className={`code-snippet ${className ?? ""}`}>
        <pre className={`m-0 rounded-lg bg-muted p-3 text-xs leading-[1.4] ${wrapLongLines ? "whitespace-pre-wrap break-words" : "overflow-x-auto"}`}>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={`code-snippet ${className ?? ""}`}>
      <SyntaxHighlighter
        language={language}
        style={theme === "dark" ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          borderRadius: "0.5rem",
          fontSize: "0.75rem",
          lineHeight: "1.4"
        }}
        wrapLongLines={wrapLongLines}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});
