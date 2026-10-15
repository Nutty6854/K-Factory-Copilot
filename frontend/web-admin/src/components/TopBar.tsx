"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { LINE_NAME, OPERATOR, STATUS_COUNTS } from "@/mocks/plant";

function nowClock() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function TopBar() {
  // filled in after mount: a clock rendered on the server would never match the client's second
  const [clock, setClock] = useState("--:--:--");
  useEffect(() => {
    setClock(nowClock());
    const id = setInterval(() => setClock(nowClock()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-4 bg-surface px-6 shadow-bar">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-[9px] bg-primary text-base font-bold text-surface">K</div>
        <div className="flex flex-col gap-px whitespace-nowrap">
          <span className="text-base font-semibold text-ink-1">K-Factory Copilot</span>
          <span className="text-xs text-ink-2">{LINE_NAME} · 생산 현황</span>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-primary-subtle px-3 py-1.5 text-primary">
          <Icon name="dot-normal" size={8} className="text-normal" />
          <span className="text-[13px] font-medium">정상</span>
          <span className="text-sm font-semibold tabular-nums">{STATUS_COUNTS.normal}</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-warn-subtle px-3 py-1.5 text-ink-2">
          <Icon name="dot-warn" size={8} className="text-warn" />
          <span className="text-[13px] font-medium">주의</span>
          <span className="text-sm font-semibold tabular-nums">{STATUS_COUNTS.warning}</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-danger-subtle px-3 py-1.5 text-danger-strong">
          <Icon name="dot-anom" size={8} className="text-danger" />
          <span className="text-[13px] font-medium">이상</span>
          <span className="text-sm font-semibold tabular-nums">{STATUS_COUNTS.abnormal}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-warn-subtle px-3 py-1.5">
        <Icon name="dot-normal" size={8} className="text-normal" />
        <span className="text-xs font-medium text-primary">실시간</span>
        <span className="text-sm font-semibold tabular-nums text-data">{clock}</span>
      </div>

      <div className="h-7 w-px bg-divider" />

      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-[13px] font-semibold text-primary">
          {OPERATOR.initial}
        </div>
        <div className="flex flex-col gap-px whitespace-nowrap">
          <span className="text-[13px] font-medium text-ink-1">{OPERATOR.name}</span>
          <span className="text-[11px] text-ink-2">{OPERATOR.role}</span>
        </div>
      </div>
    </header>
  );
}
