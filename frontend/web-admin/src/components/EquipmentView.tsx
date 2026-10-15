"use client";

import type { Equipment } from "@/data/demo";

type Props = {
  equipment: Equipment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const STATUS_CHIP = {
  normal: "bg-primary-subtle text-normal border-normal/30",
  warning: "bg-warn-subtle text-warn border-warn/30",
  abnormal: "bg-danger-subtle text-danger border-danger/30",
} as const;

const STATUS_KO = {
  normal: "정상",
  warning: "주의",
  abnormal: "이상",
} as const;

export function EquipmentView({ equipment, selectedId, onSelect }: Props) {
  const counts = {
    normal: equipment.filter((e) => e.status === "normal").length,
    warning: equipment.filter((e) => e.status === "warning").length,
    abnormal: equipment.filter((e) => e.status === "abnormal").length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface p-4 text-ink-1">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">라인 A · 장비</h2>
        <div className="flex gap-1.5 text-xs">
          <span className="rounded border border-normal/30 px-2 py-0.5 text-normal">
            정상 {counts.normal}
          </span>
          <span className="rounded border border-warn/30 px-2 py-0.5 text-warn">
            주의 {counts.warning}
          </span>
          <span className="rounded border border-danger/30 px-2 py-0.5 text-danger">
            이상 {counts.abnormal}
          </span>
        </div>
      </header>

      {equipment.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-ink-2">
          <p>표시할 장비가 없어요</p>
          <p className="text-xs text-ink-3">라인 선택이나 필터를 확인해 보세요.</p>
        </div>
      ) : (
        <ul className="space-y-2 overflow-auto">
          {equipment.map((eq) => (
            <li key={eq.id}>
              <button
                type="button"
                onClick={() => onSelect(eq.id)}
                className={`flex w-full items-center gap-3 rounded border px-3 py-3 text-left text-sm ${
                  selectedId === eq.id
                    ? "border-primary bg-primary-subtle"
                    : "border-line bg-bg hover:border-ink-3"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{eq.nameKo}</div>
                  <div className="text-xs text-ink-2">{eq.role}</div>
                </div>
                <span
                  className={`rounded border px-2 py-0.5 text-xs ${STATUS_CHIP[eq.status]}`}
                >
                  {STATUS_KO[eq.status]}
                </span>
                {eq.status === "abnormal" ? (
                  <span className="font-bold text-danger">!</span>
                ) : (
                  <span className="w-3" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
