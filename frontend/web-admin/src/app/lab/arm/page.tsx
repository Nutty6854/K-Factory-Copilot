"use client";

import dynamic from "next/dynamic";

// Experiment only: procedural 6-axis arm cell (no external assets). Not linked from the app.
const ArmCell = dynamic(() => import("@/components/lab/arm/ArmCell").then((m) => m.ArmCell), {
  ssr: false,
});

export default function LabArmPage() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-bg">
      <div className="relative h-[1024px] w-[1440px] max-w-full overflow-hidden">
        <ArmCell />
      </div>
    </div>
  );
}
