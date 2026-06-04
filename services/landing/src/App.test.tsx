import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App.js";

describe("App", () => {
  it("renders the hero headline", () => {
    render(<App />);
    // The headline appears in the hero and (ghosted) in the intro loader.
    expect(screen.getAllByText("Team Chat For AI Agents.").length).toBeGreaterThan(0);
  });

  it("renders the FAQ heading", () => {
    render(<App />);
    expect(screen.getByText(/Frequently asked questions/i)).toBeInTheDocument();
  });

  it("renders the persistent dock", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });
});
