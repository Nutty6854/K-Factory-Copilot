"use client";

import { useState } from "react";
import type { FactoryEvent } from "@/data/demo";

type Props = {
  events: FactoryEvent[];
};

const TYPE_KO = {
  info: "정보",
  warn: "주의",
  alert: "이상",
} as const;

export function EventsView({ events }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, 2);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface p-4 text-ink-1">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">이벤트</h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-ink-2 hover:text-ink-1"
        >
          {expanded ? "접기" : "더보기"} · 기본 최근 2줄
        </button>
      </header>

      {events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-2">
          이벤트 없음
        </div>
      ) : (
        <ul className="space-y-1 overflow-auto text-sm">
          {visible.map((ev) => (
            <li
              key={ev.id}
              className={`flex gap-3 rounded px-2 py-2 ${
                ev.level === "alert" ? "bg-danger-row text-danger" : "bg-bg"
              }`}
            >
              <span className="font-mono text-ink-3">{ev.time}</span>
              <span className="w-10 shrink-0 text-xs text-ink-2">
                {TYPE_KO[ev.level]}
              </span>
              <span className="truncate">{ev.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
