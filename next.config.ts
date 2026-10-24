import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF.js and Konva ship optional node-only deps that must not be bundled for the server.
  serverExternalPackages: ["@prisma/client", "pdf-lib", "pdfjs-dist", "mathjax-full"],
  turbopack: {},
  // pdf.js loads its worker and font data by path at run time, which the serverless file tracer cannot see.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/pdfjs-dist/legacy/build/**/*", "./node_modules/pdfjs-dist/standard_fonts/**/*", "./node_modules/pdfjs-dist/cmaps/**/*"],
  },
};

export default nextConfig;
