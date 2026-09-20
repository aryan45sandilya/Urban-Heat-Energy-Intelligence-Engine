import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { SiteChrome } from "@/components/shell/SiteChrome";

/* Three typefaces with three jobs: Plus Jakarta Sans drives headlines with
   geometric confidence, Inter handles running text and controls, IBM Plex Mono
   renders every measured value so numbers line up in columns. */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-archivo",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-public-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "UHEI · Urban Heat & Energy Intelligence Engine",
    template: "%s · UHEI",
  },
  description:
    "Predict urban heat risk. Forecast energy demand. Understand why. Explore what happens next. " +
    "A Random Forest system built on NOAA station observations, OpenStreetMap urban morphology " +
    "and NYISO metered electricity load.",
  keywords: ["urban heat island", "machine learning", "random forest", "SHAP",
    "energy demand", "geospatial", "explainable AI"],
  authors: [{ name: "UHEI" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.variable} ${inter.variable} ${plexMono.variable} antialiased`}
      >
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
