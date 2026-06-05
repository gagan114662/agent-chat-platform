import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TasksPanel } from "./TasksPanel.js";
import type { TaskDetail, Task, TaskComment } from "../api.js";

const detail: TaskDetail = {
  task: { id: "tk1", orgId: "acme", threadId: "th1", title: "Wire the panel", state: "todo", priority: "high", dueDate: null, createdByKind: "human", createdById: "alice" },
  comments: [
    { id: "c1", orgId: "acme", taskId: "tk1", authorKind: "human", authorId: "alice", body: "first comment", createdAt: new Date(0).toISOString() },
  ],
  relations: [
    { id: "r1", orgId: "acme", fromTaskId: "tk1", toTaskId: "tk2", relation: "blocks", createdAt: new Date(0).toISOString() },
  ],
};

describe("TasksPanel", () => {
  it("renders a task with its comments and relations (#81)", async () => {
    const getTask = vi.fn(async () => detail);
    render(<TasksPanel initialTaskId="tk1" getTask={getTask} updateTask={vi.fn()} addTaskComment={vi.fn()} />);
    expect(await screen.findByText("Wire the panel")).toBeInTheDocument();
    expect(screen.getByText("first comment")).toBeInTheDocument();
    expect(screen.getByText(/blocks/)).toBeInTheDocument();
    expect(getTask).toHaveBeenCalledWith("tk1");
  });

  it("changing the state calls updateTask (#81)", async () => {
    const getTask = vi.fn(async () => detail);
    const updated: Task = { ...detail.task, state: "in_progress" };
    const updateTask = vi.fn(async () => updated);
    render(<TasksPanel initialTaskId="tk1" getTask={getTask} updateTask={updateTask} addTaskComment={vi.fn()} />);
    await screen.findByText("Wire the panel");
    fireEvent.change(screen.getByLabelText(/state/i), { target: { value: "in_progress" } });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("tk1", { state: "in_progress" }));
  });

  it("adding a comment calls addTaskComment (#81)", async () => {
    const getTask = vi.fn(async () => detail);
    const newComment: TaskComment = { id: "c2", orgId: "acme", taskId: "tk1", authorKind: "human", authorId: "alice", body: "nice", createdAt: new Date(1).toISOString() };
    const addTaskComment = vi.fn(async () => newComment);
    render(<TasksPanel initialTaskId="tk1" getTask={getTask} updateTask={vi.fn()} addTaskComment={addTaskComment} />);
    await screen.findByText("Wire the panel");
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), { target: { value: "nice" } });
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));
    await waitFor(() => expect(addTaskComment).toHaveBeenCalledWith("tk1", "nice"));
    expect(await screen.findByText("nice")).toBeInTheDocument();
  });
});
