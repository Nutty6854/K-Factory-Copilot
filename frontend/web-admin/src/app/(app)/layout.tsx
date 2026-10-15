import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

/** 모든 탭이 같이 쓰는 틀: 위 막대 + 왼쪽 탭. 탭마다 안쪽 화면만 바뀐다. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-ink-1">
      {children}
      <TopBar />
      <Sidebar />
    </div>
  );
}
