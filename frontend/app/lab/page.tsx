import type { Metadata } from "next";

import { ModelLab } from "@/components/lab/ModelLab";

export const metadata: Metadata = {
  title: "Model Lab",
  description:
    "Ten model families compared on identical chronological splits, the Random Forest "
    + "search that followed, and what the forest learned.",
};

export default function LabPage() {
  return <ModelLab />;
}
