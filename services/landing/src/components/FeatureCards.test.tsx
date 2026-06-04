import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureCards } from "./FeatureCards.js";
import { AgentPoolsPanel, ContextGraphPanel } from "./FeaturePanels.js";

describe("FeatureCards", () => {
  it("renders all four numbered feature titles", () => {
    render(<FeatureCards />);
    expect(screen.getByText(/one channel/i)).toBeInTheDocument();
    expect(screen.getByText(/even when you're not/i)).toBeInTheDocument();
    expect(screen.getByText(/only pulled in when it matters/i)).toBeInTheDocument();
    expect(screen.getByText(/captured automatically/i)).toBeInTheDocument();
  });

  it("shows the first panel (tasks board with a T- id) by default", () => {
    render(<FeatureCards />);
    expect(screen.getByText(/T-12/)).toBeInTheDocument();
  });
});

describe("FeaturePanels", () => {
  it("agent pools panel shows the + ADD action and a T- task id", () => {
    render(<AgentPoolsPanel />);
    expect(screen.getByText(/\+ ADD/)).toBeInTheDocument();
    expect(screen.getByText(/T-21/)).toBeInTheDocument();
  });

  it("context graph panel shows memories and edges count", () => {
    render(<ContextGraphPanel />);
    expect(screen.getByText(/258 memories · 463 edges/i)).toBeInTheDocument();
    expect(screen.getByText(/memories/i)).toBeInTheDocument();
  });
});
