"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { RECENT_EVENTS } from "@/mocks/plant";

/** "제목 · 나머지" 메시지를 두 줄(제목 / 보조)로 나눈다. */
function split(message: string) {
  const i = message.indexOf(" · ");
  return i < 0 ? { title: message, sub: "" } : { title: message.slice(0, i), sub: message.slice(i + 3) };
}

/** 최근 이벤트 카드 (Figma "Recent Events · 접힘 2줄"): 오른쪽 아래. */
export function EventCard({ context }: { context: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? RECENT_EVENTS : RECENT_EVENTS.slice(0, 2);

  return (
    <section
      aria-label="최근 이벤트"
      className={`absolute bottom-4 right-4 flex w-[384px] flex-col gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-card ${
        expanded ? "z-30 max-h-[calc(100dvh-96px)]" : "z-10"
      }`}
    >
      <div className="flex items-center gap-2 whitespace-nowrap">
        <Icon name="events" size={18} className="text-primary" />
        <span className="text-sm font-semibold text-ink-1">최근 이벤트</span>
        <span className="text-xs text-ink-3">{context}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-0.5 text-xs font-medium text-primary"
        >
          {expanded ? "접기" : "펼치기"}
          <Icon name="chevron-down" size={16} className={expanded ? "rotate-180" : ""} />
        </button>
      </div>
      <ul className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
        {visible.map((ev) => {
          const { title, sub } = split(ev.message);
          const tone = ev.level === "alert" ? "text-danger-strong" : ev.level === "warn" ? "text-warn-text" : "text-ink-1";
          return (
            <li key={ev.id} className="flex items-start gap-3 whitespace-nowrap rounded-[10px] bg-row px-2.5 py-2">
              <span className="text-xs font-medium tabular-nums text-ink-3">{ev.time}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`truncate text-[13px] font-medium ${tone}`}>{title}</span>
                {sub ? <span className="truncate text-xs text-ink-2">{sub}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
