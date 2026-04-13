import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import functional from "eslint-plugin-functional";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      functional,
    },
    rules: {
      // FP enforcement
      "functional/no-let": "error",
      "functional/immutable-data": ["error", {
        ignoreClasses: true,
      }],
      "functional/no-loop-statements": "error",

      // TypeScript strictness
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "error",

      // Allow patterns needed by the codebase
      "functional/no-expression-statements": "off",
      "functional/no-conditional-statements": "off",
      "functional/no-return-void": "off",
      "functional/no-throw-statements": "off",
      "functional/functional-parameters": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "functional/no-let": "off",
      "functional/immutable-data": "off",
      "functional/no-loop-statements": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.config.js", "*.config.ts"],
  }
);
