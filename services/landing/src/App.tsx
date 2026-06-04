import { IntroLoader } from "./components/IntroLoader.js";
import { FundingBanner } from "./components/FundingBanner.js";
import { Dock } from "./components/Dock.js";
import { ScrollAppReveal } from "./components/ScrollAppReveal.js";
import { FeatureCards } from "./components/FeatureCards.js";
import { BlackInterstitial } from "./components/BlackInterstitial.js";
import { FAQ } from "./components/FAQ.js";
import { Contact } from "./components/Contact.js";
import { Footer } from "./components/Footer.js";

/**
 * Single long pinned-scroll landing page:
 * IntroLoader (overlay) → FundingBanner → Hero+ScrollAppReveal →
 * FeatureCards → BlackInterstitial → FAQ → Contact → Footer, with a
 * persistent floating Dock.
 */
export function App() {
  return (
    <div id="top" className="relative">
      <IntroLoader />
      <FundingBanner />
      {/* Hero lives inside ScrollAppReveal so it can fade behind the window. */}
      <ScrollAppReveal />
      <FeatureCards />
      <BlackInterstitial />
      <FAQ />
      <Contact />
      <Footer />
      <Dock />
    </div>
  );
}
