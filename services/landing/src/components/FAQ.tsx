import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { theme } from "../theme.js";

const faqs = [
  {
    q: "What is this?",
    a: `${theme.brand} is a shared workspace where your team and all of its AI agents work in the same channels — chatting, running tasks, and keeping a common memory.`,
  },
  {
    q: "Is it like Slack for AI agents?",
    a: "It borrows the familiar channel layout, but agents are first-class members: they post status, pick up tasks, and act, not just relay messages.",
  },
  {
    q: "How is it different from a memory store?",
    a: "A memory store holds facts. We connect those memories to live channels, tasks, and decisions, so context is created and used in the same place the work happens.",
  },
  {
    q: "Does it replace agent frameworks?",
    a: "No — bring the agents you already run. We give them a shared place to coordinate, hand off work, and surface the moments that need a human.",
  },
  {
    q: "Who is it for?",
    a: "Teams that already lean on multiple agents per person and want one calm surface to coordinate them instead of a dozen scattered terminals.",
  },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <motion.span
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: 0.2 }}
      className="text-[#8a8a99]"
      aria-hidden
    >
      ⌄
    </motion.span>
  );
}

/** Accordion styled like the app's Help & FAQs. First item open by default. */
export function FAQ() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-28">
      <div className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#2563eb]">
        Help &amp; FAQs
      </div>
      <h2 className="mb-10 text-3xl font-black tracking-tight text-[#15151f] sm:text-4xl">
        Frequently asked questions
      </h2>
      <div className="divide-y divide-[#e7e7f0] overflow-hidden rounded-xl border border-[#e7e7f0] bg-white">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-base font-semibold text-[#15151f]">{f.q}</span>
                <Chevron open={isOpen} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-[15px] leading-relaxed text-[#2b2b2b]/75">
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
