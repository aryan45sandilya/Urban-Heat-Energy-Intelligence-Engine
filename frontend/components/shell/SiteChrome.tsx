"use client";

import { usePathname } from "next/navigation";

import { Navigation } from "./Navigation";
import { SiteFooter } from "./SiteFooter";
import { ThemeProvider } from "./ThemeProvider";

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The map and home intro pages own their full viewport — no page padding, no footer.
  const immersive = pathname === "/" || pathname?.startsWith("/map");

  return (
    <ThemeProvider>
      <div className="flex min-h-dvh flex-col">
        <Navigation />
        <main
          id="content"
          className={
            immersive
              ? "flex-1 pt-[57px] lg:pt-[61px]"
              : "flex-1 pb-16 pt-[57px] lg:pb-8 lg:pt-[132px]"
          }
        >
          {children}
        </main>
        {!immersive && <SiteFooter />}
      </div>
    </ThemeProvider>
  );
}
