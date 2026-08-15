import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration.
 *
 * Node projects cover domain, server, worker and Electron main-process logic.
 * The single browser-like project covers React components in `packages/ui` and
 * the desktop renderer, which need a DOM.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/{core,standards,contracts,db,reporting,ai}/src/**/*.test.ts",
            "apps/{server,worker}/src/**/*.test.ts",
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
          testTimeout: 30_000,
        },
      },
      {
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
