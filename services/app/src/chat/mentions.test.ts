import { describe, it, expect } from "vitest";
import { parseMentions } from "./mentions.js";

describe("parseMentions", () => {
  it("extracts a single handle", () => {
    expect(parseMentions("@coder fix the login bug")).toEqual(["coder"]);
  });
  it("extracts multiple unique handles preserving order", () => {
    expect(parseMentions("hey @coder and @reviewer and @coder again")).toEqual(["coder", "reviewer"]);
  });
  it("ignores emails and mid-word @", () => {
    expect(parseMentions("mail me at a@b.com or foo@bar")).toEqual([]);
  });
  it("returns [] when no mentions", () => {
    expect(parseMentions("just a normal message")).toEqual([]);
  });
});
