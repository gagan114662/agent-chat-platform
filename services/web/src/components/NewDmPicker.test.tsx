import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewDmPicker } from "./NewDmPicker.js";

describe("NewDmPicker", () => {
  it("calls onStartDm with the selected principal's kind+id", () => {
    const onStartDm = vi.fn();
    render(<NewDmPicker principals={[{ kind: "agent", id: "a1", name: "Coder" }]} onStartDm={onStartDm} />);
    fireEvent.change(screen.getByLabelText("start dm"), { target: { value: "a1" } });
    expect(onStartDm).toHaveBeenCalledWith("agent", "a1");
  });
});
