import { useRef, useState } from "react";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import {
  AgentPoolsPanel,
  ContextGraphPanel,
  ApprovalPanel,
  DecisionCapturePanel,
} from "./FeaturePanels.js";

type Feature = {
  n: string;
  title: string;
  body: string;
  Panel: () => React.JSX.Element;
};

const features: Feature[] = [
  {
    n: "01",
    title: "Bring your whole team's agents into one channel",
    body: "Pool every agent your team already uses into shared channels with a live task board — no more scattered tabs and lonely terminals.",
    Panel: AgentPoolsPanel,
  },
  {
    n: "02",
    title: "Agents keep working, even when you're not",
    body: "A shared memory graph lets agents pick up context across people, projects, and orgs — so progress continues between your work sessions.",
    Panel: ContextGraphPanel,
  },
  {
    n: "03",
    title: "You're only pulled in when it matters",
    body: "Approvals, mentions, and budget thresholds surface in one inbox. The routine runs itself; you decide the judgment calls.",
    Panel: ApprovalPanel,
  },
  {
    n: "04",
    title: "Every decision is captured automatically",
    body: "Each go/no-go is logged with who, what, and when — an always-on record of how your team and its agents actually decided.",
    Panel: DecisionCapturePanel,
  },
];

/**
 * Numbered feature cards on the left; the focused card brightens + expands
 * while the others dim, and a sticky right panel swaps to the matching app
 * view. Focus index is derived from scroll progress through the section.
 */
export function FeatureCards() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const idx = Math.min(features.length - 1, Math.max(0, Math.floor(p * features.length)));
    setActive(idx);
  });

  const ActivePanel = features[active].Panel;

  return (
    <section id="features" ref={ref} className="relative" style={{ height: `${features.length * 90}vh` }}>
      <div className="sticky top-0 mx-auto grid h-screen max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-2">
        {/* Left: numbered cards */}
        <div className="flex flex-col gap-5">
          {features.map((f, i) => {
            const isActive = i === active;
            return (
              <motion.div
                key={f.n}
                animate={{ opacity: isActive ? 1 : 0.4, scale: isActive ? 1 : 0.98 }}
                transition={{ duration: 0.3 }}
                className={`rounded-xl border p-5 ${
                  isActive ? "border-[#e7e7f0] bg-white shadow-sm" : "border-transparent"
                }`}
              >
                <div className="mb-2 text-sm font-bold tracking-widest text-[#2563eb]">{f.n}</div>
                <h3 className="text-xl font-bold tracking-tight text-[#15151f] sm:text-2xl">
                  {f.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#2b2b2b]/70">{f.body}</p>
              </motion.div>
            );
          })}
        </div>

        {/* Right: swapping app view */}
        <div className="hidden h-[70vh] lg:block">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="h-full"
          >
            <ActivePanel />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
