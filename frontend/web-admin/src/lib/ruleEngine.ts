import type { CauseCandidate, Scenario, SensorDelta } from "@/data/demo";

export type RuleEngineInput = {
  equipmentId: string;
  /** "sensor" = the readings come from the live sensor monitor instead of a manual injection */
  scenario: Scenario | "none" | "sensor";
  sensorDeltas: SensorDelta[];
  anomalyScore: number;
};

export type RuleEngineOutput = {
  equipmentId: string;
  anomalyScore: number;
  abnormalSensors: string[];
  causeCandidates: CauseCandidate[];
};

const MIN_CONFIDENCE = 0.15;

const round2 = (n: number) => Math.round(n * 100) / 100;

const ACTIONS: Record<string, string[]> = {
  bearing_wear: ["베어링 하우징 점검", "라인 속도 일시 저하", "24시간 이내 정비 일정"],
  cooling_line: ["냉각라인 유량 확인"],
  motor_overload: ["부하 조건 확인", "모터 전류 제한 점검", "구동부 윤활 상태 확인"],
  power_supply: ["전원반 A 차단기 상태 확인", "전원 공급 복구 후 로봇 재기동 점검"],
};

/** Local stub Rule/Profile Engine: judgment only, no LLM. Deterministic from deltas. */
export function runRuleEngine(input: RuleEngineInput): RuleEngineOutput {
  if (input.scenario === "none") {
    return {
      equipmentId: input.equipmentId,
      anomalyScore: input.anomalyScore,
      abnormalSensors: [],
      causeCandidates: [],
    };
  }

  const get = (name: string) => input.sensorDeltas.find((d) => d.name === name);
  const v = get("진동");
  const c = get("전류");
  const t = get("온도");

  const keys = new Set<string>();
  if (v && v.changePct >= 30) keys.add("vibration_up");
  if (c && c.changePct >= 30) keys.add("current_spike");
  else if (c && c.changePct >= 15) keys.add("current_up");
  if (t && t.changePct >= 10) {
    keys.add(t.trend.includes("지연") ? "temperature_delayed_up" : "temperature_up");
  }

  const evidenceFor = (k: string): string => {
    if (k === "vibration_up" && v) return `진동 ${Math.round(v.changePct)}% 증가`;
    if ((k === "current_up" || k === "current_spike") && c)
      return `모터 전류 ${Math.round(c.changePct)}% ${k === "current_spike" ? "급등" : "증가"}`;
    if (k === "temperature_delayed_up") return "온도가 진동 상승 이후 지연 상승";
    if (k === "temperature_up" && t) return `온도 ${Math.round(t.changePct)}% 증가`;
    return k;
  };

  const bearingKeys = ["vibration_up", "current_up", "current_spike", "temperature_delayed_up"].filter(
    (k) => keys.has(k),
  );
  const coolingKeys = ["temperature_delayed_up", "temperature_up"].filter((k) => keys.has(k));
  // temperature rising on its own (no vibration or current change) points at the coolant, not the machine.
  // Added for the sensor monitor; none of the injected scenarios produces this pattern, so their scores are unchanged.
  const coolingOnly = keys.has("temperature_up") && !keys.has("vibration_up") && !keys.has("current_up") && !keys.has("current_spike");
  // current and vibration both gone: the machine is not being supplied (also new, also unreachable from the injector)
  const powerLost = !!(c && v && c.changePct <= -80 && v.changePct <= -80);
  const motorKeys = ["current_spike", "vibration_up"].filter((k) => keys.has(k));

  const raw: CauseCandidate[] = [
    {
      cause: "bearing_wear",
      causeKo: "베어링 마모",
      confidence: round2(0.3 + 0.16 * bearingKeys.length),
      evidenceKeys: bearingKeys,
      evidence: bearingKeys.map(evidenceFor),
      recommendedActions: ACTIONS.bearing_wear,
    },
    {
      cause: "cooling_line",
      causeKo: "냉각라인",
      confidence: coolingOnly ? 0.6 : coolingKeys.length ? 0.2 : 0.05,
      evidenceKeys: coolingKeys,
      evidence: coolingKeys.map(evidenceFor),
      recommendedActions: ACTIONS.cooling_line,
    },
    {
      cause: "motor_overload",
      causeKo: "모터 과부하",
      confidence: keys.has("current_spike")
        ? round2(0.5 + (keys.has("vibration_up") ? 0.2 : 0.1))
        : 0.1,
      evidenceKeys: motorKeys,
      evidence: motorKeys.map(evidenceFor),
      recommendedActions: ACTIONS.motor_overload,
    },
    {
      cause: "power_supply",
      causeKo: "전원 공급 중단",
      confidence: powerLost ? 0.75 : 0.05,
      evidenceKeys: powerLost ? ["current_lost", "vibration_lost"] : [],
      evidence: powerLost && c && v ? [`모터 전류 ${Math.round(c.changePct)}%`, `진동 ${Math.round(v.changePct)}%`] : [],
      recommendedActions: ACTIONS.power_supply,
    },
  ];

  const causeCandidates = raw
    .filter((cand) => cand.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    equipmentId: input.equipmentId,
    anomalyScore: input.anomalyScore,
    abnormalSensors: [
      ...(v && v.changePct >= 30 ? ["vibration"] : []),
      ...(c && c.changePct >= 15 ? ["current"] : []),
      ...(t && t.changePct >= 10 ? ["temperature"] : []),
    ],
    causeCandidates,
  };
}

/** Footer legend: 주의 ≥ 0.5, 이상 ≥ 0.7 on the top candidate score. */
export function statusFromCandidates(
  candidates: CauseCandidate[],
): "normal" | "warning" | "abnormal" {
  const top = candidates[0]?.confidence ?? 0;
  if (top >= 0.7) return "abnormal";
  if (top >= 0.5) return "warning";
  return "normal";
}
