"use client";

import type { Equipment } from "@/data/demo";

type Props = {
  selected: Equipment | null;
};

export function ExplainView({ selected }: Props) {
  const advisor = selected?.advisor;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface p-4 text-ink-1">
      <p className="mb-4 rounded border border-line bg-bg px-3 py-2 text-sm text-ink-2">
        Rule Engine 판단 · Advisor 설명
      </p>
      <h2 className="mb-2 text-sm font-semibold text-ink-1">최근 Advisor 설명</h2>
      {advisor ? (
        <div className="space-y-2 overflow-auto rounded border border-primary/30 bg-primary-subtle p-3 text-sm">
          <p className="font-medium text-primary">{advisor.summary}</p>
          <ul className="list-disc space-y-1 pl-4 text-ink-1">
            {advisor.evidenceExplanation.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-ink-2">
          선택·주입 후 어드바이저 설명을 보세요
        </div>
      )}
    </div>
  );
}
