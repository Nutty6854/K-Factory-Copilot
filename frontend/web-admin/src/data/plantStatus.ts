import { effectiveEdges, equipmentById, profile, type Net } from "@/data/factoryProfile";

/*
 * Demo status layer for the whole line. Nothing here comes from a real machine: the scenarios are
 * plausible failure modes we made up per machine type so the UI can show "what happens downstream".
 * Which machine feeds which comes from the factory profile (effectiveEdges), not from this file.
 */

export type Status = "normal" | "warning" | "abnormal";

export type Scenario = { id: string; label: string; status: Exclude<Status, "normal">; effect: string };

const GENERIC: Scenario[] = [
  { id: "overheat", label: "과열 경고", status: "warning", effect: "온도 상승, 부하 제한" },
  { id: "stop", label: "정지 (알람)", status: "abnormal", effect: "설비 정지" },
];

const BY_TYPE: Record<string, Scenario[]> = {
  laser_cutter: [
    { id: "lens_contamination", label: "렌즈 오염", status: "warning", effect: "절단 품질 저하" },
    { id: "optics_overtemp", label: "광학계 과열 정지", status: "abnormal", effect: "절단 중단" },
  ],
  press_brake: [
    { id: "hydraulic_pressure_drop", label: "유압 압력 저하", status: "warning", effect: "벤딩 각도 편차" },
    { id: "backgauge_fault", label: "백게이지 이상", status: "abnormal", effect: "벤딩 중단" },
  ],
  deburring: [
    { id: "belt_wear", label: "연마 벨트 마모", status: "warning", effect: "버 제거 불량 증가" },
    { id: "motor_overload", label: "모터 과부하", status: "abnormal", effect: "설비 정지" },
  ],
  washer_dryer: [
    { id: "temp_low", label: "세척액 온도 저하", status: "warning", effect: "세척 품질 저하" },
    { id: "pump_failure", label: "펌프 고장", status: "abnormal", effect: "세척 중단" },
  ],
  robot_arm: [
    { id: "bearing_wear", label: "베어링 마모", status: "abnormal", effect: "진동이 크게 증가, 정비 필요" },
    { id: "motor_overload", label: "모터 과부하", status: "abnormal", effect: "로봇 정지" },
  ],
  weld_power_source: [
    { id: "wire_feed_fault", label: "와이어 송급 불량", status: "warning", effect: "비드 불량 위험" },
    { id: "arc_fault", label: "아크 이상", status: "abnormal", effect: "용접 중단" },
  ],
  inspection_station: [
    { id: "camera_dirty", label: "카메라 오염", status: "warning", effect: "오검출 증가" },
    { id: "calibration_lost", label: "교정 이탈", status: "abnormal", effect: "판정 중단" },
  ],
  chiller: [
    { id: "temp_high", label: "냉각수 온도 상승", status: "warning", effect: "냉각 여유 감소" },
    { id: "flow_low", label: "냉각수 유량 저하", status: "abnormal", effect: "냉각 공급 중단" },
  ],
  power_panel: [
    { id: "phase_imbalance", label: "상 불평형", status: "warning", effect: "전압 변동" },
    { id: "breaker_trip", label: "메인 차단기 트립", status: "abnormal", effect: "전원 공급 중단" },
  ],
  compressor: [
    { id: "pressure_low", label: "토출 압력 저하", status: "abnormal", effect: "압축공기 공급 부족" },
    { id: "oil_temp_high", label: "오일 온도 상승", status: "warning", effect: "과열 위험" },
  ],
  gas_manifold: [
    { id: "gas_low", label: "보호가스 잔량 부족", status: "warning", effect: "용접 품질 저하" },
    { id: "gas_out", label: "보호가스 소진", status: "abnormal", effect: "가스 공급 중단" },
  ],
  dust_collector: [
    { id: "filter_clogged", label: "필터 막힘", status: "warning", effect: "흡입력 저하" },
    { id: "fan_failure", label: "팬 고장", status: "abnormal", effect: "집진 중단" },
  ],
};

export const scenariosOf = (type: string): Scenario[] => BY_TYPE[type] ?? GENERIC;

export type Cause = { from: string; scenario: Scenario; net: Net | null; pending: boolean };
export type Resolved = { status: Status; own: Scenario | null; cause: Cause | null };

const RANK: Record<Status, number> = { normal: 0, warning: 1, abnormal: 2 };
// a lost supply stops machines that need electricity; the other utilities degrade them
const POWER_LOSS_STATUS: Record<Net, Status> = { power: "abnormal", cooling: "warning", air: "warning", gas: "warning", exhaust: "warning", signal: "normal", bundle: "normal" };

const EDGES = effectiveEdges(["power", "cooling", "air", "gas", "exhaust"]);

/** injected: equipment id → scenario id. Returns every machine's status, with the cause when it is a knock-on effect. */
export function resolveStatus(injected: Record<string, string>): Record<string, Resolved> {
  const out: Record<string, Resolved> = {};
  for (const e of profile.equipment) {
    const sc = injected[e.id] ? scenariosOf(e.type).find((s) => s.id === injected[e.id]) ?? null : null;
    out[e.id] = { status: sc ? sc.status : "normal", own: sc, cause: null };
  }
  // propagate: an abnormal supplier degrades what it feeds, until nothing changes
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;
    for (const edge of EDGES) {
      const src = out[edge.from];
      const dst = out[edge.to];
      if (!src || !dst || src.status !== "abnormal") continue;
      const next = POWER_LOSS_STATUS[edge.net];
      if (RANK[next] > RANK[dst.status]) {
        const root = src.own ? { from: edge.from, scenario: src.own } : src.cause ? { from: src.cause.from, scenario: src.cause.scenario } : null;
        if (!root) continue;
        dst.status = next;
        dst.cause = { ...root, net: edge.net, pending: edge.status === "needs_confirmation" };
        changed = true;
      }
    }
  }
  return out;
}

export const STATUS_KO: Record<Status, string> = { normal: "정상", warning: "주의", abnormal: "이상" };

export const nameOf = (id: string) => {
  const e = equipmentById(id);
  // some machines carry no label title (positioner, fume hood): fall back to their type name rather than an empty string
  return e?.name_ko || e?.label?.title || (e ? profile.catalog[e.type]?.name_ko : "") || id;
};
