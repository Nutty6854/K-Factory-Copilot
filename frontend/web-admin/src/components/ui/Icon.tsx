import type { CSSProperties } from "react";

export type IconName =
  | "dot-normal"
  | "dot-warn"
  | "dot-anom"
  | "nav-map"
  | "nav-equipment"
  | "nav-events"
  | "nav-explain"
  | "nav-inject"
  | "nav-history"
  | "nav-train"
  | "zoom-in"
  | "zoom-out"
  | "rotate-left"
  | "rotate-right"
  | "home"
  | "events"
  | "chevron-down"
  | "close";

type Props = { name: IconName; size: number; className?: string };

/**
 * Figma 5:24 / 7:23 에서 받은 SVG(public/icons/v2)를 마스크로 쓴다.
 * 모양은 원본 그대로, 색은 currentColor(텍스트 색 토큰)라서 탭 활성/비활성에 같은 파일을 쓴다.
 */
export function Icon({ name, size, className = "" }: Props) {
  const mask = `url(/icons/v2/${name}.svg) center / contain no-repeat`;
  const style: CSSProperties = { width: size, height: size, mask, WebkitMask: mask };
  return <span aria-hidden className={`block shrink-0 bg-current ${className}`} style={style} />;
}
