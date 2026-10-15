"use client";

import { useLayoutEffect, useRef } from "react";
import type { FactoryEvent } from "@/data/demo";
import { Icon } from "@/components/ui/Icon";

type Props = {
  events: FactoryEvent[];
  context: string;
  expanded: boolean;
  onToggle: () => void;
  /** Reports the folded card height so the detail card can stop 12 px above it */
  onCollapsedHeight?: (h: number) => void;
};

/** "제목 · 나머지" 메시지를 두 줄(제목 / 보조)로 나눈다. */
function split(message: string) {
  const i = message.indexOf(" · ");
  return i < 0 ? { title: message, sub: "" } : { title: message.slice(0, i), sub: message.slice(i + 3) };
}

/** v2 최근 이벤트 카드 (Figma "Recent Events · 접힘 2줄"): 오른쪽 아래, 상세 카드 12px 아래. */
export function EventCard({ events, context, expanded, onToggle, onCollapsedHeight }: Props) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded || !onCollapsedHeight) return;
    const report = () => onCollapsedHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, onCollapsedHeight]);

  const visible = expanded ? events.slice(0, 12) : events.slice(0, 2);

  return (
    <section
      data-map-obstacle
      ref={ref}
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
          onClick={onToggle}
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
          return (
            <li key={ev.id} className="flex items-start gap-3 rounded-[10px] bg-row px-2.5 py-2 whitespace-nowrap">
              <span className="text-xs font-medium tabular-nums text-ink-3">{ev.time}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`truncate text-[13px] font-medium ${
                    ev.level === "alert"
                      ? "text-danger-strong"
                      : ev.level === "warn"
                        ? "text-warn-text"
                        : "text-ink-1"
                  }`}
                >
                  {title}
                </span>
                {sub ? <span className="truncate text-xs text-ink-2">{sub}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
