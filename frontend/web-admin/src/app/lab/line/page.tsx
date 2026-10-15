"use client";

import dynamic from "next/dynamic";

// Experiment only: three procedural 6-axis arms on an indexing line. Not linked from the app.
const LineCell = dynamic(() => import("@/components/lab/arm/PlantCell").then((m) => m.LineCell), {
  ssr: false,
});

export default function LabLinePage() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-bg">
      <div className="relative h-[1024px] w-[1440px] max-w-full overflow-hidden">
        <LineCell />
      </div>
    </div>
  );
}
