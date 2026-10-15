"use client";

import { useEffect, useRef, useState } from "react";
import type { Equipment, SensorDelta } from "@/data/demo";
import {
  assertAdvisorRespectsCandidates,
  explainWithAdvisor,
} from "@/lib/advisor";
import { Icon } from "@/components/ui/Icon";
import { LiveSensors } from "@/components/SensorPanel";
import type { Resolved } from "@/data/plantStatus";

type Props = {
  equipment: Equipment;
  /** Time of the injection currently shown (from history), if any */
  detectedTime?: string;
  onAdvisor: (
    equipmentId: string,
    advisor: NonNullable<Equipment["advisor"]>,
  ) => void;
  onClose: () => void;
  /** Distance from the shell bottom: 16 + folded event card height + 12 */
  bottomOffset: number;
  /** what the plant model says about this machine (drives the live sensor panel) */
  plantRes?: Resolved;
};

const SENSOR_EN: Record<string, string> = {
  진동: "vibration",
  전류: "current",
  온도: "temperature",
};

const STATUS_PILL = {
  normal: { cls: "bg-primary-subtle text-primary", label: "정상", bang: false },
  warning: { cls: "bg-warn-subtle text-warn-text", label: "주의", bang: false },
  abnormal: {
    cls: "bg-danger-subtle text-danger-strong",
    label: "이상",
    bang: true,
  },
} as const;

function fmt(d: SensorDelta, v: number) {
  return v.toFixed(d.unit === "mm/s" ? 2 : 1);
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center whitespace-nowrap">
      <span className="text-[13px] font-semibold text-ink-1">{title}</span>
      <span className="flex-1" />
      <span className="text-[11px] text-ink-3">{note}</span>
    </div>
  );
}

/**
 * v2 상세 카드 (Figma 7:23): 선택했을 때만 뜬다. 위 80 고정, 아래는 이벤트 카드 위 12.
 * 1024 높이에서 733, 800에서 509. 머리(닫기·제목·배지·부제·구분선)는 고정, 본문만 스크롤.
 */
export function DetailCard({
  equipment,
  detectedTime,
  onAdvisor,
  onClose,
  bottomOffset,
  plantRes,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const advisorRef = useRef<HTMLElement>(null);
  const hasAdvisor = Boolean(equipment.advisor);

  // 설명이 붙으면 본문을 그 위치로 스크롤해 버튼 바로 위에서 보이게 한다.
  useEffect(() => {
    if (hasAdvisor)
      advisorRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [hasAdvisor]);

  // an unexplained sensor alarm is still a warning on the map: the engine just found no cause for it
  const status = equipment.unexplained ? "warning" : equipment.status;
  const pill = equipment.unexplained ? { ...STATUS_PILL.warning, label: "주의 · 원인 미상" } : STATUS_PILL[status];
  const deltas = equipment.sensorDeltas ?? [];
  const candidates = equipment.causeCandidates ?? [];
  const evidenceCount = candidates.reduce((n, c) => n + c.evidence.length, 0);
  // the actions belong to the best candidate: with no cause found there is nothing to recommend yet
  const actions = equipment.unexplained
    ? []
    : (equipment.advisor?.recommendedActions ?? candidates[0]?.recommendedActions ?? []).slice(0, 3);

  function handleAdvisorCta() {
    setError(null);
    const output = explainWithAdvisor({
      equipmentNameKo: equipment.nameKo,
      sensorDeltas: deltas,
      causeCandidates: candidates,
    });
    if (!assertAdvisorRespectsCandidates(output, candidates)) {
      setError("Advisor가 후보 밖 원인을 만들려 해 차단됨");
      return;
    }
    // Only the explanation area updates; candidates and scores stay as the engine left them.
    onAdvisor(equipment.id, {
      summary: output.summary,
      primaryCause: output.primaryCause,
      evidenceExplanation: output.evidenceExplanation,
      recommendedActions: output.recommendedActions,
      usedCauses: output.usedCauses,
    });
  }

  return (
    <aside
      data-map-obstacle
      aria-label={`${equipment.nameKo} 상세`}
      className="absolute right-4 top-20 z-10 flex w-[384px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      style={{ bottom: bottomOffset }}
    >
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-2 pt-3.5">
        <div className="flex items-center">
          <span className="whitespace-nowrap text-[11px] font-medium text-ink-3">
            {status === "normal" ? "선택한 장비" : "주의가 필요한 장비"} · Rule
            Engine 판단 · Advisor 설명
          </span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="상세 카드 닫기"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg border border-line text-ink-1 hover:bg-bg"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-ink-1">
              {equipment.nameKo}
            </h2>
            <span
              className={`flex gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold ${pill.cls}`}
            >
              {pill.bang ? <span className="font-bold">!</span> : null}
              {pill.label}
            </span>
          </div>
          <p className="text-xs text-ink-2">
            {equipment.kind} · {equipment.coolingLine} · {equipment.powerZone}
          </p>
          {status !== "normal" && detectedTime ? (
            <p className="text-[11px] text-ink-3">
              {detectedTime} 감지 · 이상 점수{" "}
              {equipment.anomalyScore.toFixed(2)}
            </p>
          ) : null}
        </div>

        <div className="h-px shrink-0 bg-divider" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3.5">
        <section className="flex flex-col gap-0.5">
          <SectionHead title="센서 변화" note="기준 = 최근 300 s 평균" />
          {deltas.length ? (
            deltas.map((d) => (
              <div key={d.name} className="flex items-center gap-2 py-[5px]">
                <div className="flex w-[72px] shrink-0 flex-col whitespace-nowrap">
                  <span className="text-[13px] font-medium text-ink-1">
                    {d.name}
                  </span>
                  <span className="text-[10px] text-ink-3">
                    {SENSOR_EN[d.name] ?? ""}
                  </span>
                </div>
                <span className="min-w-0 flex-1 text-xs tabular-nums text-data">
                  {fmt(d, d.base)} → {fmt(d, d.current)} {d.unit}
                </span>
                <div className="flex shrink-0 flex-col items-end whitespace-nowrap text-warn-text">
                  <span className="text-xs font-semibold tabular-nums">
                    {d.changePct > 0 ? "+" : ""}
                    {d.changePct.toFixed(1)} %
                  </span>
                  <span className="text-[10px]">
                    {d.changePct >= 0 ? "↑" : "↓"} {d.trend}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="py-1 text-xs text-ink-3">센서 변화 없음</p>
          )}
        </section>

        <div className="h-px shrink-0 bg-divider" />

        {equipment.source === "injection" ? (
          <p className="text-[11px] text-ink-3">수동 주입은 센서 값이 아니라 변화율로 직접 들어가서, 이 동안은 센서 패널을 쓰지 않아요.</p>
        ) : plantRes ? (
          <section className="flex flex-col gap-2">
            <SectionHead title="센서" note="실시간 · 생성한 데모 값" />
            <LiveSensors id={equipment.id} res={plantRes} />
          </section>
        ) : null}

        <div className="h-px shrink-0 bg-divider" />

        <section className="flex flex-col gap-2">
          <SectionHead title={equipment.unexplained ? "참고 후보" : "가능성이 높은 원인"} note={equipment.unexplained ? "원인 미상" : "규칙 기반 분석"} />
          {equipment.unexplained ? (
            <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[11px] text-ink-2">
              원인 미상 · 센서는 벗어났지만 엔진이 판정할 만한 후보가 없어요(기준 0.5 미만). 엔진은 진동·전류·온도만 봐서, 위 센서 패널과 공급 연결을 같이 확인하세요.
            </p>
          ) : null}
          {candidates.length ? (
            candidates.map((c, i) => (
              <div
                key={c.cause}
                className={`flex flex-col gap-1.5 rounded-xl px-3 py-2.5 ${
                  i === 0 ? "bg-cand-1-card" : "bg-cand-n-card"
                }`}
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-xs font-semibold text-ink-3">
                    #{i + 1}
                  </span>
                  <span className="text-[13px] font-semibold text-ink-1">
                    {c.causeKo}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[13px] font-semibold tabular-nums text-data">
                    {c.confidence.toFixed(2)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-[2px] bg-cand-1-track">
                  <div
                    className={`h-1 rounded-[2px] ${i === 0 ? "bg-cand-1-bar" : "bg-cand-n-bar"}`}
                    style={{ width: `${Math.round(c.confidence * 100)}%` }}
                  />
                </div>
                {c.evidence.map((e) => (
                  <p key={e} className="text-[11px] text-ink-2">
                    · {e}
                  </p>
                ))}
              </div>
            ))
          ) : (
            <p className="py-1 text-xs text-ink-3">원인 후보 없음</p>
          )}
        </section>

        {equipment.advisor ? (
          <section
            ref={advisorRef}
            className="flex flex-col gap-1.5 rounded-xl bg-primary-subtle px-3 py-2.5"
          >
            <span className="text-[11px] font-semibold text-primary">
              Advisor 설명 · 판정은 엔진 결과 그대로
            </span>
            <p className="text-[13px] font-medium text-ink-1">
              {equipment.advisor.summary}
            </p>
            {equipment.advisor.evidenceExplanation.map((e) => (
              <p key={e} className="text-xs text-ink-2">
                · {e}
              </p>
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-1.5">
          <SectionHead title="권장 조치" note="점검 안내" />
          {actions.length ? (
            actions.map((a, i) => (
              <div key={a} className="flex items-center gap-2">
                <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[10px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-xs text-data">{a}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-ink-3">조치 없음</p>
          )}
        </section>
      </div>

      {/* 고정 바닥 (figma bro): 어드바이저 버튼만. 짧은 창(533)에서도 스크롤 없이 보인다. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-divider px-4 py-3">
        <button
          type="button"
          onClick={handleAdvisorCta}
          disabled={!candidates.length || equipment.unexplained}
          className="flex w-full shrink-0 flex-col items-center gap-0.5 rounded-xl bg-primary py-2.5 whitespace-nowrap hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="text-sm font-semibold text-surface">
            어드바이저 설명 보기
          </span>
          {candidates.length ? (
            <span className="text-[11px] text-on-primary-sub">
              후보 {candidates.length} · 근거 {evidenceCount}
            </span>
          ) : null}
        </button>
        {!candidates.length || equipment.unexplained ? (
          <p className="text-center text-[11px] text-ink-3">
            {equipment.unexplained ? "원인 미상이라 설명할 후보가 없어요" : "원인 후보가 있을 때 설명할 수 있어요"}
          </p>
        ) : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </aside>
  );
}
