"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 실시간 3D 맵이 들어갈 자리.
 * 안쪽 점선 상자가 "장비 · 라벨 · ! 핀이 놓여야 하는 안전 영역"이고, 크기를 실시간으로 보여준다.
 * 3D를 붙일 때는 children에 캔버스를 넣으면 점선·안내문이 사라진다.
 */
export function MapSlot({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} data-map-slot className="absolute bottom-8 left-[138px] right-[494px] top-[98px]">
      {children ?? (
        <div className="relative size-full rounded-[28px] border-2 border-dashed border-primary/40 bg-primary-subtle/40">
          <span className="absolute left-5 top-4 text-xs font-medium tabular-nums text-primary">
            장비 · 라벨 · ! 핀 안전 영역 {size ? `${size.w} × ${size.h}` : ""}
          </span>
          <div className="absolute inset-0 flex items-center justify-center text-base text-ink-2">
            맵 자리 — 실시간 3D가 여기에 들어와요
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2 text-xs text-ink-2 shadow-card">
            드래그로 회전 · 스크롤로 확대 · 장비를 누르면 상세
          </div>
        </div>
      )}
    </div>
  );
}
