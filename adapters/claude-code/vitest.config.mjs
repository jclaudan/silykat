import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../test/fixed-clock.mjs'],
    // The plugin's own tests (the review pane) run under `claude plugin test`, in Claude Code's engine.
    exclude: [...configDefaults.exclude, 'plugin/**'],
  },
});
