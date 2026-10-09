import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veil8004 Indexer View",
  description: "What a public indexer can reconstruct from ERC-8004 activity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
