import { effectiveEdges, profile, typeOf, type Confidence, type Instance, type Net } from "@/data/factoryProfile";
import { fixtureFor, type Act } from "@/data/plantSim";
import type { Resolved, Status } from "@/data/plantStatus";

/*
 * Demo sensor layer: which readings each machine type would have, what is normal, and how a failure
 * scenario shows up in them. Ranges and nominal values are OUR ASSUMPTIONS unless a sensor says otherwise
 * (evidence "secondary" = taken from a manufacturer data summary, with the note saying what exactly).
 * Values are generated, never measured: load comes from the flow simulation, noise is a fixed pseudo-signal.
 */

type Kind = "temp" | "current" | "vibration" | "pressure" | "flow" | "level" | "voltage" | "speed" | "other";
/** level + dir: move into the warning or alarm zone. to: set the reading to this multiple of nominal (a side effect of the same fault). */
type Band = { level?: "warn" | "alarm"; dir?: "hi" | "lo"; to?: number };

export type SensorDef = {
  id: string;
  label: string;
  unit: string;
  kind: Kind;
  nominal: number;
  /** inside = normal */
  normal: [number, number];
  /** outside = alarm, between normal and alarm = warning */
  alarm: [number, number];
  /** drawn axis */
  axis: [number, number];
  dec?: number;
  /** share of nominal while the machine is idle (1 = does not depend on load) */
  idle?: number;
  noise?: number;
  evidence: Confidence;
  note?: string;
  /** rises with lost cooling */
  cooled?: boolean;
  /** drops with lost compressed air */
  air?: boolean;
  /** only present on machines that receive this supply; drops into the warning zone when it is lost upstream */
  supply?: Net;
  /** the band before the idle adjustment (used to judge values forced by a scenario) */
  base?: { normal: [number, number]; alarm: [number, number] };
  /** how a failure scenario shows up here */
  fx?: Record<string, Band>;
  /** special signals taken from the simulation instead of the load model */
  signal?: "press_force" | "agv_speed" | "agv_battery" | "belt_speed";
};

const A: Confidence = "assumed";

const GENERIC: SensorDef[] = [
  { id: "cur", label: "주 전류", unit: "A", kind: "current", nominal: 6, normal: [3, 9], alarm: [0.5, 12], axis: [0, 15], dec: 1, idle: 0.3, noise: 0.03, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
  { id: "tmp", label: "표면 온도", unit: "°C", kind: "temp", nominal: 38, normal: [28, 48], alarm: [20, 60], axis: [10, 80], dec: 1, idle: 0.75, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
];

const BY_TYPE: Record<string, SensorDef[]> = {
  laser_cutter: [
    { id: "win", label: "보호창 투과율", unit: "%", kind: "other", nominal: 98, normal: [92, 100], alarm: [80, 101], axis: [60, 105], dec: 0, noise: 0.004, evidence: A, note: "광학 보호창이 얼마나 깨끗한지를 나타내는 가정 지표", fx: { lens_contamination: { level: "warn", dir: "lo" }, optics_overtemp: { level: "alarm", dir: "lo" } } },
    { id: "lens", label: "렌즈 온도", unit: "°C", kind: "temp", nominal: 32, normal: [25, 40], alarm: [20, 50], axis: [10, 70], dec: 1, idle: 0.85, noise: 0.01, cooled: true, evidence: A, fx: { lens_contamination: { level: "warn", dir: "hi" }, optics_overtemp: { level: "alarm", dir: "hi" } } },
    { id: "cur", label: "주 전류", unit: "A", kind: "current", nominal: 48, normal: [30, 62], alarm: [3, 75], axis: [0, 90], dec: 0, idle: 0.2, noise: 0.03, evidence: A },
  ],
  press_brake: [
    { id: "air", label: "공급 공기압", unit: "bar", kind: "pressure", nominal: 6.5, normal: [6.0, 7.0], alarm: [5.0, 7.8], axis: [0, 10], dec: 1, noise: 0.01, air: true, evidence: A },
    { id: "hyd", label: "유압 압력", unit: "bar", kind: "pressure", nominal: 210, normal: [195, 225], alarm: [170, 240], axis: [120, 260], dec: 0, noise: 0.01, evidence: A, fx: { hydraulic_pressure_drop: { level: "warn", dir: "lo" } } },
    { id: "force", label: "프레스 힘", unit: "kN", kind: "other", nominal: 420, normal: [0, 600], alarm: [0, 1300], axis: [0, 1400], dec: 0, evidence: "secondary", signal: "press_force", note: "정격 1,300 kN은 TruBend 5130 사양, 벤딩 중 힘(약 420 kN)은 3 mm 연강 가정" },
    { id: "oil", label: "유압 오일 온도", unit: "°C", kind: "temp", nominal: 46, normal: [38, 55], alarm: [30, 65], axis: [20, 80], dec: 1, idle: 0.85, noise: 0.01, evidence: A },
    { id: "bg", label: "백게이지 위치 오차", unit: "mm", kind: "other", nominal: 0.02, normal: [0, 0.1], alarm: [0, 0.3], axis: [0, 0.5], dec: 2, noise: 0.3, evidence: A, fx: { backgauge_fault: { level: "alarm", dir: "hi" } } },
  ],
  deburring: [
    { id: "cur", label: "모터 전류", unit: "A", kind: "current", nominal: 9, normal: [6, 12], alarm: [1, 15], axis: [0, 20], dec: 1, idle: 0.3, noise: 0.03, evidence: A, fx: { motor_overload: { level: "alarm", dir: "hi" } } },
    { id: "vib", label: "진동", unit: "mm/s", kind: "vibration", nominal: 2.4, normal: [0.8, 3.5], alarm: [0, 5.5], axis: [0, 8], dec: 1, idle: 0.3, noise: 0.06, evidence: A, fx: { belt_wear: { level: "warn", dir: "hi" } } },
  ],
  washer_dryer: [
    { id: "air", label: "공급 공기압", unit: "bar", kind: "pressure", nominal: 6.5, normal: [6.0, 7.0], alarm: [5.0, 7.8], axis: [0, 10], dec: 1, noise: 0.01, air: true, evidence: A },
    { id: "tmp", label: "세척액 온도", unit: "°C", kind: "temp", nominal: 60, normal: [55, 65], alarm: [45, 72], axis: [30, 85], dec: 1, noise: 0.005, evidence: A, fx: { temp_low: { level: "warn", dir: "lo" } } },
    { id: "pump", label: "펌프 압력", unit: "bar", kind: "pressure", nominal: 3.2, normal: [2.6, 3.8], alarm: [1.5, 4.5], axis: [0, 6], dec: 1, idle: 0.85, noise: 0.02, evidence: A, fx: { pump_failure: { level: "alarm", dir: "lo" } } },
    { id: "heat", label: "히터 전력", unit: "kW", kind: "current", nominal: 12, normal: [4, 16], alarm: [0, 18.5], axis: [0, 22], dec: 1, idle: 0.35, noise: 0.03, evidence: "secondary", note: "히터 정격 18 kW는 딜러 리스팅, 운전 중 값은 가정" },
  ],
  robot_arm: [
    { id: "air", label: "공급 공기압", unit: "bar", kind: "pressure", nominal: 6.5, normal: [6.0, 7.0], alarm: [5.0, 7.8], axis: [0, 10], dec: 1, noise: 0.01, air: true, evidence: A },
    { id: "vib", label: "진동", unit: "mm/s", kind: "vibration", nominal: 2.1, normal: [0.8, 3.0], alarm: [0, 4.5], axis: [0, 7], dec: 1, idle: 0.35, noise: 0.05, evidence: A, note: "메인 앱 데모의 기준값(2.1)과 같음", fx: { bearing_wear: { level: "alarm", dir: "hi" }, motor_overload: { to: 1.35 } } },
    { id: "cur", label: "전류", unit: "A", kind: "current", nominal: 12.8, normal: [6, 16], alarm: [0.5, 22], axis: [0, 28], dec: 1, idle: 0.3, noise: 0.03, evidence: A, note: "메인 앱 데모의 기준값(12.8)과 같음", fx: { motor_overload: { level: "alarm", dir: "hi" }, bearing_wear: { to: 1.19 } } },
    { id: "tmp", label: "모터 온도", unit: "°C", kind: "temp", nominal: 48, normal: [35, 58], alarm: [25, 72], axis: [15, 90], dec: 1, idle: 0.7, noise: 0.01, cooled: true, evidence: A, note: "메인 앱 데모의 기준값(48)과 같음", fx: { bearing_wear: { to: 1.13 }, motor_overload: { to: 1.05 } } },
    { id: "gas", label: "보호가스 압력", unit: "bar", kind: "pressure", nominal: 4.5, normal: [3.8, 5.2], alarm: [2.5, 6.2], axis: [0, 8], dec: 1, noise: 0.01, supply: "gas", evidence: A },
  ],
  robot_controller: [
    { id: "cab", label: "캐비닛 온도", unit: "°C", kind: "temp", nominal: 34, normal: [25, 42], alarm: [18, 52], axis: [10, 70], dec: 1, idle: 0.85, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
    { id: "cur", label: "입력 전류", unit: "A", kind: "current", nominal: 5, normal: [2, 8], alarm: [0.3, 11], axis: [0, 14], dec: 1, idle: 0.4, noise: 0.03, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
  ],
  positioner_2station: [
    { id: "cur", label: "서보 전류", unit: "A", kind: "current", nominal: 4, normal: [0.5, 7], alarm: [0.2, 10], axis: [0, 12], dec: 1, idle: 0.15, noise: 0.04, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
    { id: "tmp", label: "서보 모터 온도", unit: "°C", kind: "temp", nominal: 42, normal: [30, 55], alarm: [22, 68], axis: [10, 85], dec: 1, idle: 0.75, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
  ],
  weld_power_source: [
    { id: "amp", label: "용접 전류", unit: "A", kind: "current", nominal: 190, normal: [150, 230], alarm: [0, 300], axis: [0, 460], dec: 0, idle: 0.0, noise: 0.025, evidence: "secondary", note: "정격 450 A / 36.5 V는 Power Wave R450 사양, 작업 전류(약 190 A)는 3 mm 연강 가정", fx: { arc_fault: { level: "alarm", dir: "hi" } } },
    { id: "volt", label: "아크 전압", unit: "V", kind: "voltage", nominal: 24, normal: [21, 27], alarm: [0, 33], axis: [0, 38], dec: 1, idle: 0.0, noise: 0.02, evidence: A },
    { id: "wire", label: "와이어 송급 속도", unit: "m/min", kind: "speed", nominal: 8, normal: [6.5, 9.5], alarm: [3, 12], axis: [0, 14], dec: 1, idle: 0.0, noise: 0.02, evidence: A, fx: { wire_feed_fault: { level: "warn", dir: "lo" } } },
    { id: "tmp", label: "전원부 온도", unit: "°C", kind: "temp", nominal: 52, normal: [35, 68], alarm: [25, 82], axis: [15, 100], dec: 1, idle: 0.6, noise: 0.01, cooled: true, evidence: A },
    { id: "gas", label: "보호가스 압력", unit: "bar", kind: "pressure", nominal: 4.5, normal: [3.8, 5.2], alarm: [2.5, 6.2], axis: [0, 8], dec: 1, noise: 0.01, supply: "gas", evidence: A },
  ],
  inspection_station: [
    { id: "cal", label: "교정 편차", unit: "µm", kind: "other", nominal: 4, normal: [0, 10], alarm: [0, 25], axis: [0, 40], dec: 0, noise: 0.15, evidence: A, fx: { calibration_lost: { level: "alarm", dir: "hi" } } },
    { id: "lux", label: "조도", unit: "%", kind: "other", nominal: 98, normal: [90, 105], alarm: [70, 110], axis: [0, 120], dec: 0, noise: 0.01, evidence: A, fx: { camera_dirty: { level: "warn", dir: "lo" } } },
    { id: "cur", label: "입력 전류", unit: "A", kind: "current", nominal: 7, normal: [3, 12], alarm: [0.3, 16], axis: [0, 20], dec: 1, idle: 0.5, noise: 0.03, evidence: "secondary", note: "ScanBox 5110 사양의 전원 16 A를 한계로 사용, 운전 전류는 가정" },
  ],
  laser_marker: [
    { id: "tmp", label: "레이저 헤드 온도", unit: "°C", kind: "temp", nominal: 30, normal: [24, 38], alarm: [18, 48], axis: [10, 65], dec: 1, idle: 0.85, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
    { id: "cur", label: "주 전류", unit: "A", kind: "current", nominal: 3.5, normal: [1, 6], alarm: [0.2, 9], axis: [0, 12], dec: 1, idle: 0.3, noise: 0.03, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
  ],
  torch_cleaner: [...GENERIC, { id: "airin", label: "공급 공기압", unit: "bar", kind: "pressure", nominal: 6.5, normal: [6.0, 7.0], alarm: [5.0, 7.8], axis: [0, 10], dec: 1, noise: 0.01, supply: "air", evidence: A },],
  fume_hood: [
    { id: "flow", label: "흡입 풍량", unit: "m³/h", kind: "flow", nominal: 900, normal: [750, 1050], alarm: [500, 1300], axis: [0, 1600], dec: 0, noise: 0.02, supply: "exhaust", evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
    { id: "tmp", label: "후드 표면 온도", unit: "°C", kind: "temp", nominal: 45, normal: [30, 70], alarm: [20, 95], axis: [10, 120], dec: 1, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
  ],
  packing_station: [...GENERIC, { id: "air", label: "공급 공기압", unit: "bar", kind: "pressure", nominal: 6.5, normal: [6.0, 7.0], alarm: [5.0, 7.8], axis: [0, 10], dec: 1, noise: 0.01, air: true, evidence: A }],
  chiller: [
    { id: "sup", label: "공급 온도", unit: "°C", kind: "temp", nominal: 20, normal: [19.5, 20.5], alarm: [17, 23], axis: [10, 30], dec: 1, noise: 0.008, evidence: "secondary", note: "설정 5~35 °C·안정도 ±0.5 °C는 SMC HRS090 사양, 설정값 20 °C와 경보 한계(±3 °C)는 가정", fx: { temp_high: { level: "warn", dir: "hi" }, flow_low: { level: "warn", dir: "hi" } } },
    { id: "flow", label: "순환 유량", unit: "L/min", kind: "flow", nominal: 22, normal: [18, 26], alarm: [10, 32], axis: [0, 40], dec: 0, noise: 0.02, evidence: A, fx: { flow_low: { level: "alarm", dir: "lo" } } },
    { id: "pres", label: "토출 압력", unit: "bar", kind: "pressure", nominal: 0.45, normal: [0.35, 0.55], alarm: [0.2, 0.65], axis: [0, 0.8], dec: 2, noise: 0.03, evidence: A },
  ],
  power_panel: [
    { id: "volt", label: "메인 전압 (선간)", unit: "V", kind: "voltage", nominal: 400, normal: [380, 420], alarm: [340, 440], axis: [0, 480], dec: 0, noise: 0.004, evidence: A, fx: { breaker_trip: { level: "alarm", dir: "lo" } } },
    { id: "cur", label: "총 부하 전류", unit: "A", kind: "current", nominal: 330, normal: [150, 520], alarm: [20, 640], axis: [0, 800], dec: 0, idle: 0.5, noise: 0.02, evidence: A },
    { id: "unb", label: "상 불평형", unit: "%", kind: "other", nominal: 0.8, normal: [0, 2], alarm: [0, 4], axis: [0, 6], dec: 1, noise: 0.15, evidence: A, fx: { phase_imbalance: { level: "warn", dir: "hi" } } },
  ],
  compressor: [
    { id: "pres", label: "토출 압력", unit: "bar", kind: "pressure", nominal: 7.5, normal: [7.0, 8.0], alarm: [5.5, 8.8], axis: [0, 10], dec: 1, noise: 0.01, evidence: A, fx: { pressure_low: { level: "alarm", dir: "lo" } } },
    { id: "oil", label: "오일 온도", unit: "°C", kind: "temp", nominal: 78, normal: [65, 90], alarm: [50, 105], axis: [30, 120], dec: 0, idle: 0.8, noise: 0.01, evidence: A, fx: { oil_temp_high: { level: "warn", dir: "hi" } } },
    { id: "cur", label: "모터 전류", unit: "A", kind: "current", nominal: 58, normal: [20, 70], alarm: [2, 85], axis: [0, 100], dec: 0, idle: 0.4, noise: 0.03, evidence: A },
  ],
  air_dryer: [
    { id: "dew", label: "압력 이슬점", unit: "°C", kind: "temp", nominal: 3, normal: [1, 5], alarm: [-2, 10], axis: [-10, 20], dec: 1, noise: 0.08, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
    { id: "airin", label: "공급 공기압", unit: "bar", kind: "pressure", nominal: 6.5, normal: [6.0, 7.0], alarm: [5.0, 7.8], axis: [0, 10], dec: 1, noise: 0.01, supply: "air", evidence: A },
    { id: "cur", label: "냉동기 전류", unit: "A", kind: "current", nominal: 4.5, normal: [2, 7], alarm: [0.3, 10], axis: [0, 14], dec: 1, idle: 0.5, noise: 0.03, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
  ],
  air_receiver: [
    { id: "pres", label: "탱크 압력", unit: "bar", kind: "pressure", nominal: 7.2, normal: [6.6, 7.8], alarm: [5, 8.6], axis: [0, 10], dec: 1, noise: 0.01, evidence: A, air: true, fx: { stop: { level: "alarm", dir: "lo" } } },
    { id: "tmp", label: "탱크 표면 온도", unit: "°C", kind: "temp", nominal: 38, normal: [25, 50], alarm: [15, 65], axis: [10, 80], dec: 1, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
  ],
  gas_manifold: [
    { id: "lvl", label: "보호가스 잔량", unit: "%", kind: "level", nominal: 72, normal: [30, 100], alarm: [10, 100], axis: [0, 100], dec: 0, evidence: A, fx: { gas_low: { level: "warn", dir: "lo" }, gas_out: { level: "alarm", dir: "lo" } } },
    { id: "out", label: "출구 압력", unit: "bar", kind: "pressure", nominal: 4.5, normal: [3.8, 5.2], alarm: [2.5, 6.2], axis: [0, 8], dec: 1, noise: 0.01, evidence: A },
  ],
  dust_collector: [
    { id: "dp", label: "필터 차압", unit: "Pa", kind: "pressure", nominal: 900, normal: [500, 1400], alarm: [200, 1900], axis: [0, 2400], dec: 0, noise: 0.02, evidence: A, fx: { filter_clogged: { level: "warn", dir: "hi" } } },
    { id: "cur", label: "팬 전류", unit: "A", kind: "current", nominal: 14, normal: [9, 18], alarm: [1, 23], axis: [0, 30], dec: 1, idle: 0.6, noise: 0.02, evidence: A, fx: { fan_failure: { level: "alarm", dir: "lo" } } },
  ],
  control_room: [
    { id: "tmp", label: "실내 온도", unit: "°C", kind: "temp", nominal: 23, normal: [20, 26], alarm: [16, 31], axis: [10, 40], dec: 1, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
    { id: "cur", label: "공조 전류", unit: "A", kind: "current", nominal: 9, normal: [4, 13], alarm: [0.5, 17], axis: [0, 24], dec: 1, idle: 0.6, noise: 0.03, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
  ],
  conveyor: [
    { id: "spd", label: "벨트 속도", unit: "m/s", kind: "speed", nominal: 0.25, normal: [0.22, 0.28], alarm: [0.1, 0.34], axis: [0, 0.4], dec: 2, noise: 0.01, evidence: A, signal: "belt_speed", note: "흐름 시뮬레이션의 이송 속도(가정)와 같음", fx: { stop: { level: "alarm", dir: "lo" } } },
    { id: "cur", label: "구동 모터 전류", unit: "A", kind: "current", nominal: 2.2, normal: [1.2, 3.2], alarm: [0.1, 4.5], axis: [0, 6], dec: 1, idle: 0.6, noise: 0.03, evidence: A },
  ],
  agv: [
    { id: "spd", label: "주행 속도", unit: "m/s", kind: "speed", nominal: 1.0, normal: [0, 1.2], alarm: [0, 2.0], axis: [0, 2.2], dec: 2, evidence: "secondary", signal: "agv_speed", note: "최고 2.0 m/s는 MiR250 사양(무부하 평지), 시뮬레이션에서는 1 m/s로 달림(가정)" },
    { id: "cur", label: "구동 모터 전류", unit: "A", kind: "current", nominal: 6, normal: [1, 10], alarm: [0.4, 14], axis: [0, 20], dec: 1, idle: 0.3, noise: 0.03, evidence: A, fx: { stop: { level: "alarm", dir: "lo" } } },
    { id: "tmp", label: "구동 모터 온도", unit: "°C", kind: "temp", nominal: 40, normal: [28, 52], alarm: [20, 65], axis: [10, 85], dec: 1, noise: 0.01, evidence: A, fx: { overheat: { level: "warn", dir: "hi" } } },
    { id: "bat", label: "배터리", unit: "%", kind: "level", nominal: 82, normal: [30, 100], alarm: [12, 100], axis: [0, 100], dec: 0, evidence: A, signal: "agv_battery", note: "시간에 따라 천천히 줄었다가 충전되는 가정 곡선" },
  ],
};

const INPUT_VOLT: SensorDef = { id: "vin", label: "입력 전압", unit: "V", kind: "voltage", nominal: 400, normal: [380, 420], alarm: [340, 440], axis: [0, 480], dec: 0, noise: 0.004, evidence: A, note: "3상 400 V 가정" };

/** A reading at rest must not look like a fault: widen the normal band down to the machine's idle level. */
const settled = (d: SensorDef): SensorDef => {
  const rest = d.nominal * (d.idle ?? 1) * 0.85;
  if (rest >= d.normal[0] || d.signal !== undefined) return d;
  return { ...d, base: { normal: d.normal, alarm: d.alarm }, normal: [rest, d.normal[1]], alarm: [Math.min(d.alarm[0], rest * 0.5), d.alarm[1]] };
};
const cache = new Map<string, SensorDef[]>();
const SUPPLY_EDGES = effectiveEdges(["power", "cooling", "air", "gas", "exhaust"]);

export const sensorsOf = (e: Instance): SensorDef[] => {
  const hit = cache.get(e.id);
  if (hit) return hit;
  const base = BY_TYPE[e.type] ?? (["raw_rack", "stock", "fixture", "reject_bin"].includes(e.type) ? [] : GENERIC);
  const own = base.filter((d) => !d.supply || SUPPLY_EDGES.some((x) => x.to === e.id && x.net === d.supply));
  const powered = typeOf(e).consumes?.includes("power") && e.type !== "power_panel";
  const out = [...own, ...(powered && own.length ? [INPUT_VOLT] : [])].map(settled);
  cache.set(e.id, out);
  return out;
};

export type Reading = { def: SensorDef; value: number; status: Status };

const pn = (t: number, seed: number) => 0.55 * Math.sin(t * 1.7 + seed) + 0.45 * Math.sin(t * 0.63 + seed * 2.3);
const seedOf = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const classify = (d: SensorDef, v: number, forced = false): Status => {
  const normal = forced && d.base ? d.base.normal : d.normal;
  const alarm = forced && d.base ? d.base.alarm : d.alarm;
  if (v < alarm[0] || v > alarm[1]) return "abnormal";
  if (v < normal[0] || v > normal[1]) return "warning";
  return "normal";
};

export type SensorCtx = { act: Act; work?: Act | null; res: Resolved; t: number; agvSpeed?: number };

/** The act the machine's own load follows: a weld source works when the positioner of the welding robot does. */
export const workActFor = (e: Instance, acts: Record<string, Act>): Act | null => {
  if (e.type !== "weld_power_source") return null;
  const robot = profile.equipment.find((r) => r.type === "robot_arm" && r.process_step === "welding");
  const f = robot ? fixtureFor(robot) : null;
  return f ? acts[f.id] ?? null : null;
};

export function readSensors(e: Instance, ctx: SensorCtx): Reading[] {
  const { act, res, t } = ctx;
  const loadAct = ctx.work ?? act;
  const busy = loadAct.busy ? 1 : 0;
  const pressStroke = (() => {
    if (!act.busy || act.progress <= 0.1 || act.progress >= 0.9) return 0;
    return 0.5 * (1 - Math.cos(4 * Math.PI * ((act.progress - 0.1) / 0.8)));
  })();
  return sensorsOf(e).map((def) => {
    const seed = seedOf(e.id + def.id);
    let v: number;
    if (def.signal === "press_force") v = def.nominal * pressStroke;
    else if (def.signal === "agv_speed") v = ctx.agvSpeed ?? 0;
    else if (def.signal === "agv_battery") v = 100 - ((t * 0.05 + seed) % 65);
    else if (def.signal === "belt_speed") v = def.nominal;
    else {
      const idle = def.idle ?? 1;
      v = def.nominal * (idle + (1 - idle) * busy);
    }
    if (def.noise && def.signal !== "agv_speed") v *= 1 + def.noise * pn(t, seed);

    // a failure scenario on this machine pushes the matching sensor into its warning or alarm zone
    const fx = res.own ? def.fx?.[res.own.id] : undefined;
    let forced = false;
    if (fx?.to !== undefined) {
      v = def.nominal * fx.to * (1 + Math.min(def.noise ?? 0.01, 0.01) * pn(t * 1.3, seed + 1));
      forced = true;
    } else if (fx?.level && fx.dir) {
      const hi = fx.dir === "hi";
      const band = def.base ?? { normal: def.normal, alarm: def.alarm };
      const edge = hi ? band.normal[1] : band.normal[0];
      const lim = hi ? band.alarm[1] : band.alarm[0];
      if (fx.level === "warn") v = (edge + lim) / 2;
      else v = hi ? lim + (lim - edge) * 0.25 : Math.max(0, lim - (edge - lim) * 0.35);
      v *= 1 + Math.min(def.noise ?? 0.01, 0.02) * pn(t * 1.3, seed + 1);
      forced = true;
    }

    // knock-on effects from a lost supply
    if (!forced && res.cause) {
      if (res.cause.net === "power") {
        if (def.kind === "temp") v = 27 + (v - 27) * 0.35;
        else if (def.kind !== "level") v *= 0.02;
      } else if (res.cause.net === "cooling" && def.cooled) v = Math.max(v, (def.normal[1] + def.alarm[1]) / 2);
      else if (res.cause.net === "air" && (def.air || def.supply === "air")) v = (def.normal[0] + def.alarm[0]) / 2;
      else if (def.supply && def.supply === res.cause.net) v = (def.normal[0] + def.alarm[0]) / 2;
    }
    // a stopped machine draws no current and does not move
    if (!forced && res.status === "abnormal" && !res.cause && ["current", "speed", "vibration", "flow"].includes(def.kind)) v *= 0.03;
    // a slowed machine runs slower
    if (!forced && res.status === "warning" && def.kind === "speed" && def.signal !== "agv_speed") v *= 0.6;

    v = clamp(v, 0, def.axis[1] * 1.2);
    return { def, value: v, status: classify(def, v, forced) };
  });
}

export const worstOf = (rs: Reading[]): Status => (rs.some((r) => r.status === "abnormal") ? "abnormal" : rs.some((r) => r.status === "warning") ? "warning" : "normal");
