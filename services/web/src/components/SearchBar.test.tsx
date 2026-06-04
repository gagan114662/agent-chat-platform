import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchBar } from "./SearchBar.js";
import type { SearchResult } from "../types.js";

const result: SearchResult = { messageId: "m1", threadId: "t9", threadTitle: "Login bug", body: "fix the login flow", kind: "chat", createdAt: new Date(0).toISOString() };

describe("SearchBar", () => {
  it("runs a search on Enter and selects a result's thread", async () => {
    const onSearch = vi.fn(async () => [result]);
    const onSelect = vi.fn();
    render(<SearchBar onSearch={onSearch} onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText(/search messages/i), { target: { value: "login" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/search messages/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Login bug")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Login bug"));
    expect(onSelect).toHaveBeenCalledWith("t9");
  });
});
