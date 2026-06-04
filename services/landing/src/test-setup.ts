import "@testing-library/jest-dom/vitest";

// jsdom does not implement Element.prototype.scrollIntoView; stub it so
// components that autoscroll don't throw under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// framer-motion's useScroll and our FeatureCards observer rely on
// IntersectionObserver, which jsdom does not implement. Provide a no-op stub.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class IO {
    constructor(_cb: unknown, _opts?: unknown) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  globalThis.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
}

// matchMedia is used by some motion/reduced-motion checks; jsdom lacks it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
