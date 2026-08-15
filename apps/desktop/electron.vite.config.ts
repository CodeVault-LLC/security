import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * Desktop build.
 *
 * Three bundles with different rules. The main and preload bundles target Node
 * and keep their dependencies external; the renderer bundle targets Chromium,
 * has no Node built-ins available to it at all, and is split per route so a
 * navigation loads only what it needs.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve("src/main/index.ts") },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts") },
        output: { format: "es", entryFileNames: "[name].mjs" },
      },
    },
  },

  renderer: {
    root: resolve("src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
      },
    },
    build: {
      // Absolute, because the renderer's `root` is `src/renderer` and a
      // relative outDir would resolve against it.
      outDir: resolve("out/renderer"),
      // Source maps ship in development only: in a packaged build they would
      // hand a reader the unminified renderer for free.
      sourcemap: process.env.NODE_ENV !== "production",
      rollupOptions: {
        input: { index: resolve("src/renderer/index.html") },
        output: {
          manualChunks: {
            // The Markdown editor is large and only needed on report screens.
            editor: [
              "@codemirror/state",
              "@codemirror/view",
              "@codemirror/lang-markdown",
              "@codemirror/commands",
              "@codemirror/language",
            ],
          },
        },
      },
    },
  },
});
