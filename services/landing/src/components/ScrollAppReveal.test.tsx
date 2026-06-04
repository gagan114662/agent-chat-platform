import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollAppReveal } from "./ScrollAppReveal.js";

describe("ScrollAppReveal", () => {
  it("renders the #product-dev channel and the decisions-captured stat", () => {
    render(<ScrollAppReveal />);
    expect(screen.getAllByText(/product-dev/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/247 decisions captured/i)).toBeInTheDocument();
  });

  it("renders the scripted human go-ahead reply", () => {
    render(<ScrollAppReveal />);
    expect(screen.getByText(/ship it/i)).toBeInTheDocument();
  });
});
