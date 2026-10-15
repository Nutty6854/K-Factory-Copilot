"use client";

import { Icon } from "@/components/ui/Icon";

type Props = {
  counts: { normal: number; warning: number; abnormal: number; unmonitored?: number };
  clock: string;
  line: string;
  /** downloads the problem report file */
  onReport?: () => void;
};

export function TopBar({ counts, clock, line, onReport }: Props) {
  return (
    <header data-map-obstacle className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-4 bg-surface px-6 shadow-bar">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-[9px] bg-primary text-base font-bold text-surface">
          K
        </div>
        <div className="flex flex-col gap-px whitespace-nowrap">
          <span className="text-base font-semibold text-ink-1">K-Factory Copilot</span>
          <span className="text-xs text-ink-2">{line} · 생산 현황</span>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-primary-subtle px-3 py-1.5 text-primary">
          <Icon name="dot-normal" size={8} className="text-normal" />
          <span className="text-[13px] font-medium">정상</span>
          <span className="text-sm font-semibold tabular-nums">{counts.normal}</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-warn-subtle px-3 py-1.5 text-ink-2">
          <Icon name="dot-warn" size={8} className="text-warn" />
          <span className="text-[13px] font-medium">주의</span>
          <span className="text-sm font-semibold tabular-nums">{counts.warning}</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-danger-subtle px-3 py-1.5 text-danger-strong">
          <Icon name="dot-anom" size={8} className="text-danger" />
          <span className="text-[13px] font-medium">이상</span>
          <span className="text-sm font-semibold tabular-nums">{counts.abnormal}</span>
        </span>
        {counts.unmonitored ? (
          <span
            title="원자재 랙·고정구처럼 센서가 없는 설비는 판정할 수 없어서 정상에 넣지 않았어요"
            className="flex items-center gap-1.5 rounded-full bg-bg px-3 py-1.5 text-ink-2"
          >
            <span className="text-[13px] font-medium">센서 없음</span>
            <span className="text-sm font-semibold tabular-nums">{counts.unmonitored}</span>
          </span>
        ) : null}
        <span className="whitespace-nowrap text-[11px] text-ink-3">주의 ≥ 0.5 · 이상 ≥ 0.7</span>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-warn-subtle px-3 py-1.5">
        <Icon name="dot-normal" size={8} className="text-normal" />
        <span className="text-xs font-medium text-primary">실시간</span>
        <span className="text-sm font-semibold tabular-nums text-data">{clock}</span>
      </div>

      {onReport ? (
        <button
          type="button"
          onClick={onReport}
          title="이상한 동작을 봤을 때 누르면 재현에 필요한 정보가 든 파일(JSON)을 내려받아요. 어디에도 전송되지 않아요."
          className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-bg"
        >
          문제 보고
        </button>
      ) : null}

      <div className="h-7 w-px bg-divider" />

      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-[13px] font-semibold text-primary">
          A
        </div>
        <div className="flex flex-col gap-px whitespace-nowrap">
          <span className="text-[13px] font-medium text-ink-1">A조 · op-12</span>
          <span className="text-[11px] text-ink-2">{line} 운영자</span>
        </div>
      </div>
    </header>
  );
}
