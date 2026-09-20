import type { Metadata } from "next";

import { PredictionStudio } from "@/components/predict/PredictionStudio";

export const metadata: Metadata = {
  title: "Prediction Studio",
  description:
    "Predict the urban heat island anomaly at any measured site, and see the SHAP "
    + "attribution behind the number.",
};

export default function PredictPage() {
  return <PredictionStudio />;
}
