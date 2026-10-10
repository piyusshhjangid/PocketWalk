import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 20 s per test: a loaded one-CPU CI runner can take 3x longer than a laptop on the exhaustive validation tests
  // (2.4 s alone, 7+ s under contention). This is headroom, not a loosened assertion; slow tests still fail at 20 s.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20_000 },
});
