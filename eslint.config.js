import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * CodeVault lint policy.
 *
 * The rules below are deliberately opinionated about the two things that keep
 * a security tool trustworthy: no untyped escape hatches, and no accidental
 * privilege leaks from the Electron main process into the renderer.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "**/.vite/**",
      "**/drizzle/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression > TSUnknownKeyword.typeAnnotation ~ TSAsExpression",
          message:
            "Do not launder types through `as unknown as`. Model the type or validate at the boundary.",
        },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}", "packages/ui/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message:
                "The renderer must not import Electron. Use the preload bridge on window.codevault.",
            },
            {
              name: "node:child_process",
              message: "The renderer must never spawn processes.",
            },
            {
              name: "node:fs",
              message: "The renderer must never touch the filesystem directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);
