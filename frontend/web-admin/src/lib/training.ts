import { profile, typeOf, type Instance, type Net } from "@/data/factoryProfile";
import { nameOf, resolveStatus, scenariosOf, type Status } from "@/data/plantStatus";
import { readSensors, sensorsOf } from "@/data/plantSensors";
import { monitorRobot } from "@/lib/sensorMonitor";
import { runRuleEngine } from "@/lib/ruleEngine";

/*
 * Training drills: a made-up fault is put on the plant model (never on the live app, never saved), the trainee
 * sees the sensors that left their normal range and picks the cause. Everything here is derived from the same
 * profile, scenarios and sensors as the rest of the app; the faults and sensor values are our assumptions.
 */

export type Level = "쉬움" | "보통" | "어려움";

type Spec = { type: string; scenario: string; level: Level; demo?: string };

const SPECS: Spec[] = [
  { type: "robot_arm", demo: "robot_03", scenario: "bearing_wear", level: "쉬움" },
  { type: "washer_dryer", scenario: "pump_failure", level: "쉬움" },
  { type: "robot_arm", demo: "robot_03", scenario: "motor_overload", level: "보통" },
  { type: "chiller", scenario: "flow_low", level: "보통" },
  { type: "power_panel", scenario: "breaker_trip", level: "보통" },
  { type: "gas_manifold", scenario: "gas_out", level: "보통" },
  { type: "dust_collector", scenario: "fan_failure", level: "어려움" },
  { type: "compressor", scenario: "pressure_low", level: "어려움" },
];

export type Option = { key: string; machineId: string; scenarioId: string; label: string };
export type Seen = { id: string; name: string; status: Status; readings: { label: string; text: string; range: string; status: Status }[] };
export type Drill = {
  id: string;
  level: Level;
  root: Instance;
  scenarioId: string;
  options: Option[];
  answerKey: string;
  seen: Seen[];
  hints: string[];
  explain: { title: string; lines: string[]; engine: string[] };
};

const NET_KO: Record<Net, string> = { power: "전원", cooling: "냉각", air: "압축공기", gas: "보호가스", exhaust: "배기", signal: "신호", bundle: "케이블" };
const STATUS_KO: Record<Status, string> = { normal: "정상", warning: "주의", abnormal: "이상" };

const rootOf = (s: Spec) => profile.equipment.find((e) => e.type === s.type && (!s.demo || e.demo_id === s.demo)) ?? null;
const keyOf = (machineId: string, scenarioId: string) => `${machineId}:${scenarioId}`;
const optionOf = (s: Spec): Option | null => {
  const r = rootOf(s);
  const sc = scenariosOf(s.type).find((x) => x.id === s.scenario);
  return r && sc ? { key: keyOf(r.id, sc.id), machineId: r.id, scenarioId: sc.id, label: `${nameOf(r.id)} · ${sc.label}` } : null;
};

// idle-adjusted bands carry float noise (0.62475): three significant digits are plenty for a trainee
const tidy = (n: number) => Number(n.toPrecision(3));

const MACHINES = profile.equipment.filter((e) => e.type !== "conveyor" && sensorsOf(e).length > 0);

/** what the sensors of the whole line show while `injected` is on the plant (every machine is assumed to be working) */
export function lineSeen(injected: Record<string, string>, t: number) {
  const res = resolveStatus(injected);
  const seen: Seen[] = [];
  for (const m of MACHINES) {
    const r = res[m.id];
    const readings = readSensors(m, { act: { busy: true, progress: 0.5, status: r.status, state: "run", processed: 0, busySec: 0, waiting: 0 }, res: r, t });
    const out = readings.filter((x) => x.status !== "normal");
    if (!out.length) continue;
    seen.push({
      id: m.id,
      name: nameOf(m.id),
      status: r.status,
      readings: out.map((x) => ({
        label: x.def.label,
        text: `${x.value.toFixed(x.def.dec ?? 1)} ${x.def.unit}`,
        range: `${tidy(x.def.normal[0])}–${tidy(x.def.normal[1])} ${x.def.unit}`,
        status: x.status,
      })),
    });
  }
  return { res, seen };
}

function build(spec: Spec, index: number, t: number): Drill | null {
  const root = rootOf(spec);
  const scenario = scenariosOf(spec.type).find((s) => s.id === spec.scenario);
  const answer = optionOf(spec);
  if (!root || !scenario || !answer) return null;
  const { res, seen } = lineSeen({ [root.id]: scenario.id }, t);

  // distractors: other drills' faults, picked by a fixed pattern so a question looks the same every time
  const others = SPECS.filter((s) => s !== spec).map(optionOf).filter((o): o is Option => !!o && o.key !== answer.key);
  const picks = [0, 3, 5].map((k) => others[(index * 2 + k) % others.length]).filter((o, i, a) => a.findIndex((x) => x.key === o.key) === i);
  for (const o of others) if (picks.length < 3 && !picks.some((p) => p.key === o.key)) picks.push(o);
  const options = [...picks];
  options.splice(index % 4, 0, answer);

  const affected = Object.entries(res).filter(([id, r]) => id !== root.id && r.cause?.from === root.id);
  const byNet = new Map<Net, { id: string; status: Status; pending: boolean }[]>();
  for (const [id, r] of affected) {
    const net = r.cause!.net!;
    byNet.set(net, [...(byNet.get(net) ?? []), { id, status: r.status, pending: r.cause!.pending }]);
  }

  const hints = [
    seen.length > 1
      ? `${seen.length}대의 설비에서 센서가 정상 범위를 벗어났어요. 여러 설비가 같이 이상하면 공통으로 받는 것(전원·냉각 등)을 의심해 보세요.`
      : "센서가 벗어난 설비가 하나뿐이에요. 그 설비 자체를 의심해 보세요.",
    byNet.size
      ? `이상한 설비들이 공통으로 연결된 것: ${[...byNet.keys()].map((n) => NET_KO[n]).join(", ")}`
      : `벗어난 센서: ${[...new Set(seen.flatMap((s) => s.readings.map((r) => r.label)))].slice(0, 4).join(", ")}`,
    `원인 설비의 종류: ${typeOf(root).name_ko}`,
  ];

  const lines = [`${nameOf(root.id)}에서 "${scenario.label}"가 일어났어요 (${scenario.effect}).`];
  for (const [net, list] of byNet) {
    const shown = list.slice(0, 5).map((x) => `${nameOf(x.id)}(${STATUS_KO[x.status]})`).join(", ");
    const names = list.length > 5 ? `${shown} 외 ${list.length - 5}대` : shown;
    lines.push(`${NET_KO[net]} 연결 ${list.length}대에 영향: ${names}${list.some((x) => x.pending) ? " · 연결 중 '확인 필요'가 있어요" : ""}`);
  }
  if (!byNet.size) lines.push("이 고장은 다른 설비에 퍼지지 않고 이 설비에서 끝나요(공급 연결 기준).");

  // what the app's Rule Engine says about the robots in the picture: the engine only knows robots, so it names a
  // cause category (cooling line, power supply) and the supply connections in the profile point at the machine
  const engine: string[] = [];
  for (const m of profile.equipment) {
    if (!m.demo_id || res[m.id].status === "normal") continue;
    const mon = monitorRobot(m, res[m.id], t);
    const out = runRuleEngine({ equipmentId: m.demo_id, scenario: "sensor", sensorDeltas: mon.deltas, anomalyScore: mon.worst === "abnormal" ? 0.91 : 0.55 });
    const top = out.causeCandidates[0];
    // below the 0.5 line the engine has not judged anything: it only reads vibration, current and temperature
    engine.push(
      top && top.confidence >= 0.5
        ? `${nameOf(m.id)} · Rule Engine 1위 ${top.causeKo} ${top.confidence.toFixed(2)}`
        : `${nameOf(m.id)} · Rule Engine은 판정하지 못했어요 (엔진은 진동·전류·온도만 봐요${top ? `, 1위 ${top.causeKo} ${top.confidence.toFixed(2)}는 기준 0.5 미만` : ""})`,
    );
  }

  return { id: `${spec.type}:${spec.scenario}`, level: spec.level, root, scenarioId: scenario.id, options, answerKey: answer.key, seen, hints, explain: { title: answer.label, lines, engine } };
}

/** what the map shows while a drill runs: a fault on the plant model only, never in the shared fault record */
export type TrainScene = { key: string; injected: Record<string, string>; rootId: string; revealed: boolean };

export const LEVELS: Level[] = ["쉬움", "보통", "어려움"];

/** all drills for the given level (or every level); t only seeds the sensor noise */
export function drillsFor(level: Level | "전체", t: number): Drill[] {
  return SPECS.map((s, i) => (level === "전체" || s.level === level ? build(s, i, t) : null)).filter((d): d is Drill => !!d);
}
