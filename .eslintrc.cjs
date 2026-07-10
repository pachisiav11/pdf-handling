module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: [
    "dist/",
    "build/",
    "out/",
    "node_modules/",
    "android/",
    "resources/",
    "*.config.js",
    "*.config.ts",
    "*.cjs"
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn"
  }
};
