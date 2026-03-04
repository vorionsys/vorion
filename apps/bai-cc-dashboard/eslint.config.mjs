import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([
    "dist/**",
    ".astro/**",
    "node_modules/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
