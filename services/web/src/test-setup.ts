import "@testing-library/jest-dom/vitest";

// jsdom does not implement Element.prototype.scrollIntoView; stub it so
// components that autoscroll (ThreadView) don't throw under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Node 25 injects a built-in experimental `localStorage` global that shadows
// jsdom's and is non-functional here (`--localstorage-file` without a valid
// path). Install a minimal in-memory Storage shim so auth token storage works.
if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
  const store = new Map<string, string>();
  const mem: Storage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true, writable: true });
}
