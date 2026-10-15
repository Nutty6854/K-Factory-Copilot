"use client";

import { Icon, type IconName } from "@/components/ui/Icon";

export type MapAction = "zoom-in" | "zoom-out" | "rotate-left" | "rotate-right" | "home";

const GROUPS: { action: MapAction; icon: IconName; label: string }[][] = [
  [
    { action: "zoom-in", icon: "zoom-in", label: "확대" },
    { action: "zoom-out", icon: "zoom-out", label: "축소" },
  ],
  [
    { action: "rotate-left", icon: "rotate-left", label: "왼쪽으로 회전" },
    { action: "rotate-right", icon: "rotate-right", label: "오른쪽으로 회전" },
  ],
  [{ action: "home", icon: "home", label: "처음 시점" }],
];

/**
 * 맵 조작 버튼 열. 지금은 화면 틀뿐이라 onAction이 없으면 눌러도 아무 일도 없다.
 * 실시간 3D를 붙일 때 onAction에서 카메라를 움직이면 된다.
 */
export function MapControls({ onAction }: { onAction?: (action: MapAction) => void }) {
  return (
    <div
      role="toolbar"
      aria-label="맵 조작"
      className="absolute right-[424px] top-[104px] z-10 flex w-[46px] flex-col rounded-2xl border border-line bg-surface p-1 shadow-card"
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} className={`flex flex-col gap-0.5 ${gi > 0 ? "mt-1 border-t border-divider pt-1" : ""}`}>
          {group.map(({ action, icon, label }) => (
            <button
              key={action}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onAction?.(action)}
              className="flex size-9 items-center justify-center rounded-xl text-ink-1 hover:bg-bg"
            >
              <Icon name={icon} size={20} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
