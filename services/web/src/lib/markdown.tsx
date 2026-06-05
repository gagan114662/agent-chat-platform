import type { ReactNode } from "react";

// A deliberately minimal, SAFE markdown → React renderer.
//
// SECURITY: there is NO `dangerouslySetInnerHTML` here. Every piece of text is
// emitted as a React child, so JSX auto-escapes it. Repo content is
// attacker-influenced, so this is the load-bearing XSS defence (#47 scan).
// Links only get an `href` when the URL starts with `https://`; anything else
// (javascript:, data:, http:, relative, …) renders as plain text.

function isSafeHref(url: string): boolean {
  return url.startsWith("https://");
}

// Parses inline markup (`code`, **bold**, [text](url)) into React nodes.
// Unknown / unsafe markup degrades to plain text — never raw HTML.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let i = 0;
  // Matches the first of: `code`, **bold**, *italic*, ~~strike~~, [text](url), @mention
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)|(\[[^\]]*\]\([^)]*\))|(@[a-zA-Z0-9_-]+)/;
  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key} className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.85em] text-accent">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<span key={key} className="line-through opacity-80">{token.slice(2, -2)}</span>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("@")) {
      // @mention → an accent pill. Skip when it's part of an email (prev char is a
      // word char), e.g. "dave@test.com" — render that as plain text.
      const prev = rest[m.index - 1];
      if (prev && /[\w@.]/.test(prev)) {
        nodes.push(token);
      } else {
        nodes.push(<span key={key} className="rounded bg-accent-soft px-1 py-0.5 text-[0.95em] font-medium text-accent">{token}</span>);
      }
    } else {
      // [text](url)
      const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
      const label = linkMatch?.[1] ?? token;
      const url = linkMatch?.[2] ?? "";
      if (isSafeHref(url)) {
        nodes.push(
          <a key={key} href={url} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        );
      } else {
        // Unsafe / non-https link → render the label as plain text, no href.
        nodes.push(label);
      }
    }
    rest = rest.slice(m.index + token.length);
  }
  return nodes;
}

export function renderMarkdown(src: string): JSX.Element {
  const lines = src.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] | null = null;
  let fence: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (listItems && listItems.length > 0) {
      blocks.push(
        <ul key={`ul-${key++}`} className="my-2 list-disc pl-5">
          {listItems}
        </ul>
      );
    }
    listItems = null;
  };

  for (const line of lines) {
    // Fenced code block toggling.
    if (line.startsWith("```")) {
      if (fence === null) {
        flushList();
        fence = [];
      } else {
        blocks.push(
          <pre key={`pre-${key++}`} className="my-2 overflow-auto rounded-lg bg-elevated p-3 font-mono text-xs text-ink-2">
            {fence.join("\n")}
          </pre>
        );
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      blocks.push(<h3 key={`h-${key++}`} className="mt-3 mb-1 text-sm font-semibold">{renderInline(line.slice(4), `h${key}`)}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={`h-${key++}`} className="mt-3 mb-1 text-base font-semibold">{renderInline(line.slice(3), `h${key}`)}</h2>);
    } else if (line.startsWith("# ")) {
      flushList();
      blocks.push(<h1 key={`h-${key++}`} className="mt-3 mb-1 text-lg font-bold">{renderInline(line.slice(2), `h${key}`)}</h1>);
    } else if (line.startsWith("- ")) {
      if (!listItems) listItems = [];
      listItems.push(<li key={`li-${key++}`}>{renderInline(line.slice(2), `li${key}`)}</li>);
    } else if (line.startsWith("> ")) {
      flushList();
      blocks.push(<blockquote key={`bq-${key++}`} className="my-1 border-l-2 border-line pl-3 text-sm text-ink-2">{renderInline(line.slice(2), `bq${key}`)}</blockquote>);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`p-${key++}`} className="my-1 text-sm">{renderInline(line, `p${key}`)}</p>);
    }
  }
  // Trailing unclosed fence: render whatever we gathered.
  if (fence !== null && fence.length > 0) {
    blocks.push(
      <pre key={`pre-${key++}`} className="my-2 overflow-auto rounded-lg bg-elevated p-3 font-mono text-xs text-ink-2">
        {fence.join("\n")}
      </pre>
    );
  }
  flushList();

  return <div className="markdown-body">{blocks}</div>;
}
