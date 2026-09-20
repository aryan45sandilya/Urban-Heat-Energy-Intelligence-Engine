import type { Metadata } from "next";

import { IntroPage } from "@/components/intro/IntroPage";

export const metadata: Metadata = {
  title: "Urban Heat & Energy Intelligence Engine",
  description:
    "Predict urban heat risk. Forecast energy demand. Understand why. Explore what happens next.",
};

export default function HomePage() {
  return <IntroPage />;
}
