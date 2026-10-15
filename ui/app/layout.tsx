import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jet = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jet", display: "swap" });

export const metadata: Metadata = { title: "ReleaseGuard", description: "AI guardrail around deploys" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jet.variable}`}>
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto max-w-6xl px-5 py-7 rise">{children}</main>
      </body>
    </html>
  );
}
