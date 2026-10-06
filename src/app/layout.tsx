import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { THEME_INIT } from "@/components/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "MARTY.LIVE",
  description: "Tell Marty where to go and watch it decide, plan a route and drive there.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#040507",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
