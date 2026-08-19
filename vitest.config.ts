import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration.
 *
 * Node projects cover domain, server, worker and Electron main-process logic.
 * The single browser-like project covers React components in `packages/ui` and
 * the desktop renderer, which need a DOM.
 *
 * A handful of files in `packages/markdown` are DOM code that is not a React
 * component — SVG sanitisation, diagram hydration. Those opt in per file with
 * an `@vitest-environment jsdom` docblock rather than moving the whole package
 * into the browser-like project.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/{core,standards,contracts,db,reporting,ai,markdown,mcp}/src/**/*.test.ts",
            "apps/{server,worker,media-worker}/src/**/*.test.ts",
            "apps/desktop/src/{main,preload}/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "node-integration",
          environment: "node",
          include: ["**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          // Integration files exercise one intentionally singleton
          // organization. Running files in parallel makes unrelated fixtures
          // mutate the same organization between assertions.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
      {
        // The renderer's own tsconfig is split in two for Electron's main and
        // web halves, so there is no single one for the runner to read the JSX
        // setting out of. Stated here instead.
        esbuild: { jsx: "automatic" },
        test: {
          name: "dom",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "packages/ui/src/**/*.test.tsx",
            "apps/desktop/src/renderer/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
