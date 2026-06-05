import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ToolView } from "./ToolView.js";

describe("ToolView", () => {
  it("renders the tool content in a sandbox=\"\" iframe via srcDoc", () => {
    render(<ToolView name="Dash" content="<p>hi</p>" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Empty sandbox blocks scripts/forms/navigation.
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe).toHaveAttribute("title", "Dash");
    // Content rides in srcdoc, NOT via innerHTML on the host document.
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>hi</p>");
  });

  it("does not execute scripts in the host document (no dangerouslySetInnerHTML)", () => {
    const html = "<p>hi</p><script>window.__pwned = true</script>";
    render(<ToolView name="Evil" content={html} />);
    // No script leaked into the host DOM.
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The raw content is only present inside the iframe's srcdoc attribute.
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("srcdoc")).toContain("<script>");
  });
});
