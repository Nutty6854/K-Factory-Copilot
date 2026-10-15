"use client";

import { Fragment, useState } from "react";
import type { HistoryEntry, Resolution } from "@/data/demo";

type Props = {
  history: HistoryEntry[];
  onToggleAction: (incidentId: string, action: string) => void;
  onResolve: (incidentId: string) => void;
};

type Filter = "전체" | "진행 중" | "해결됨";

const HOW_KO: Record<Resolution["how"], string> = {
  sensor: "센서가 정상 범위로 돌아와 자동 해결",
  manual: "해결 처리",
  replaced: "이후 감지로 대체됨",
  reset: "초기화로 정상 복귀",
  restart: "앱을 다시 열어 정리됨",
};

const STATUS_KO = { normal: "정상", warning: "주의", abnormal: "이상" } as const;

// no cause found (원인 미상) means nothing to recommend yet
const actionsOf = (h: HistoryEntry) => (h.unexplained ? [] : h.candidates[0]?.recommendedActions ?? []);

export function HistoryView({ history, onToggleAction, onResolve }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("전체");
  const all = [...history].sort((a, b) => b.at.localeCompare(a.at));
  const openCount = all.filter((h) => !h.resolution).length;
  const rows = all.filter((h) => (filter === "전체" ? true : filter === "진행 중" ? !h.resolution : !!h.resolution));

  if (all.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-line bg-surface text-sm text-ink-2">
        <p>아직 사건이 없어요</p>
        <p className="text-xs text-ink-3">주입 탭에서 시작하거나, 센서 경보가 울리면 여기에 생겨요</p>
      </div>
    );
  }

  const counts: Record<Filter, number> = { 전체: all.length, "진행 중": openCount, 해결됨: all.length - openCount };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface p-4 text-ink-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">사건 이력</h2>
        <div className="flex gap-1 text-xs">
          {(["전체", "진행 중", "해결됨"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 ${
                filter === f ? "border-primary bg-primary-subtle text-primary" : "border-line text-ink-2 hover:bg-bg"
              }`}
            >
              {f} {counts[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-2">
            <tr className="border-b border-line">
              <th className="py-2 pr-2 font-normal">시각</th>
              <th className="py-2 pr-2 font-normal">장비</th>
              <th className="py-2 pr-2 font-normal">시나리오</th>
              <th className="py-2 pr-2 font-normal">강도</th>
              <th className="py-2 pr-2 font-normal">1위 후보</th>
              <th className="py-2 pr-2 font-normal">score</th>
              <th className="py-2 font-normal">진행</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const top = h.candidates[0];
              const open = openId === h.id;
              const acts = actionsOf(h);
              const done = acts.filter((a) => h.actionsDone?.[a]).length;
              return (
                <Fragment key={h.id}>
                  <tr
                    onClick={() => setOpenId(open ? null : h.id)}
                    className={`cursor-pointer border-b border-line ${
                      h.resolution ? "text-ink-2" : h.status === "abnormal" ? "bg-danger-row text-danger" : "hover:bg-surface"
                    } ${open ? "outline outline-1 outline-primary/50" : ""}`}
                  >
                    <td className="py-2 pr-2 font-mono text-ink-2">{h.time}</td>
                    <td className="py-2 pr-2">{h.equipmentNameKo}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{h.scenario === "sensor" ? "센서 자동 감지" : h.scenario}</td>
                    <td className="py-2 pr-2">{h.strength}</td>
                    <td className="py-2 pr-2">{h.unexplained ? "원인 미상" : top ? top.causeKo : "후보 없음"}</td>
                    <td className="py-2 pr-2 font-mono">{top ? top.confidence.toFixed(2) : "-"}</td>
                    <td className="py-2 text-xs">
                      {h.resolution ? (
                        <span className="rounded-full border border-normal/30 bg-primary-subtle px-2 py-0.5 text-normal">해결됨 {h.resolution.time}</span>
                      ) : (
                        <span className="rounded-full border border-warn/30 bg-warn-subtle px-2 py-0.5 text-warn">
                          진행 중{acts.length ? ` · 조치 ${done}/${acts.length}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={7} className="bg-bg p-3">
                        <HistoryDetail entry={h} onToggleAction={onToggleAction} onResolve={onResolve} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-ink-3">
                  {filter} 사건이 없어요
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Step = { key: string; label: string; time?: string; text: string; done: boolean };

/** detect → judge → explain → act → resolve, built only from what the incident has recorded so far */
function stepsOf(h: HistoryEntry): Step[] {
  const top = h.candidates[0];
  const acts = actionsOf(h);
  const doneTimes = acts.map((a) => h.actionsDone?.[a]).filter((t): t is string => !!t);
  return [
    {
      key: "detect",
      label: "감지",
      time: h.time,
      text: h.scenario === "sensor" ? h.trigger ?? "센서 경보" : `시나리오 주입 · ${h.scenario} (${h.strength})`,
      done: true,
    },
    {
      key: "judge",
      label: "판정",
      time: h.time,
      text: h.unexplained
        ? `Rule Engine · 원인 미상 (1위 ${top?.causeKo ?? "-"} ${top?.confidence.toFixed(2) ?? "-"}는 기준 0.5 미만)`
        : top
          ? `Rule Engine · 1위 ${top.causeKo} ${top.confidence.toFixed(2)} · ${STATUS_KO[h.status]}`
          : `Rule Engine · 후보 없음 · ${STATUS_KO[h.status]}`,
      done: true,
    },
    {
      key: "explain",
      label: "AI 설명",
      time: h.advisorAt,
      text: h.advisor ? "설명 생성됨 (후보와 score는 바꾸지 않음)" : "아직 없음 · 지도에서 장비를 선택해 설명 보기를 누르면 생겨요",
      done: !!h.advisor,
    },
    {
      key: "act",
      label: "조치",
      time: doneTimes.length ? doneTimes.sort().at(-1) : undefined,
      text: acts.length ? `권장 조치 ${doneTimes.length}/${acts.length} 완료` : "권장 조치 없음",
      done: acts.length === 0 ? false : doneTimes.length === acts.length,
    },
    {
      key: "resolve",
      label: "해결",
      time: h.resolution?.time,
      text: h.resolution ? HOW_KO[h.resolution.how] : "대기 중 · 해결되면 장비가 정상으로 돌아가요",
      done: !!h.resolution,
    },
  ];
}

function Timeline({ entry }: { entry: HistoryEntry }) {
  const steps = stepsOf(entry);
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`mt-1 h-2.5 w-2.5 rounded-full border ${s.done ? "border-primary bg-primary" : "border-ink-3 bg-surface"}`} />
            {i < steps.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
          </div>
          <div className="pb-3 text-xs">
            <div className="flex items-baseline gap-2">
              <span className={`font-semibold ${s.done ? "text-ink-1" : "text-ink-3"}`}>{s.label}</span>
              {s.time ? <span className="font-mono text-ink-3">{s.time}</span> : null}
            </div>
            <p className={s.done ? "text-ink-2" : "text-ink-3"}>{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function HistoryDetail({ entry, onToggleAction, onResolve }: { entry: HistoryEntry; onToggleAction: Props["onToggleAction"]; onResolve: Props["onResolve"] }) {
  const acts = actionsOf(entry);
  const closed = !!entry.resolution;
  const allDone = acts.length > 0 && acts.every((a) => entry.actionsDone?.[a]);
  return (
    <div className="space-y-3 text-sm">
      <section>
        <h4 className="mb-1 text-xs text-ink-2">진행</h4>
        <Timeline entry={entry} />
      </section>
      {acts.length ? (
        <section>
          <h4 className="mb-1 text-xs text-ink-2">권장 조치 · Rule Engine</h4>
          <ul className="space-y-1">
            {acts.map((a) => {
              const at = entry.actionsDone?.[a];
              return (
                <li key={a}>
                  <label className={`flex items-center gap-2 text-xs ${closed ? "text-ink-3" : "cursor-pointer text-ink-1"}`}>
                    <input type="checkbox" checked={!!at} disabled={closed} onChange={() => onToggleAction(entry.id, a)} className="accent-[var(--kf-primary)]" />
                    <span className={at ? "text-ink-2 line-through" : ""}>{a}</span>
                    {at ? <span className="font-mono text-ink-3">{at}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {!closed ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onResolve(entry.id)}
            className={`rounded border px-3 py-1.5 text-xs ${allDone ? "border-primary bg-primary text-surface" : "border-line bg-surface text-ink-1 hover:bg-bg"}`}
          >
            {allDone ? "모든 조치를 마쳤어요 · 해결 처리" : "조치 완료 · 해결 처리"}
          </button>
          {entry.scenario === "sensor" ? (
            <span className="text-[11px] text-ink-3">원인 설비의 고장을 없애면(시뮬레이션) 센서가 돌아오고 자동으로 해결돼요</span>
          ) : null}
        </div>
      ) : null}
      <div className="text-[10px] uppercase tracking-wide text-ink-3">스냅샷 · 재계산 안 함</div>
      {entry.trigger ? <p className="text-xs text-ink-2">감지 근거 · {entry.trigger}</p> : null}
      <section>
        <h4 className="mb-1 text-xs text-ink-2">센서 변화</h4>
        <ul className="space-y-0.5 font-mono text-xs text-ink-2">
          {entry.deltas.map((d) => (
            <li key={d.name}>
              {d.name} {d.base}
              {d.unit} → {d.current}
              {d.unit} · {d.changePct > 0 ? "+" : ""}
              {d.changePct}% · {d.trend}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="mb-1 text-xs text-ink-2">원인 후보 · Rule Engine</h4>
        {entry.candidates.length ? (
          <ol className="space-y-0.5 text-ink-1">
            {entry.candidates.map((c, i) => (
              <li key={c.cause} className="flex justify-between">
                <span>
                  #{i + 1} {c.causeKo}
                </span>
                <span className="font-mono">{c.confidence.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-3">후보 없음</p>
        )}
      </section>
      <section>
        <h4 className="mb-1 text-xs text-ink-2">Advisor 설명</h4>
        {entry.advisor ? (
          <div className="space-y-1 text-ink-1">
            <p>{entry.advisor.summary}</p>
            <ul className="list-disc pl-4">
              {entry.advisor.evidenceExplanation.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-ink-3">설명 없음</p>
        )}
      </section>
    </div>
  );
}
