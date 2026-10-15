import type { Instance } from "@/data/factoryProfile";
import type { SensorDelta } from "@/data/demo";
import { readSensors, worstOf, type Reading } from "@/data/plantSensors";
import type { Resolved, Status } from "@/data/plantStatus";

/*
 * Turns live sensor readings of a machine into what the Rule Engine understands (vibration, current and
 * temperature against their baselines) and a fingerprint that changes only when the picture changes, so an
 * alarm is raised once per change instead of once per second. No judgment here: causes come from the Rule Engine.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type Monitored = {
  readings: Reading[];
  deltas: SensorDelta[];
  worst: Status;
  fingerprint: string;
  /** the readings that are outside their normal band, for the alarm text */
  outside: Reading[];
};

const SPEC = [
  { id: "vib", name: "진동" },
  { id: "cur", name: "전류" },
  { id: "tmp", name: "온도" },
] as const;

/** Robots only: the engine's three inputs. The main app has no flow simulation, so the machine is assumed to be working. */
export function monitorRobot(inst: Instance, res: Resolved, t: number): Monitored {
  const readings = readSensors(inst, {
    act: { busy: true, progress: 0.5, status: res.status, state: "run", processed: 0, busySec: 0, waiting: 0 },
    res,
    t,
  });
  const byId = Object.fromEntries(readings.map((r) => [r.def.id, r]));
  const deltas: SensorDelta[] = [];
  for (const { id, name } of SPEC) {
    const r = byId[id];
    if (!r) continue;
    const base = r.def.nominal;
    const changePct = round1(((r.value - base) / base) * 100);
    deltas.push({ name, base, current: round2(r.value), changePct, trend: "", unit: r.def.unit });
  }
  // the engine reads "temperature rose after vibration" from the trend text; a snapshot cannot know the order,
  // so a rise together with a vibration rise is reported as the delayed rise the bearing pattern expects
  const vib = deltas.find((d) => d.name === "진동");
  for (const d of deltas) {
    if (d.changePct <= -50) d.trend = "감소";
    else if (d.name === "온도" && d.changePct >= 10) d.trend = vib && vib.changePct >= 30 ? "지연 증가" : "증가";
    else if (d.name === "전류" && d.changePct >= 30) d.trend = "급등";
    else d.trend = d.changePct > 5 ? "증가" : "유지";
  }
  const outside = readings.filter((r) => r.status !== "normal");
  return {
    readings,
    deltas,
    worst: worstOf(readings),
    outside,
    fingerprint: readings.map((r) => `${r.def.id}:${r.status}`).join("|"),
  };
}
