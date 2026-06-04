import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView.js";
import type { ChangedFile } from "../types.js";

const file: ChangedFile = {
  filename: "src/a.ts",
  additions: 2,
  deletions: 1,
  status: "modified",
  patch: "@@ -1,2 +1,3 @@\n context\n-removed line\n+added line\n+added line2",
};

describe("DiffView", () => {
  it("renders the filename and the added/removed lines from the patch", () => {
    render(<DiffView files={[file]} />);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+added line")).toBeInTheDocument();
    expect(screen.getByText("-removed line")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    render(<DiffView files={[]} loading />);
    expect(screen.getByText(/loading diff/i)).toBeInTheDocument();
  });

  it("shows a no-preview message when patch is missing", () => {
    render(<DiffView files={[{ filename: "img.png", additions: 0, deletions: 0, status: "added" }]} />);
    expect(screen.getByText(/no preview/i)).toBeInTheDocument();
  });
});
