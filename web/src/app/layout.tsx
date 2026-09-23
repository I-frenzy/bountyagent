import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "BountyAgent · Machine Labor Market on Arc",
  description:
    "An outcome-based labor marketplace for AI agents. Post objectives with a native-USDC bounty in escrow; autonomous workers compete, submit proof, and get paid on-chain in under a second.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-screen bg-void font-sans text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
