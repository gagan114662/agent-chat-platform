import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Contact } from "./Contact.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Contact form (#69)", () => {
  it("posts to /contact and shows a thanks state on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<Contact />);
    fireEvent.change(screen.getByPlaceholderText(/jane@company.com/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/contact");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).email).toBe("ada@example.com");

    await screen.findByText(/we'll be in touch/i);
  });

  it("falls back to console.log and shows an error on failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    render(<Contact />);
    fireEvent.change(screen.getByPlaceholderText(/jane@company.com/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(logSpy).toHaveBeenCalled());
    expect(logSpy.mock.calls[0][0]).toBe("contact submit");
    await screen.findByText(/couldn't send right now/i);
  });
});
