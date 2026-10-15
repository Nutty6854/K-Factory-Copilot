import { profile } from "@/data/factoryProfile";
import type { Equipment } from "@/data/demo";
import type { Resolved } from "@/data/plantStatus";
import { sensorsOf } from "@/data/plantSensors";

/*
 * What the top-bar status chips count. Kept in one place so the rule is easy to change:
 *  - "line" (default): every machine on the line except the conveyors. The robots (demo_id) take the worse of the
 *    Rule Engine verdict and the plant model; every other machine takes the status of the plant model (plantStatus.ts), which is what its own
 *    sensors show. A machine with no sensors at all (racks, fixtures, bins) cannot be judged, so it is not counted
 *    as 정상 but reported separately as 센서 없음.
 *  - "demo": only machines with a demo_id (the three robots).
 *  - "labeled": every non-background machine, the ones without data counted as 정상.
 */
export type ChipScope = "line" | "demo" | "labeled";
export const CHIP_SCOPE: ChipScope = "line";

export type ChipCounts = { normal: number; warning: number; abnormal: number; unmonitored: number };

const WORSE = { normal: 0, warning: 1, abnormal: 2 } as const;
const MACHINES = profile.equipment.filter((e) => e.type !== "conveyor");

export function chipCounts(equipment: Equipment[], plant?: Record<string, Resolved>, scope: ChipScope = CHIP_SCOPE): ChipCounts {
  const c: ChipCounts = { normal: 0, warning: 0, abnormal: 0, unmonitored: 0 };
  if (scope === "line") {
    for (const m of MACHINES) {
      const robot = m.demo_id ? equipment.find((e) => e.id === m.demo_id) : null;
      // same rule as the map: a robot is never shown calmer than the plant model says (the engine may find no cause)
      if (robot) c[WORSE[plant?.[m.id]?.status ?? "normal"] > WORSE[robot.status] ? plant![m.id].status : robot.status] += 1;
      else if (sensorsOf(m).length === 0) c.unmonitored += 1;
      else c[plant?.[m.id]?.status ?? "normal"] += 1;
    }
    return c;
  }
  for (const e of equipment) c[e.status] += 1;
  if (scope === "labeled") c.normal += Math.max(0, MACHINES.length - equipment.length);
  return c;
}
