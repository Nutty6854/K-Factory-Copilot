import { profile } from "@/data/factoryProfile";

export type SensorDelta = {
  name: string;
  base: number;
  current: number;
  changePct: number;
  trend: string;
  unit: string;
};

export type CauseCandidate = {
  cause: string;
  causeKo: string;
  confidence: number;
  evidenceKeys?: string[];
  evidence: string[];
  recommendedActions: string[];
};

export type Equipment = {
  id: string;
  name: string;
  nameKo: string;
  line: string;
  kind: string;
  role: string;
  coolingLine: string;
  powerZone: string;
  status: "normal" | "warning" | "abnormal";
  anomalyScore: number;
  position: [number, number, number];
  sensorDeltas?: SensorDelta[];
  causeCandidates?: CauseCandidate[];
  /** History row id of the injection currently shown on this equipment */
  injectionId?: string;
  /** Who put the equipment into its current state: a manual injection or the sensor monitor */
  source?: "injection" | "sensor";
  /** a sensor alarm the Rule Engine could not explain (best candidate below the 0.5 line) */
  unexplained?: boolean;
  advisor?: {
    summary: string;
    primaryCause: string;
    evidenceExplanation: string[];
    recommendedActions: string[];
    usedCauses?: string[];
  };
};

export type FactoryEvent = {
  id: string;
  time: string;
  message: string;
  level: "info" | "warn" | "alert";
};

/**
 * Equipment the dashboard works with, projected from the factory profile
 * (contracts/examples/factory_profile.line_a.json) instead of being typed in by hand.
 * Only machines that carry a `demo_id` take part in the demo scenarios.
 *
 * `position` is a view transform for the map tab: the real robot pitch (3.4 m) is shrunk to the
 * map's 2.2 so the 12 x 8 floor stays readable. Real coordinates live in the profile.
 */
const demoMachines = profile.equipment.filter((e) => e.demo_id);
const mapScale = (() => {
  const xs = demoMachines.map((e) => e.position_m.x).sort((x, y) => x - y);
  return xs.length > 1 ? 2.2 / (xs[1] - xs[0]) : 1;
})();
const mapCentre = (() => {
  const xs = demoMachines.map((e) => e.position_m.x);
  return (Math.min(...xs) + Math.max(...xs)) / 2;
})();
const round2 = (n: number) => Math.round(n * 100) / 100;

export const INITIAL_EQUIPMENT: Equipment[] = demoMachines.map((e) => {
  const type = profile.catalog[e.type];
  const systems = e.shared_systems ?? {};
  return {
    id: e.demo_id!,
    name: e.label?.title ?? e.id,
    nameKo: e.name_ko ?? e.id,
    line: profile.factory.line_name_ko,
    kind: type.name_ko,
    role: e.role_short ?? e.role ?? "",
    coolingLine: profile.shared_systems[systems.cooling_line ?? ""]?.name_ko ?? "-",
    powerZone: profile.shared_systems[systems.power_zone ?? ""]?.name_ko ?? "-",
    status: "normal" as const,
    anomalyScore: 0,
    position: [round2((e.position_m.x - mapCentre) * mapScale), 0.35, 0] as [number, number, number],
  };
});

/** Sensor deltas after bearing_wear inject — candidates come from Rule Engine. */
export const BEARING_WEAR_DELTAS: SensorDelta[] = [
  {
    name: "진동",
    base: 2.1,
    current: 3.01,
    changePct: 43.3,
    trend: "증가",
    unit: "mm/s",
  },
  {
    name: "전류",
    base: 12.8,
    current: 15.2,
    changePct: 18.8,
    trend: "증가",
    unit: "A",
  },
  {
    name: "온도",
    base: 48.0,
    current: 54.0,
    changePct: 12.4,
    trend: "지연 증가",
    unit: "°C",
  },
];

export const INITIAL_EVENTS: FactoryEvent[] = [
  {
    id: "e0",
    time: "21:20",
    message: "라인 A 정상 운전 중",
    level: "info",
  },
];

export type Scenario = "bearing_wear" | "motor_overload";
export type Strength = "약" | "중" | "강";

export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "bearing_wear", label: "bearing_wear · 베어링 마모" },
  { id: "motor_overload", label: "motor_overload · 모터 과부하 (더미)" },
];

export const STRENGTHS: Strength[] = ["약", "중", "강"];

const STRENGTH_FACTOR: Record<Strength, number> = { 약: 0.6, 중: 1, 강: 1.4 };

const MOTOR_OVERLOAD_DELTAS: SensorDelta[] = [
  { name: "진동", base: 2.1, current: 2.69, changePct: 28, trend: "증가", unit: "mm/s" },
  { name: "전류", base: 12.8, current: 17.41, changePct: 36, trend: "급등", unit: "A" },
  { name: "온도", base: 48.0, current: 51.84, changePct: 8, trend: "증가", unit: "°C" },
];

const SCENARIO_DELTAS: Record<Scenario, SensorDelta[]> = {
  bearing_wear: BEARING_WEAR_DELTAS,
  motor_overload: MOTOR_OVERLOAD_DELTAS,
};

const round = (n: number, digits: number) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

/** Dummy simulator output for a scenario at a given strength. 중 = baseline demo values. */
export function buildDeltas(scenario: Scenario, strength: Strength): SensorDelta[] {
  const f = STRENGTH_FACTOR[strength];
  return SCENARIO_DELTAS[scenario].map((d) => {
    if (f === 1) return { ...d };
    const changePct = round(d.changePct * f, 1);
    return { ...d, changePct, current: round(d.base * (1 + changePct / 100), 2) };
  });
}

export function anomalyScoreFor(strength: Strength): number {
  return { 약: 0.55, 중: 0.91, 강: 0.97 }[strength];
}

export type HistoryEntry = {
  id: string;
  at: string;
  time: string;
  equipmentId: string;
  equipmentNameKo: string;
  /** "sensor" = raised automatically by the sensor monitor */
  scenario: Scenario | "sensor";
  strength: Strength | "자동";
  /** what the sensor monitor saw, for sensor-raised rows */
  trigger?: string;
  /** sensor-raised row whose best candidate stayed below the 0.5 line: shown as "원인 미상" */
  unexplained?: boolean;
  status: Equipment["status"];
  anomalyScore: number;
  deltas: SensorDelta[];
  candidates: CauseCandidate[];
  advisor?: NonNullable<Equipment["advisor"]>;
  /*
   * Lifecycle of the incident. The fields above are the snapshot at detection time and never change;
   * these are filled in as the incident moves on (detected → judged → explained → acted on → resolved).
   */
  advisorAt?: string;
  /** recommended action → clock time it was ticked off */
  actionsDone?: Record<string, string>;
  resolution?: Resolution;
};

/** how an incident ended: sensors back in range, someone resolved it, the monitor replaced it, or the app was reset/restarted */
export type Resolution = { at: string; time: string; how: "sensor" | "manual" | "replaced" | "reset" | "restart" };
