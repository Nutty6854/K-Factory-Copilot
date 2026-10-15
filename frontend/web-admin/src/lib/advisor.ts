import type { CauseCandidate, SensorDelta } from "@/data/demo";

export type AdvisorInput = {
  equipmentNameKo: string;
  sensorDeltas: SensorDelta[];
  causeCandidates: CauseCandidate[];
};

export type AdvisorOutput = {
  summary: string;
  primaryCause: string;
  evidenceExplanation: string[];
  recommendedActions: string[];
  /** Echo of input candidate causes — never invent new ones */
  usedCauses: string[];
};

const EVIDENCE_KO: Record<string, string> = {
  vibration_up: "진동이 기준 대비 크게 증가했습니다.",
  current_up: "모터 전류가 기준 대비 증가했습니다.",
  temperature_delayed_up: "온도 상승이 진동 상승 이후 지연되어 나타났습니다.",
  current_spike: "모터 전류가 기준 대비 급등했습니다.",
  temperature_up: "온도가 기준 대비 상승했습니다.",
  current_lost: "모터 전류가 거의 사라졌습니다.",
  vibration_lost: "진동이 거의 사라졌습니다.",
};

/**
 * Advisor = explainer only.
 * Must not invent causes or change scores outside causeCandidates.
 */
export function explainWithAdvisor(input: AdvisorInput): AdvisorOutput {
  const primary = input.causeCandidates[0];
  if (!primary) {
    return {
      summary: `${input.equipmentNameKo}에 대한 원인 후보가 없습니다.`,
      primaryCause: "",
      evidenceExplanation: [],
      recommendedActions: [],
      usedCauses: [],
    };
  }

  const evidenceExplanation =
    primary.evidenceKeys?.map((k) => EVIDENCE_KO[k] ?? k).filter(Boolean) ??
    primary.evidence.map((e) => `${e}에 해당합니다.`);

  // Optionally mention deltas for context without inventing causes
  const deltaNotes = input.sensorDeltas.slice(0, 3).map(
    (d) => `${d.name} ${d.base}${d.unit} → ${d.current}${d.unit} (${d.changePct > 0 ? "+" : ""}${d.changePct}%).`,
  );

  return {
    summary: `${input.equipmentNameKo}에서 ${primary.causeKo} 가능성이 가장 높습니다. (신뢰도 ${primary.confidence.toFixed(2)})`,
    primaryCause: primary.causeKo,
    evidenceExplanation: [
      ...evidenceExplanation,
      ...deltaNotes.slice(0, 0), // keep evidence keys primary; deltas already in panel
    ],
    recommendedActions: [...primary.recommendedActions],
    usedCauses: input.causeCandidates.map((c) => c.cause),
  };
}

export function assertAdvisorRespectsCandidates(
  output: AdvisorOutput,
  candidates: CauseCandidate[],
): boolean {
  const allowed = new Set(candidates.map((c) => c.cause));
  const allowedKo = new Set(candidates.map((c) => c.causeKo));
  if (output.primaryCause && !allowedKo.has(output.primaryCause)) return false;
  return output.usedCauses.every((c) => allowed.has(c));
}
