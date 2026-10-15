"use client";

import { useState } from "react";
import {
  SCENARIOS,
  STRENGTHS,
  type Equipment,
  type Scenario,
  type Strength,
} from "@/data/demo";
import { profile } from "@/data/factoryProfile";
import { nameOf, scenariosOf } from "@/data/plantStatus";
import type { Injected } from "@/data/plantState";

export type InjectRequest = {
  equipmentId: string;
  scenario: Scenario;
  strength: Strength;
};

type Props = {
  equipment: Equipment[];
  onInject: (req: InjectRequest) => void;
  onReset: () => void;
  /** faults injected on the plant (shared with /lab/plant); the sensor monitor reacts to them */
  plantInjected: Injected;
  onPlantInject: (equipmentId: string, scenarioId: string | null) => void;
};

export function InjectorView({ equipment, onInject, onReset, plantInjected, onPlantInject }: Props) {
  const [equipmentId, setEquipmentId] = useState("robot_03");
  const [scenario, setScenario] = useState<Scenario>("bearing_wear");
  const [strength, setStrength] = useState<Strength>("중");
  // sensor path: any machine on the line, with the faults of its type (plantStatus.ts)
  const plantMachines = profile.equipment.filter((e) => e.type !== "conveyor");
  const [plantId, setPlantId] = useState("chiller_01");
  const plantType = plantMachines.find((e) => e.id === plantId)?.type ?? "chiller";
  const plantScenarios = scenariosOf(plantType);
  const [plantScenario, setPlantScenario] = useState("flow_low");
  const plantScenarioId = plantScenarios.some((s) => s.id === plantScenario) ? plantScenario : plantScenarios[0].id;
  const active = Object.entries(plantInjected);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface p-4 text-ink-1">
      <h2 className="mb-4 text-sm font-semibold">시나리오 주입</h2>
      <div className="flex max-w-sm flex-col gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">장비</span>
          <select
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            className="rounded border border-line bg-surface px-2 py-2 outline-none focus:border-primary"
          >
            {equipment.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.nameKo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">시나리오</span>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as Scenario)}
            className="rounded border border-line bg-surface px-2 py-2 outline-none focus:border-primary"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">강도</span>
          <div className="flex gap-1">
            {STRENGTHS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStrength(s)}
                className={`flex-1 rounded border px-3 py-2 ${
                  strength === s
                    ? "border-primary bg-primary-subtle font-medium text-primary"
                    : "border-line bg-surface text-ink-2 hover:border-ink-3"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onInject({ equipmentId, scenario, strength })}
          className="rounded-md border border-primary bg-primary px-3 py-2 font-medium text-ink-1 hover:bg-primary/90"
        >
          주입
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink-1 hover:border-ink-3"
          >
            초기화
          </button>
          <span className="text-xs text-ink-2">이력은 유지돼요</span>
        </div>
      </div>

      <h2 className="mb-1 mt-8 text-sm font-semibold">센서 경로 주입</h2>
      <p className="mb-3 max-w-md text-xs text-ink-2">
        라인의 설비에 고장을 걸면 센서 값이 바뀌고, 센서 감시가 이를 읽어 Rule Engine에 넘겨 경보를 만들어요. 로봇 3대가 대상이고, 칠러·전원반 같은 공급 설비의 고장은 연결된 로봇에 퍼져요. (/lab/plant와 같은 상태를 공유)
      </p>
      <div className="flex max-w-sm flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">설비</span>
          <select
            value={plantId}
            onChange={(e) => setPlantId(e.target.value)}
            className="rounded border border-line bg-surface px-2 py-2 outline-none focus:border-primary"
          >
            {plantMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {nameOf(m.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">고장</span>
          <select
            value={plantScenarioId}
            onChange={(e) => setPlantScenario(e.target.value)}
            className="rounded border border-line bg-surface px-2 py-2 outline-none focus:border-primary"
          >
            {plantScenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.label} · {sc.status === "abnormal" ? "이상" : "주의"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPlantInject(plantId, plantScenarioId)}
          className="rounded-md border border-primary bg-primary px-3 py-2 font-medium text-ink-1 hover:bg-primary/90"
        >
          센서 경로로 주입
        </button>
        {active.length ? (
          <ul className="space-y-1 text-xs">
            {active.map(([id, sc]) => (
              <li key={id} className="flex items-center justify-between rounded border border-line px-2 py-1.5">
                <span>
                  {nameOf(id)} · {scenariosOf(profile.equipment.find((e) => e.id === id)?.type ?? "").find((x) => x.id === sc)?.label ?? sc}
                </span>
                <button type="button" onClick={() => onPlantInject(id, null)} className="text-primary underline">
                  복구
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-ink-2">걸어 둔 고장 없음</span>
        )}
      </div>
    </div>
  );
}
