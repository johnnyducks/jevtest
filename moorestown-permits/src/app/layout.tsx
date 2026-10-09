import type { Metadata, Viewport } from "next";
import { Header } from "@/components/Header";
import { ToastProvider } from "@/components/ui";
import { L, OFFICE_PHONE } from "@/lib/permits/links";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moorestown Permits",
  description: "Plan a home project, see which permits, plans and inspections you need, and send in a complete application.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <ToastProvider>
          <Header />
          <main className="wrap">{children}</main>
          <footer className="foot">
            <div className="wrap">
              <div>
                Township of Moorestown Construction Office · 111 W. Second Street · {OFFICE_PHONE}
                <br />
                Official filing, payment and inspection scheduling:{" "}
                <a href={L.sdlLogin} target="_blank" rel="noopener">SDL portal</a>
              </div>
              <div className="demo">
                <sup>*</sup>A demonstration prototype by the Moorestown AI Task Force for review by Township officials. Guidance here
                summarizes the Township&apos;s homeowner guide and is not a code determination. Submissions are not official permit
                applications.
              </div>
            </div>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
