import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BlackInterstitial } from "./BlackInterstitial.js";
import { FAQ } from "./FAQ.js";
import { Contact } from "./Contact.js";
import { Footer } from "./Footer.js";

describe("BlackInterstitial", () => {
  it("renders both headline lines", () => {
    render(<BlackInterstitial />);
    expect(screen.getByText(/One workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Always working/i)).toBeInTheDocument();
  });
});

describe("FAQ", () => {
  it("opens the heading and first answer; toggles a collapsed question open", () => {
    render(<FAQ />);
    expect(screen.getByText(/Frequently asked questions/i)).toBeInTheDocument();
    // A later question's answer is not present until clicked.
    const q = screen.getByRole("button", { name: /is it like slack/i });
    expect(screen.queryByText(/first-class members/i)).not.toBeInTheDocument();
    fireEvent.click(q);
    expect(screen.getByText(/first-class members/i)).toBeInTheDocument();
  });
});

describe("Contact", () => {
  it("renders the form and submit button", () => {
    render(<Contact />);
    expect(screen.getByText(/Got a team of agents/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
  });
});

describe("Footer", () => {
  it("renders link columns and copyright", () => {
    render(<Footer />);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText(/© 2026/)).toBeInTheDocument();
  });
});
