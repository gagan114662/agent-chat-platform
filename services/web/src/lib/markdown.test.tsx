import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("renders an # Heading as a heading element", () => {
    render(<div>{renderMarkdown("# Heading")}</div>);
    const h = screen.getByText("Heading");
    expect(h.tagName).toBe("H1");
  });

  it("renders inline `code` in a code element", () => {
    render(<div>{renderMarkdown("here is `code` inline")}</div>);
    const code = screen.getByText("code");
    expect(code.tagName).toBe("CODE");
  });

  it("renders a https:// link as an anchor with href", () => {
    render(<div>{renderMarkdown("see [example](https://e.com)")}</div>);
    const a = screen.getByText("example");
    expect(a.tagName).toBe("A");
    expect(a).toHaveAttribute("href", "https://e.com");
  });

  it("renders a javascript: link as TEXT with no href (XSS-safe)", () => {
    render(<div>{renderMarkdown("danger [x](javascript:alert(1))")}</div>);
    // The link text must appear...
    expect(screen.getByText(/x/)).toBeInTheDocument();
    // ...but never as an anchor with a javascript: href.
    const anchors = document.querySelectorAll("a");
    anchors.forEach((a) => expect(a.getAttribute("href") ?? "").not.toMatch(/javascript:/i));
    // No href at all should be emitted for the unsafe link.
    expect(document.querySelector('a[href]')).toBeNull();
  });

  it("renders a fenced code block in a pre", () => {
    render(<div>{renderMarkdown("```\nconst x = 1;\n```")}</div>);
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("const x = 1;");
  });
});
