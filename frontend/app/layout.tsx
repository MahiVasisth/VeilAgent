import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter, SiteHeader } from "./SiteHeader";

export const metadata: Metadata = {
  title: { default: "Veil8004", template: "%s · Veil8004" },
  description: "Private attestations, sealed-bid hiring and anonymous feedback for ERC-8004 agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
