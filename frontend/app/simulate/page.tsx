import type { Metadata } from "next";

import { Simulator } from "@/components/simulate/Simulator";

export const metadata: Metadata = {
  title: "What-If Simulator",
  description:
    "Compare a baseline prediction against model-based scenarios: more green cover, "
    + "less sealed ground, different weather.",
};

export default function SimulatePage() {
  return <Simulator />;
}
