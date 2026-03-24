import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AppProviders } from "@/components/app-providers";

export const metadata: Metadata = {
  title: "Liquid Notes",
  description: "PWA заметок с оффлайном, синхронизацией и напоминаниями.",
  applicationName: "Liquid Notes",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Liquid Notes",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#091019",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
