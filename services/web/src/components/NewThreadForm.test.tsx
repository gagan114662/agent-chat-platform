import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewThreadForm } from "./NewThreadForm.js";

describe("NewThreadForm", () => {
  it("creates with title + selected repo and clears", () => {
    const onCreate = vi.fn();
    render(<NewThreadForm repos={[{ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "o", githubName: "r", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" }]} onCreate={onCreate} />);
    fireEvent.change(screen.getByPlaceholderText(/new thread title/i), { target: { value: "fix login" } });
    fireEvent.change(screen.getByLabelText("repo"), { target: { value: "r1" } });
    fireEvent.click(screen.getByRole("button", { name: /create thread/i }));
    expect(onCreate).toHaveBeenCalledWith("fix login", "r1");
  });
  it("ignores empty title", () => {
    const onCreate = vi.fn();
    render(<NewThreadForm repos={[]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /create thread/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
