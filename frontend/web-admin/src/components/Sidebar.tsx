"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

export const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/main", label: "메인", icon: "nav-events" },
  { href: "/realtime", label: "실시간", icon: "nav-map" },
  { href: "/floorplan", label: "공장 전개도", icon: "nav-equipment" },
  { href: "/ai", label: "AI", icon: "nav-explain" },
  { href: "/energy", label: "에너지", icon: "nav-inject" },
  { href: "/history", label: "이력", icon: "nav-history" },
];

/** 왼쪽 세로 탭 카드 (Figma Nav Rail): x 16, y 80, 폭 80. 탭마다 주소가 따로 있다. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주 메뉴"
      className="absolute left-4 top-20 z-10 flex w-20 flex-col gap-1 rounded-2xl border border-line bg-surface p-2 shadow-card"
    >
      {NAV.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] ${
              active ? "bg-primary-subtle font-semibold text-primary" : "font-medium text-ink-2 hover:bg-bg"
            }`}
          >
            <Icon name={icon} size={20} />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
