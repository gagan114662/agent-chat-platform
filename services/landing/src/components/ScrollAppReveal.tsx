import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { AppWindow } from "./AppWindow.js";
import { ChatThreadMock } from "./ChatThreadMock.js";
import { Hero } from "./Hero.js";

/**
 * Signature scroll-driven reveal. A tall sticky section: as the user scrolls,
 * the dark app window scales up + rises from a card to near-full-bleed, the
 * border radius tightens, and the hero text fades behind it.
 */
export function ScrollAppReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const scale = useTransform(scrollYProgress, [0, 0.6], [0.78, 1]);
  const y = useTransform(scrollYProgress, [0, 0.6], [60, 0]);
  const radius = useTransform(scrollYProgress, [0, 0.6], [24, 12]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.25], [1, 0]);
  const windowWidth = useTransform(scrollYProgress, [0, 0.6], ["72%", "96%"]);

  return (
    <section id="reveal" ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 flex h-screen flex-col items-center overflow-hidden">
        {/* Hero fades out behind the rising window */}
        <motion.div
          style={{ opacity: heroOpacity }}
          className="absolute inset-x-0 top-0 z-0"
        >
          <Hero />
        </motion.div>

        {/* The app window that scales up to full bleed */}
        <motion.div
          style={{ scale, y, width: windowWidth, borderRadius: radius }}
          className="relative z-10 mt-[42vh] flex h-[70vh] max-w-[1400px] origin-top"
          data-testid="reveal-window"
        >
          <AppWindow title="Convene — #product-dev">
            <ChatThreadMock />
          </AppWindow>
        </motion.div>
      </div>
    </section>
  );
}
