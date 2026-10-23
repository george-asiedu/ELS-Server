import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Build output, generated Prisma client and lockfiles aren't source.
  globalIgnores(["dist/**", "src/generated/**", "package-lock.json"]),
  {
    // Flat config only accepts config objects or plugin-namespaced strings here.
    // The eslintrc spellings that used to live in this list ("eslint:recommended",
    // "plugin:@typescript-eslint/recommended", "plugin:prettier/recommended")
    // are not resolvable in flat config and made every run die with
    // `Plugin "" not found`. Their flat equivalents are composed below instead.
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  // Prettier formats code only; applied to Markdown it tries to parse the
  // prose as JavaScript.
  { ...prettierRecommended, files: ["**/*.{js,mjs,cjs,ts,mts,cts}"] },
  {
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      // A leading underscore marks a binding that must exist but isn't used
      // (Express identifies error middleware by its four parameters).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // `declare global { namespace Express {} }` is how Express's Request
      // type is augmented; that is the only namespace use allowed.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
  {
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.jsonc"],
    plugins: { json },
    language: "json/jsonc",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
  },
  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
  },
]);
