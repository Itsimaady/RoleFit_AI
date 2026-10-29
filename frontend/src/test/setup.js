import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Test-environment shim: React Router's data router builds a native (undici)
// Request with jsdom's AbortSignal, which undici rejects. The app has no route
// loaders, so the signal is irrelevant here; drop it.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init = {}) {
    const { signal: _signal, ...rest } = init;
    super(input, rest);
  }
};

// jsdom lacks ResizeObserver (used by the resume preview).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
