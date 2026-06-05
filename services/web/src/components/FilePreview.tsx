import { renderMarkdown } from "../lib/markdown.js";

interface FilePreviewProps {
  filename: string;
  content: string;
  encoding: "utf8" | "base64";
  loading?: boolean;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function ext(filename: string): string {
  return filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
}

// SECURITY: no `dangerouslySetInnerHTML` anywhere.
// - markdown → React nodes (JSX auto-escapes; links https-only)
// - html → <iframe sandbox="" srcDoc> (empty sandbox blocks scripts/forms/nav)
// - images → data: URI from base64
// - everything else → <pre> with raw text (JSX-escaped)
export function FilePreview({ filename, content, encoding, loading }: FilePreviewProps) {
  if (loading) {
    return <p className="mt-3 text-xs text-ink-3">Loading file…</p>;
  }

  const e = ext(filename);

  // Images: only meaningful when the backend returned base64.
  if (IMAGE_MIME[e] && encoding === "base64") {
    return (
      <div className="mt-3 overflow-auto rounded-lg border border-line bg-surface p-2">
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <img src={`data:${IMAGE_MIME[e]};base64,${content}`} alt={filename} className="max-h-96" />
      </div>
    );
  }

  if (content === "") {
    return <p className="mt-3 text-xs text-ink-3">(empty file)</p>;
  }

  if (e === "md" || e === "markdown") {
    return (
      <div className="mt-3 overflow-auto rounded-lg border border-line bg-surface p-3 text-sm">
        {renderMarkdown(content)}
      </div>
    );
  }

  if (e === "html" || e === "htm") {
    // Empty sandbox = scripts, forms and navigation are all disabled → safe render.
    return (
      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
        <iframe
          title={filename}
          sandbox=""
          srcDoc={content}
          className="h-96 w-full"
        />
      </div>
    );
  }

  // Code / plain text: raw content in a <pre>; JSX auto-escapes it.
  return (
    <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-5">
      {content}
    </pre>
  );
}
