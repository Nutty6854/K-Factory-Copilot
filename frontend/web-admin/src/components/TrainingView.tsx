"use client";

import { useEffect, useMemo, useState } from "react";
import { LEVELS, drillsFor, type Level, type TrainScene } from "@/lib/training";

type Filter = Level | "전체";

const STATUS_CHIP = {
  normal: "bg-primary-subtle text-normal border-normal/30",
  warning: "bg-warn-subtle text-warn border-warn/30",
  abnormal: "bg-danger-subtle text-danger border-danger/30",
} as const;
const STATUS_KO = { normal: "정상", warning: "주의", abnormal: "이상" } as const;

// the drills only seed the sensor noise with this; a fixed value keeps every question the same each time
const T = 12.3;

type Props = {
  /** the map is told which fault to show (null = none); it never touches the real plant state */
  onScene: (s: TrainScene | null) => void;
  /** the 훈련 tab is showing */
  active: boolean;
};

/**
 * Practice mode, played on the map: a made-up fault runs on a copy of the plant model, the trainee investigates
 * the 3D line (marks, live sensors, supply lines, how the flow backs up), names the cause, and only then is the
 * answer shown on the map. Nothing here touches events, history or the real fault record.
 */
export function TrainingView({ onScene, active }: Props) {
  const [level, setLevel] = useState<Filter>("전체");
  const drills = useMemo(() => drillsFor(level, T), [level]);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [hints, setHints] = useState(0);
  const [score, setScore] = useState({ solved: 0, correct: 0, hints: 0 });
  const [showList, setShowList] = useState(false);

  const drill = drills[index];
  const finished = index >= drills.length;

  useEffect(() => {
    onScene(active && drill ? { key: `${level}-${index}-${attempt}`, injected: { [drill.root.id]: drill.scenarioId }, rootId: drill.root.id, revealed: submitted } : null);
  }, [active, drill, level, index, attempt, submitted, onScene]);

  function reset(next: Filter) {
    setLevel(next);
    setIndex(0);
    setAttempt((n) => n + 1);
    setPicked(null);
    setSubmitted(false);
    setHints(0);
    setScore({ solved: 0, correct: 0, hints: 0 });
    setShowList(false);
  }

  function submit() {
    if (!drill || !picked) return;
    setSubmitted(true);
    setScore((s) => ({ solved: s.solved + 1, correct: s.correct + (picked === drill.answerKey ? 1 : 0), hints: s.hints + hints }));
  }

  function next() {
    setIndex((i) => i + 1);
    setPicked(null);
    setSubmitted(false);
    setHints(0);
    setShowList(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4 text-ink-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">훈련 모드</h2>
        <span className="text-xs text-ink-2">
          정답 {score.correct}/{score.solved} · 힌트 {score.hints}
        </span>
      </div>
      <div className="mb-2 flex gap-1 text-xs">
        {(["전체", ...LEVELS] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => reset(f)}
            className={`rounded-full border px-2.5 py-1 ${level === f ? "border-primary bg-primary-subtle text-primary" : "border-line text-ink-2 hover:bg-bg"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <p className="mb-2 rounded border border-line bg-bg px-2.5 py-1.5 text-[11px] text-ink-2">
        가상의 고장이에요. 지도·이벤트·이력에는 영향을 주지 않아요.
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
        {finished ? (
          <div className="flex flex-col items-center gap-3 py-8 text-sm">
            <p className="font-semibold">
              끝! {score.solved}문제 중 {score.correct}문제 정답 · 힌트 {score.hints}번
            </p>
            <button type="button" onClick={() => reset(level)} className="rounded border border-primary bg-primary px-4 py-1.5 text-xs text-surface">
              처음부터 다시
            </button>
          </div>
        ) : drill ? (
          <>
            <div className="flex items-baseline gap-2 text-xs text-ink-2">
              <span className="font-semibold text-ink-1">
                문제 {index + 1}/{drills.length}
              </span>
              <span className="rounded-full border border-line px-2 py-0.5">{drill.level}</span>
            </div>

            {!submitted ? (
              <section className="space-y-1 rounded border border-line px-2.5 py-2 text-[11px] text-ink-2">
                <p className="text-ink-1">
                  지도에 <b>점검 필요</b> 표시가 <b>{drill.seen.length}대</b> 있어요.
                </p>
                <p>설비를 눌러 실시간 센서를 보고, 공급선(냉각·전원·공기 등)을 켜서 이상한 설비들이 무엇을 같이 받는지 따라가 보세요. 라인이 어디서 막히는지도 힌트예요. 더블클릭하면 설비로 다가가요.</p>
                <button type="button" onClick={() => setShowList((v) => !v)} className="text-primary">
                  {showList ? "센서 목록 접기" : "센서 목록으로 보기 (참고)"}
                </button>
                {showList ? (
                  <ul className="max-h-40 space-y-1.5 overflow-auto pt-1">
                    {drill.seen.map((m) => (
                      <li key={m.id}>
                        <span className="font-medium text-ink-1">{m.name}</span>
                        <ul className="ml-2 font-mono">
                          {m.readings.map((r) => (
                            <li key={r.label}>
                              {r.label} {r.text} <span className="text-ink-3">(정상 {r.range})</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : (
              <section className="rounded border border-line px-2.5 py-2 text-[11px] text-ink-2">
                지도에 정답 설비와 영향이 번진 설비가 표시됐어요. 이제 상태(주의·이상)가 색으로 구분돼요.
                <ul className="mt-1 space-y-0.5">
                  {drill.seen.slice(0, 6).map((m) => (
                    <li key={m.id} className="flex items-center gap-1.5">
                      <span className="text-ink-1">{m.name}</span>
                      <span className={`rounded-full border px-1.5 text-[10px] ${STATUS_CHIP[m.status]}`}>{STATUS_KO[m.status]}</span>
                    </li>
                  ))}
                  {drill.seen.length > 6 ? <li className="text-ink-3">외 {drill.seen.length - 6}대</li> : null}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-xs text-ink-2">원인은 무엇일까요?</h3>
              <div className="space-y-1">
                {drill.options.map((o) => {
                  const isAnswer = o.key === drill.answerKey;
                  const tone = !submitted
                    ? picked === o.key
                      ? "border-primary bg-primary-subtle"
                      : "border-line hover:bg-bg"
                    : isAnswer
                      ? "border-normal bg-primary-subtle"
                      : picked === o.key
                        ? "border-danger bg-danger-subtle"
                        : "border-line text-ink-3";
                  return (
                    <label key={o.key} className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${tone} ${submitted ? "" : "cursor-pointer"}`}>
                      <input type="radio" name="cause" checked={picked === o.key} disabled={submitted} onChange={() => setPicked(o.key)} className="accent-[var(--kf-primary)]" />
                      <span>{o.label}</span>
                      {submitted && isAnswer ? <span className="ml-auto text-[11px] text-normal">정답</span> : null}
                    </label>
                  );
                })}
              </div>
            </section>

            {hints > 0 ? (
              <ul className="space-y-1 rounded border border-warn/30 bg-warn-subtle px-2.5 py-1.5 text-[11px] text-ink-1">
                {drill.hints.slice(0, hints).map((h, i) => (
                  <li key={h}>
                    힌트 {i + 1} · {h}
                  </li>
                ))}
              </ul>
            ) : null}

            {!submitted ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={hints >= drill.hints.length}
                  onClick={() => setHints((h) => h + 1)}
                  className="rounded border border-line px-3 py-1.5 text-xs text-ink-1 hover:bg-bg disabled:text-ink-3"
                >
                  힌트 보기 {hints}/{drill.hints.length}
                </button>
                <button
                  type="button"
                  disabled={!picked}
                  onClick={submit}
                  className="rounded border border-primary bg-primary px-4 py-1.5 text-xs text-surface disabled:border-line disabled:bg-bg disabled:text-ink-3"
                >
                  제출
                </button>
              </div>
            ) : (
              <section className="space-y-2 rounded border border-line bg-bg p-2.5 text-[11px]">
                <p className={`text-sm font-semibold ${picked === drill.answerKey ? "text-normal" : "text-danger"}`}>
                  {picked === drill.answerKey ? "정답이에요" : "아쉬워요"} · 정답: {drill.explain.title}
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-ink-2">
                  {drill.explain.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <div>
                  <h4 className="mb-0.5 text-ink-2">앱의 Rule Engine은 이렇게 봤어요</h4>
                  {drill.explain.engine.length ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-ink-1">
                      {drill.explain.engine.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ink-3">이 문제에는 로봇 증상이 없어서 엔진 판정이 없어요. 엔진은 로봇 3대만 판정해요.</p>
                  )}
                  <p className="mt-1 text-ink-3">엔진은 원인의 종류(냉각라인·전원 공급 등)까지 좁히고, 어느 설비인지는 프로필의 공급 연결로 찾아요.</p>
                </div>
                <button type="button" onClick={next} className="rounded border border-primary bg-primary px-4 py-1.5 text-xs text-surface">
                  {index + 1 < drills.length ? "다음 문제" : "결과 보기"}
                </button>
              </section>
            )}
          </>
        ) : null}
      </div>
      <p className="mt-2 text-[10.5px] text-ink-3">고장과 센서값은 모두 가정한 시뮬레이션이에요. 실제 설비 데이터가 아니에요.</p>
    </div>
  );
}
