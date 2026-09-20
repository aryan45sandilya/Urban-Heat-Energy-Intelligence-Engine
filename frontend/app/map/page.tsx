import type { Metadata } from "next";

import { HotspotMap } from "@/components/map/HotspotMap";

export const metadata: Metadata = {
  title: "Hotspot Map",
  description:
    "Every measured station, scored by the same model under identical weather, so the "
    + "differences on the map are the cities themselves.",
};

export default function MapPage() {
  return <HotspotMap />;
}
