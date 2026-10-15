"use client";

import dynamic from "next/dynamic";

// Experiment only: the whole line rendered from the factory profile. Not linked from the app.
const PlantOverview = dynamic(() => import("@/components/lab/arm/PlantOverview").then((m) => m.PlantOverview), {
  ssr: false,
});

export default function LabPlantPage() {
  return (
    // fills the window (1440×1024 and 1280×800 alike); the HUD and labels lay out against the real size
    <div className="relative h-dvh w-full overflow-hidden bg-bg">
      <PlantOverview />
    </div>
  );
}
