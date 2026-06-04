import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [{ id: "m1", displayName: "You", orgId: "o1" }] })) as unknown as typeof fetch);
});

describe("LoginScreen", () => {
  it("lists members and calls onLogin on click", async () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    await waitFor(() => expect(screen.getByText("You")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /sign in as you/i }));
    expect(onLogin).toHaveBeenCalledWith("m1");
  });
});
