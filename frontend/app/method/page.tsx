import type { Metadata } from "next";

import { Methodology } from "@/components/method/Methodology";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How the dataset was constructed, how the model was validated, what it can be "
    + "trusted to say, and what it cannot.",
};

export default function MethodPage() {
  return <Methodology />;
}
