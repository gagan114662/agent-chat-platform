import "@testing-library/jest-dom/vitest";

// jsdom does not implement Element.prototype.scrollIntoView; stub it so
// components that autoscroll (ThreadView) don't throw under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
