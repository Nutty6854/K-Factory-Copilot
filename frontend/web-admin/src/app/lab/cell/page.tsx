"use client";

import dynamic from "next/dynamic";

// Experiment only (branch exp/robot-cell-glb): GLB robot cell quality test. Not linked from the app.
const RobotCell = dynamic(() => import("@/components/lab/RobotCell").then((m) => m.RobotCell), {
  ssr: false,
});

export default function LabCellPage() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-bg">
      <div className="relative h-[1024px] w-[1440px] max-w-full overflow-hidden">
        <RobotCell />
      </div>
    </div>
  );
}
