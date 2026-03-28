import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "output/**",
    "build/**",
    "apps/driver_app/build/**",
    "apps/driver_app/.dart_tool/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
