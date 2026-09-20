import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard/Dashboard";

export const metadata: Metadata = {
  title: "Intelligence",
  description:
    "Live urban-heat intelligence across the measured station network: what is predicted, "
    + "how severe it is, why, and where.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
