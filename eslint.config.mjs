import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "src/generated/**", "node_modules/**", "storage-data/**", "public/pdfjs/**", "playwright-report/**", "test-results/**"]),
]);
