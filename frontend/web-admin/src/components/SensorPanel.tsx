"use client";

import { useEffect, useRef, useState } from "react";
import { EVIDENCE_KO, equipmentById, type Confidence } from "@/data/factoryProfile";
import { STATUS_KO, type Resolved, type Status } from "@/data/plantStatus";
import { readSensors, worstOf, type Reading } from "@/data/plantSensors";

/* Sensor widgets shared by the /lab/plant card and the main app's robot card. */

export const EVID_COLOR: Record<Confidence, string> = { sourced: "#2e9b6a", secondary: "#e0a030", assumed: "#aab4b8" };

/** The one 가정 marker, used on labels, connection tags, the card and the legend. */
export function AssumedTag() {
  return <span className="rounded-[4px] bg-[#f3f6f6] px-1 text-[9.5px] font-medium leading-[13px] text-ink-3">가정</span>;
}

export function EvidenceBadge({ c }: { c: Confidence }) {
  if (c === "assumed") return <AssumedTag />;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-2 ring-1 ring-line">
      <span className="h-2 w-2 rounded-full" style={{ background: EVID_COLOR[c] }} />
      {EVIDENCE_KO[c]}
    </span>
  );
}

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const cls = status === "normal" ? "bg-primary-subtle text-primary" : status === "warning" ? "bg-warn-subtle text-warn-text" : "bg-danger-subtle text-danger-strong";
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>{label ?? STATUS_KO[status]}</span>;
}

export const STATUS_DOT: Record<Status, string> = { normal: "#2e9b6a", warning: "#e8b04a", abnormal: "#d4584a" };

/** One sensor: value, where it sits between the limits, and the last minute. */
export function SensorRow({ r, hist }: { r: Reading; hist: number[] }) {
  const d = r.def;
  const [lo, hi] = d.axis;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const pos = (v: number) => `${frac(v) * 100}%`;
  const w = 100;
  const h = 16;
  const path = hist.length > 1 ? hist.map((v, i) => `${i === 0 ? "M" : "L"}${((i / 59) * w).toFixed(1)} ${(h - frac(v) * h).toFixed(1)}`).join(" ") : "";
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[r.status] }} />
        <span className="text-ink-2">{d.label}</span>
        <b className="ml-auto whitespace-nowrap tabular-nums">
          {r.value.toFixed(d.dec ?? 1)} <span className="font-normal text-ink-2">{d.unit}</span>
        </b>
        <span title={d.note ?? "가정한 값"} className="cursor-help">
          <EvidenceBadge c={d.evidence} />
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="relative h-1.5 flex-1 rounded-full bg-[#f1d9d5]">
          <div className="absolute top-0 h-full bg-[#f4e7c4]" style={{ left: pos(d.alarm[0]), width: `calc(${pos(d.alarm[1])} - ${pos(d.alarm[0])})` }} />
          <div className="absolute top-0 h-full bg-[#cfe6d8]" style={{ left: pos(d.normal[0]), width: `calc(${pos(d.normal[1])} - ${pos(d.normal[0])})` }} />
          <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-ink-1" style={{ left: pos(r.value) }} />
        </div>
        <svg width={w} height={h} className="shrink-0" viewBox={`0 0 ${w} ${h}`}>
          <path d={path} fill="none" stroke={STATUS_DOT[r.status]} strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  );
}

export function SensorPanel({ id, readings, hist, hideLevel }: { id: string; readings: Reading[]; hist: Record<string, number[]>; hideLevel?: boolean }) {
  if (!readings.length) return <div className="mt-2 rounded-md border border-line p-2 text-[11px] text-ink-2">이 설비에는 센서를 두지 않음 (적치·지그·격리함)</div>;
  return (
    <div className="mt-2 rounded-md border border-line p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-semibold text-ink-2">센서 (생성한 데모 값)</span>
        <StatusPill status={worstOf(readings)} label={hideLevel && worstOf(readings) !== "normal" ? "점검 필요" : undefined} />
      </div>
      {readings.map((r) => (
        <SensorRow key={r.def.id} r={r} hist={hist[`${id}:${r.def.id}`] ?? []} />
      ))}
      <div className="text-[10.5px] text-ink-2">띠: 초록 정상 · 노랑 주의 · 분홍 이상. 값은 흐름 시뮬레이션의 부하와 주입한 시나리오에서 만든 것이고 측정값이 아님.</div>
    </div>
  );
}


/**
 * Live sensors of one machine for a card that has no flow simulation behind it (the main app's robot card):
 * the machine is assumed to be working, like the sensor monitor does. Samples twice a second for the trend lines.
 */
export function LiveSensors({ id, res }: { id: string; res: Resolved }) {
  const resRef = useRef(res);
  resRef.current = res;
  const hist = useRef<Record<string, number[]>>({});
  const [readings, setReadings] = useState<Reading[]>([]);
  useEffect(() => {
    hist.current = {};
    const e = equipmentById(id);
    if (!e) return;
    const tick = () => {
      const r = readSensors(e, {
        act: { busy: true, progress: 0.5, status: resRef.current.status, state: "run", processed: 0, busySec: 0, waiting: 0 },
        res: resRef.current,
        t: performance.now() / 1000,
      });
      for (const x of r) {
        const a = (hist.current[`${id}:${x.def.id}`] ??= []);
        a.push(x.value);
        if (a.length > 60) a.shift();
      }
      setReadings(r);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [id]);
  return (
    <div className="text-xs text-ink-1">
      <SensorPanel id={id} readings={readings} hist={hist.current} />
    </div>
  );
}
