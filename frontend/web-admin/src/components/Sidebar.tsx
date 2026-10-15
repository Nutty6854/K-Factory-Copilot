"use client";

import { Icon, type IconName } from "@/components/ui/Icon";

export type Tab = "지도" | "장비" | "이벤트" | "설명" | "주입" | "이력" | "훈련";

type Props = {
  tab: Tab;
  onTab: (t: Tab) => void;
};

const TABS: { tab: Tab; icon: IconName }[] = [
  { tab: "지도", icon: "nav-map" },
  { tab: "장비", icon: "nav-equipment" },
  { tab: "이벤트", icon: "nav-events" },
  { tab: "설명", icon: "nav-explain" },
  { tab: "주입", icon: "nav-inject" },
  { tab: "이력", icon: "nav-history" },
  { tab: "훈련", icon: "nav-train" },
];

/** v2 세로 탭 카드 (Figma Nav Rail): x 16, y 80, 폭 80. */
export function Sidebar({ tab, onTab }: Props) {
  return (
    <nav data-map-obstacle className="absolute left-4 top-20 z-10 flex w-20 flex-col gap-1 rounded-2xl border border-line bg-surface p-2 shadow-card">
      {TABS.map(({ tab: t, icon }) => {
        const active = tab === t;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => onTab(t)}
            className={`flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] ${
              active
                ? "bg-primary-subtle font-semibold text-primary"
                : "font-medium text-ink-2 hover:bg-bg"
            }`}
          >
            <Icon name={icon} size={20} />
            {t}
          </button>
        );
      })}
    </nav>
  );
}
