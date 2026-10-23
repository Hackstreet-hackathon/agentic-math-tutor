import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF.js and Konva ship optional node-only deps that must not be bundled for the server.
  serverExternalPackages: ["@prisma/client", "pdf-lib", "pdfjs-dist", "mathjax-full"],
  turbopack: {},
};

export default nextConfig;
