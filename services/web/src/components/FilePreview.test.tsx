import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilePreview } from "./FilePreview.js";

describe("FilePreview", () => {
  it("renders markdown (.md) as React nodes (heading), not raw HTML", () => {
    render(<FilePreview filename="README.md" content="# Title" encoding="utf8" />);
    const h = screen.getByText("Title");
    expect(h.tagName).toBe("H1");
  });

  it("renders .html in a sandboxed iframe (no script execution path)", () => {
    const html = "<p>hi</p><script>window.__pwned = true</script>";
    render(<FilePreview filename="page.html" content={html} encoding="utf8" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Empty sandbox blocks scripts/forms/navigation.
    expect(iframe).toHaveAttribute("sandbox", "");
    // Content rides in srcdoc, NOT via innerHTML on the host document.
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>hi</p>");
    // No dangerouslySetInnerHTML leakage into the host DOM.
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("renders an image (.png base64) as a data-URI <img>", () => {
    render(<FilePreview filename="logo.png" content="QUJD" encoding="base64" />);
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,QUJD");
  });

  it("renders code/text (.ts) in a <pre> with the raw (escaped) content", () => {
    const code = "const x = '<not html>';";
    render(<FilePreview filename="a.ts" content={code} encoding="utf8" />);
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(code);
    // The angle brackets are text, not parsed elements.
    expect(pre?.querySelector("not")).toBeNull();
  });

  it("shows an empty state for empty content", () => {
    render(<FilePreview filename="a.ts" content="" encoding="utf8" />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });
});
