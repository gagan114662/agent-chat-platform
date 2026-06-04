import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntroLoader } from "./IntroLoader.js";
import { FundingBanner } from "./FundingBanner.js";
import { Dock } from "./Dock.js";

describe("IntroLoader", () => {
  it("renders the brand wordmark", () => {
    render(<IntroLoader duration={100000} />);
    expect(screen.getByText("Convene")).toBeInTheDocument();
  });
});

describe("FundingBanner", () => {
  it("renders the announcement and hides on dismiss", () => {
    render(<FundingBanner />);
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    expect(screen.getByText(/early-access teams/i)).toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(screen.queryByText(/early-access teams/i)).not.toBeInTheDocument();
  });
});

describe("Dock", () => {
  it("renders the persistent navigation with a download tile", () => {
    render(<Dock />);
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
  });
});
