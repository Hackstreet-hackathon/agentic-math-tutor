import type { Metadata, Viewport } from "next";
import { Caveat } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

export const metadata: Metadata = {
  title: "Math Notebook",
  description: "A mathematics notebook with an AI tutor that lives inside your workspace.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={caveat.variable}>
      <body>{children}</body>
    </html>
  );
}
