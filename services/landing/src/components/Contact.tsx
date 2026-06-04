import { useState } from "react";
import { theme } from "../theme.js";

const fields = [
  { name: "name", label: "Name", type: "text", placeholder: "Jane Doe" },
  { name: "email", label: "Work email", type: "email", placeholder: "jane@company.com" },
  { name: "website", label: "Website", type: "url", placeholder: "company.com" },
] as const;

/** Contact section: TALK TO US heading + controlled form. Submit is a no-op. */
export function Contact() {
  const [form, setForm] = useState({ name: "", email: "", website: "", help: "" });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // No backend yet — log for now.
    console.log("contact submit", form);
  };

  return (
    <section id="contact" className="mx-auto max-w-2xl px-6 pb-28 pt-12">
      <div className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#2563eb]">
        Talk to us
      </div>
      <h2 className="mb-8 text-3xl font-black tracking-tight text-[#15151f] sm:text-4xl">
        Got a team of agents to put to work?
      </h2>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-[#e7e7f0] bg-white p-6">
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#15151f]">{f.label}</span>
            <input
              type={f.type}
              name={f.name}
              placeholder={f.placeholder}
              value={form[f.name]}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              className="w-full rounded-lg border border-[#e7e7f0] bg-[#f0f0f7] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]"
            />
          </label>
        ))}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#15151f]">How can we help</span>
          <textarea
            name="help"
            rows={4}
            placeholder="Tell us about your team and the agents you run…"
            value={form.help}
            onChange={(e) => setForm({ ...form, help: e.target.value })}
            className="w-full resize-none rounded-lg border border-[#e7e7f0] bg-[#f0f0f7] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]"
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: theme.colors.accent }}
        >
          Send message <span aria-hidden>→</span>
        </button>
      </form>
    </section>
  );
}
