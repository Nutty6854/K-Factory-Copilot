/** 아직 만들지 않은 탭의 빈 화면. 페이지를 만들 때 이 자리를 교체한다. */
export function PagePlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <main className="absolute bottom-4 left-28 right-4 top-20 z-0 flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-card">
      <h1 className="text-lg font-semibold text-ink-1">{title}</h1>
      <p className="mt-2 text-sm text-ink-2">{note ?? "아직 만들지 않은 화면이에요."}</p>
    </main>
  );
}
