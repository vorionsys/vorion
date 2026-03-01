import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Rules to downgrade from error to warn for gradual migration.
// Plugin-scoped rules (react-hooks/*) must be patched inline within
// config objects that register the plugin.
const ruleOverrides = {
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  "@typescript-eslint/no-require-imports": "warn",
  "@typescript-eslint/ban-ts-comment": "warn",
  "@typescript-eslint/no-unsafe-function-type": "warn",
  "react/no-unescaped-entities": "warn",
  "react-hooks/exhaustive-deps": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/set-state-in-render": "warn",
  "react-hooks/globals": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/refs": "warn",
  "react-hooks/static-components": "warn",
  "react-hooks/use-memo": "warn",
  "react-hooks/config": "warn",
  "react-hooks/error-boundaries": "warn",
  "react-hooks/gating": "warn",
  "react-hooks/component-hook-factories": "warn",
  "react-hooks/preserve-manual-memoization": "warn",
  "import/no-anonymous-default-export": "warn",
  "prefer-const": "warn",
  "@next/next/no-assign-module-variable": "warn",
  "@next/next/no-html-link-for-pages": "warn",
  "react/jsx-no-comment-textnodes": "warn",
  "@typescript-eslint/no-empty-object-type": "warn",
};

// Plugin-scoped rules that cannot be set in a standalone config object
const pluginScopedRules = new Set([
  "react-hooks/exhaustive-deps",
  "react-hooks/purity",
  "react-hooks/set-state-in-effect",
  "react-hooks/set-state-in-render",
  "react-hooks/globals",
  "react-hooks/immutability",
  "react-hooks/refs",
  "react-hooks/static-components",
  "react-hooks/use-memo",
  "react-hooks/config",
  "react-hooks/error-boundaries",
  "react-hooks/gating",
  "react-hooks/component-hook-factories",
  "react-hooks/preserve-manual-memoization",
]);

const standaloneOverrides = Object.fromEntries(
  Object.entries(ruleOverrides).filter(([key]) => !pluginScopedRules.has(key))
);

function patchRules(configs) {
  return configs.map((config) => {
    if (!config.rules) return config;
    const patched = { ...config.rules };
    for (const [rule, setting] of Object.entries(ruleOverrides)) {
      if (rule in patched) {
        patched[rule] = setting;
      }
    }
    return { ...config, rules: patched };
  });
}

const eslintConfig = defineConfig([
  ...patchRules(nextVitals),
  ...patchRules(nextTs),
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".bmad/**",
  ]),
  {
    rules: standaloneOverrides,
  },
]);

export default eslintConfig;
