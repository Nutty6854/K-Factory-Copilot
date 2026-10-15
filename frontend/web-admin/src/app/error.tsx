"use client";

import { useEffect } from "react";
import { buildReport, downloadReport, installBugCapture } from "@/lib/bugReport";

/** Shown when a screen crashes: the user can retry or download the problem report instead of a blank page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    installBugCapture();
  }, []);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-ink-1">
      <p className="text-base font-semibold">화면에 문제가 생겼어요</p>
      <p className="max-w-md text-xs text-ink-2">{error.message || "알 수 없는 오류"}</p>
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={reset} className="rounded border border-line bg-surface px-4 py-1.5 hover:bg-bg">
          다시 시도
        </button>
        <button
          type="button"
          onClick={() => downloadReport(buildReport({ crash: { message: error.message, digest: error.digest ?? null, stack: error.stack?.slice(0, 2000) ?? null } }, "화면 오류"))}
          className="rounded border border-primary bg-primary px-4 py-1.5 text-surface"
        >
          문제 보고 파일 받기
        </button>
      </div>
    </div>
  );
}
