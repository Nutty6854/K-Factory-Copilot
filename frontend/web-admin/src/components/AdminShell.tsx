"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  INITIAL_EQUIPMENT,
  INITIAL_EVENTS,
  SCENARIOS,
  anomalyScoreFor,
  buildDeltas,
  type Equipment,
  type FactoryEvent,
  type HistoryEntry,
  type Resolution,
  type SensorDelta,
  type Scenario,
  type Strength,
} from "@/data/demo";
import { runRuleEngine, statusFromCandidates } from "@/lib/ruleEngine";
import { monitorRobot } from "@/lib/sensorMonitor";
import { equipmentById } from "@/data/factoryProfile";
import { nameOf, resolveStatus } from "@/data/plantStatus";
import { useSharedInjected } from "@/data/plantState";
import { chipCounts } from "@/data/chipScope";
import { TopBar } from "@/components/TopBar";
import { Sidebar, type Tab } from "@/components/Sidebar";
import { DetailCard } from "@/components/DetailCard";
import { EventCard } from "@/components/EventCard";
import { EquipmentView } from "@/components/EquipmentView";
import { ExplainView } from "@/components/ExplainView";
import { EventsView } from "@/components/EventsView";
import { InjectorView, type InjectRequest } from "@/components/InjectorView";
import { HistoryView } from "@/components/HistoryView";
import { TrainingView } from "@/components/TrainingView";
import type { TrainScene } from "@/lib/training";
import { buildReport, downloadReport, installBugCapture } from "@/lib/bugReport";

// the same scene as /lab/plant (status, fault spread, sensors, environment), bound to this app's selection and verdicts
const PlantMap = dynamic(() => import("@/components/lab/arm/PlantOverview").then((m) => m.PlantOverview), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-2">
      맵 로딩…
    </div>
  ),
});

const FactoryMap = dynamic(
  () => import("@/components/FactoryMap").then((m) => m.FactoryMap),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-2">
        맵 로딩…
      </div>
    ),
  },
);

const HISTORY_KEY = "kfc.injectHistory.v1";

function nowClock() {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const cloneEquipment = () => INITIAL_EQUIPMENT.map((e) => structuredClone(e));

/** Close the open incidents that match (all of them when no filter is given) without touching their snapshots. */
function closeIncidents(rows: HistoryEntry[], how: Resolution["how"], match?: (h: HistoryEntry) => boolean): HistoryEntry[] {
  const resolution: Resolution = { at: new Date().toISOString(), time: nowClock(), how };
  return rows.map((h) => (!h.resolution && (!match || match(h)) ? { ...h, resolution } : h));
}

export function AdminShell() {
  const [equipment, setEquipment] = useState<Equipment[]>(cloneEquipment);
  const [events, setEvents] = useState<FactoryEvent[]>(INITIAL_EVENTS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("지도");
  const line = "라인 A";
  const [eventsExpanded, setEventsExpanded] = useState(false);
  // Collapsed event card height; the detail card ends 12 px above it (figma bro chrome spec).
  const [eventCardH, setEventCardH] = useState(183);
  // filled in after mount: a clock rendered on the server would never match the client's second
  const [clock, setClock] = useState("--:--:--");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setClock(nowClock());
    const id = setInterval(() => setClock(nowClock()), 1000);
    return () => clearInterval(id);
  }, []);

  // The seed event in demo.ts carries a fixed time; stamp it with the real clock on first mount.
  useEffect(() => {
    const now = nowClock();
    setEvents((prev) => prev.map((e) => (e.id === INITIAL_EVENTS[0]?.id ? { ...e, time: now } : e)));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      // the machines' state is not stored, so an incident still open from the last session is over
      if (raw) setHistory(closeIncidents(JSON.parse(raw) as HistoryEntry[], "restart"));
    } catch {
      /* ignore corrupt storage */
    }
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history, historyLoaded]);

  // faults injected on the plant (shared with /lab/plant) and the status they give every machine
  const [plantInjected, setPlantInjected] = useSharedInjected();
  const plantStatus = useMemo(() => resolveStatus(plantInjected), [plantInjected]);

  // ?map=classic keeps the earlier neutral map available; the default is the /lab/plant scene
  const [classicMap, setClassicMap] = useState(false);
  // the drill the map is showing while the 훈련 tab is open (a copy of the plant model, never the real one)
  const [trainScene, setTrainScene] = useState<TrainScene | null>(null);
  // entering or leaving the drills starts with nothing selected on the map
  const inTrainTab = tab === "훈련";
  useEffect(() => setSelectedId(null), [inTrainTab]);
  useEffect(() => setClassicMap(new URLSearchParams(window.location.search).get("map") === "classic"), []);
  // the Rule Engine's verdict per robot, for the map
  const robotStatus = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e.status])), [equipment]);
  // which machines the chips count is decided in one place (data/chipScope.ts): the whole line
  const counts = useMemo(() => chipCounts(equipment, plantStatus), [equipment, plantStatus]);

  const selected = useMemo(
    () => equipment.find((e) => e.id === selectedId) ?? null,
    [equipment, selectedId],
  );

  const detectedTime = useMemo(
    () =>
      selected?.injectionId
        ? history.find((h) => h.id === selected.injectionId)?.time
        : undefined,
    [history, selected],
  );

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  function handleSelect(id: string | null) {
    setSelectedId(id || null);
  }

  type Detection = {
    equipmentId: string;
    scenario: Scenario | "sensor";
    strength: Strength | "자동";
    deltas: SensorDelta[];
    anomalyScore: number;
    source: "injection" | "sensor";
    /** first event line */
    headline: string;
    /** what the sensor monitor saw (sensor-raised rows only) */
    trigger?: string;
    /** extra info line under the Rule Engine line */
    note?: string;
  };

  /** The only place that calls the Rule Engine: deltas (injected or from the sensor monitor) → engine → map/panel + history snapshot. */
  function runDetection(d: Detection) {
    const target = INITIAL_EQUIPMENT.find((e) => e.id === d.equipmentId);
    if (!target) return;
    const engine = runRuleEngine({ equipmentId: d.equipmentId, scenario: d.scenario, sensorDeltas: d.deltas, anomalyScore: d.anomalyScore });
    const status = statusFromCandidates(engine.causeCandidates);
    // a sensor alarm the engine could not explain: say so instead of showing a 0.30 "1위" as if it were a finding.
    // Manual injections keep the engine's output exactly as before.
    const unexplained = d.source === "sensor" && status === "normal";

    const at = new Date().toISOString();
    const time = nowClock();
    const injectionId = `${d.source === "sensor" ? "sen" : "inj"}-${Date.now()}-${d.equipmentId}`;

    const snapshot: HistoryEntry = structuredClone({
      id: injectionId,
      at,
      time,
      equipmentId: d.equipmentId,
      equipmentNameKo: target.nameKo,
      scenario: d.scenario,
      strength: d.strength,
      trigger: d.trigger,
      unexplained: unexplained || undefined,
      status,
      anomalyScore: engine.anomalyScore,
      deltas: d.deltas,
      candidates: engine.causeCandidates,
    });

    setEquipment((prev) =>
      prev.map((eq) =>
        eq.id === d.equipmentId
          ? {
              ...eq,
              status,
              anomalyScore: engine.anomalyScore,
              sensorDeltas: structuredClone(d.deltas),
              causeCandidates: structuredClone(engine.causeCandidates),
              injectionId,
              source: d.source,
              unexplained: unexplained || undefined,
              advisor: undefined,
            }
          : eq,
      ),
    );
    // the machine can carry one picture at a time: an open incident on it gives way to the new one
    const previous = equipmentRef.current.find((e) => e.id === d.equipmentId)?.injectionId;
    setHistory((prev) => [snapshot, ...(previous ? closeIncidents(prev, "replaced", (h) => h.id === previous) : prev)]);

    const top = engine.causeCandidates[0];
    setEvents((prev) => [
      {
        id: `${injectionId}-1`,
        time,
        message: d.headline,
        level: status === "abnormal" ? "alert" : status === "warning" ? "warn" : "info",
      },
      {
        id: `${injectionId}-2`,
        time,
        message: unexplained
          ? "Rule Engine · 원인 미상 (후보 신뢰도가 기준 0.5 미만)"
          : top
            ? `Rule Engine · 1위 ${top.cause} ${top.confidence.toFixed(2)}`
            : "Rule Engine · 후보 없음",
        level: status === "abnormal" ? "alert" : "info",
      },
      ...(d.note ? [{ id: `${injectionId}-3`, time, message: d.note, level: "info" as const }] : []),
      ...prev,
    ]);
    return { status, target };
  }

  function handleInject({ equipmentId, scenario, strength }: InjectRequest) {
    const target = equipment.find((e) => e.id === equipmentId);
    if (!target) return;
    runDetection({
      equipmentId,
      scenario,
      strength,
      deltas: buildDeltas(scenario, strength),
      anomalyScore: anomalyScoreFor(strength),
      source: "injection",
      headline: `시나리오 주입: ${target.name} ${scenario} (${strength})`,
    });
    setSelectedId(equipmentId);

    const label = SCENARIOS.find((s) => s.id === scenario)?.id ?? scenario;
    showToast(`주입됨 · ${target.nameKo} · ${label}`);
  }

  /*
   * Sensor monitor: once a second, read the robots' sensors (plantSensors.ts) under whatever is injected on the
   * plant (shared with /lab/plant), and raise an alarm when the picture changes. A machine that carries a manual
   * injection is left alone until reset, so the injector's results never change.
   */
  const equipmentRef = useRef(equipment);
  equipmentRef.current = equipment;
  const runDetectionRef = useRef(runDetection);
  runDetectionRef.current = runDetection;
  const lastPicture = useRef<Record<string, string>>({});

  useEffect(() => {
    const tick = () => {
      for (const base of INITIAL_EQUIPMENT) {
        const current = equipmentRef.current.find((e) => e.id === base.id);
        const inst = equipmentById(base.id);
        if (!current || !inst || current.source === "injection") continue;
        const res = plantStatus[inst.id];
        const m = monitorRobot(inst, res, Date.now() / 1000);
        const picture = m.worst === "normal" ? "ok" : m.fingerprint;
        if (lastPicture.current[base.id] === picture) continue;
        lastPicture.current[base.id] = picture;

        if (m.worst === "normal") {
          if (current.source !== "sensor") continue;
          setEquipment((prev) =>
            prev.map((e) => (e.id === base.id ? { ...base, advisor: undefined } : e)),
          );
          if (current.injectionId) setHistory((prev) => closeIncidents(prev, "sensor", (h) => h.id === current.injectionId));
          const time = nowClock();
          setEvents((prev) => [{ id: `rec-${Date.now()}-${base.id}`, time, message: `센서 정상 복귀 · ${base.nameKo}`, level: "info" }, ...prev]);
          continue;
        }

        // the sensors the Rule Engine reads (vibration, current, temperature) first, then the supply readings
        const rank: Record<string, number> = { vib: 0, cur: 1, tmp: 2 };
        const seen = [...m.outside].sort((x, y) => (rank[x.def.id] ?? 9) - (rank[y.def.id] ?? 9)).map((r) => {
          const delta = m.deltas.find((d) => d.name === ({ vib: "진동", cur: "전류", tmp: "온도" } as Record<string, string>)[r.def.id]);
          const pct = delta ? ` (${delta.changePct > 0 ? "+" : ""}${delta.changePct}%)` : "";
          return `${r.def.label} ${r.value.toFixed(r.def.dec ?? 1)} ${r.def.unit}${pct}`;
        });
        const cause = res.cause;
        const result = runDetectionRef.current({
          equipmentId: base.id,
          scenario: "sensor",
          strength: "자동",
          deltas: m.deltas,
          anomalyScore: m.worst === "abnormal" ? 0.91 : 0.55,
          source: "sensor",
          headline: `센서 경보 · ${base.nameKo} · ${seen.slice(0, 2).join(", ")}${seen.length > 2 ? ` 외 ${seen.length - 2}` : ""}`,
          trigger: seen.join(" / "),
          note: cause ? `공급 연결: ${nameOf(cause.from)}의 ${cause.scenario.label} (프로필 연결 기준)` : undefined,
        });
        if (result) showToast(`센서 경보 · ${base.nameKo}`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [plantStatus]);

  // record errors and clicks from now on (for the problem report)
  useEffect(() => installBugCapture(), []);

  /** "문제 보고": download what is needed to reproduce a problem. Nothing leaves the browser. */
  function reportProblem() {
    const compact = (c: { cause: string; confidence: number }[] | undefined) => (c ?? []).slice(0, 3).map((x) => `${x.cause} ${x.confidence}`);
    downloadReport(
      buildReport({
        tab,
        selectedId,
        classicMap,
        chips: counts,
        plantInjected,
        equipment: equipment.map((e) => ({
          id: e.id,
          status: e.status,
          source: e.source ?? null,
          unexplained: e.unexplained ?? false,
          anomalyScore: e.anomalyScore,
          injectionId: e.injectionId ?? null,
          deltas: e.sensorDeltas ?? [],
          candidates: compact(e.causeCandidates),
          advisorShown: !!e.advisor,
        })),
        events: events.slice(0, 30),
        history: history.slice(0, 20).map((h) => ({
          id: h.id,
          time: h.time,
          equipmentId: h.equipmentId,
          scenario: h.scenario,
          strength: h.strength,
          status: h.status,
          unexplained: h.unexplained ?? false,
          trigger: h.trigger ?? null,
          candidates: compact(h.candidates),
          resolution: h.resolution ?? null,
          actionsDone: h.actionsDone ?? {},
        })),
      }),
    );
    showToast("문제 보고 파일을 내려받았어요");
  }

  function handleReset() {
    setPlantInjected({});
    lastPicture.current = {};
    setHistory((prev) => closeIncidents(prev, "reset"));
    setEquipment(cloneEquipment());
    setSelectedId(null);
    setEvents((prev) => [
      {
        id: `reset-${Date.now()}`,
        time: nowClock(),
        message: "초기화 · 라인 A 정상 복귀 (이력 유지)",
        level: "info",
      },
      ...prev,
    ]);
    showToast("초기화됨 · 이력은 유지돼요");
  }

  /** Advisor only explains. Attach to the matching history row once; never touch candidates. */
  function applyAdvisor(equipmentId: string, advisor: NonNullable<Equipment["advisor"]>) {
    const injectionId = equipment.find((e) => e.id === equipmentId)?.injectionId;
    setEquipment((prev) => prev.map((eq) => (eq.id === equipmentId ? { ...eq, advisor } : eq)));
    if (injectionId) {
      setHistory((prev) =>
        prev.map((h) =>
          h.id === injectionId && !h.advisor ? { ...h, advisor: structuredClone(advisor), advisorAt: nowClock() } : h,
        ),
      );
    }
  }

  /** Tick a recommended action of an incident on or off. Only the lifecycle changes, never the snapshot. */
  function toggleAction(incidentId: string, action: string) {
    setHistory((prev) =>
      prev.map((h) => {
        if (h.id !== incidentId || h.resolution) return h;
        const done = { ...(h.actionsDone ?? {}) };
        if (done[action]) delete done[action];
        else done[action] = nowClock();
        return { ...h, actionsDone: done };
      }),
    );
  }

  /**
   * Resolve an incident. A manual injection ends right away and the machine goes back to normal. A sensor alarm
   * ends when the sensors are back in range, so the fault behind it (on this machine or the one that feeds it)
   * is cleared on the plant and the monitor closes the incident once it sees normal readings.
   */
  function resolveIncident(incidentId: string) {
    const entry = history.find((h) => h.id === incidentId);
    if (!entry || entry.resolution) return;
    const base = INITIAL_EQUIPMENT.find((e) => e.id === entry.equipmentId);
    const current = equipment.find((e) => e.id === entry.equipmentId);
    if (!base || !current) return;
    const time = nowClock();
    const inst = equipmentById(base.id);
    const res = inst ? plantStatus[inst.id] : null;
    const rootId = res?.cause?.from ?? (res?.own && inst ? inst.id : null);
    if (current.injectionId === incidentId && current.source === "sensor" && rootId) {
      setPlantInjected((m) => {
        const n = { ...m };
        delete n[rootId];
        return n;
      });
      setEvents((prev) => [{ id: `fix-${Date.now()}-${base.id}`, time, message: `조치 완료 (시뮬레이션) · ${nameOf(rootId)} 원인 제거`, level: "info" }, ...prev]);
      showToast(`조치 완료 · ${nameOf(rootId)}`);
      return;
    }
    if (current.injectionId === incidentId) {
      setEquipment((prev) => prev.map((e) => (e.id === base.id ? { ...base, advisor: undefined } : e)));
    }
    setHistory((prev) => closeIncidents(prev, "manual", (h) => h.id === incidentId));
    setEvents((prev) => [{ id: `res-${Date.now()}-${base.id}`, time, message: `해결 처리 · ${base.nameKo}`, level: "info" }, ...prev]);
    showToast(`해결됨 · ${base.nameKo}`);
  }

  const tabView =
    tab === "장비" ? (
      <EquipmentView equipment={equipment} selectedId={selectedId} onSelect={handleSelect} />
    ) : tab === "설명" ? (
      <ExplainView selected={selected} />
    ) : tab === "이벤트" ? (
      <EventsView events={events} />
    ) : tab === "주입" ? (
      <InjectorView equipment={equipment} onInject={handleInject} onReset={handleReset} plantInjected={plantInjected} onPlantInject={(id, sc) => setPlantInjected((m) => { const n = { ...m }; if (sc) n[id] = sc; else delete n[id]; return n; })} />
    ) : tab === "이력" ? (
      <HistoryView history={history} onToggleAction={toggleAction} onResolve={resolveIncident} />
    ) : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-ink-1">
      {/* v2: the map fills the whole screen; every other piece floats on top of it as a card. */}
      {classicMap ? (
        <FactoryMap
          equipment={equipment}
          selectedId={selectedId}
          onSelect={handleSelect}
          showControls={tab === "지도"}
        />
      ) : (
        <PlantMap main={{ selectedId, onSelect: handleSelect, robotStatus, active: tab === "지도" || tab === "훈련", training: tab === "훈련" ? trainScene : null }} />
      )}
      <TopBar counts={counts} clock={clock} line={line} onReport={reportProblem} />
      <Sidebar tab={tab} onTab={setTab} />
      {tabView ? (
        <main data-map-obstacle className="absolute bottom-4 left-28 top-20 z-10 w-[912px] overflow-auto rounded-2xl border border-line bg-surface p-4 shadow-card">
          {tabView}
        </main>
      ) : null}
      {/* training: the map stays full screen and the questions live in a card on the right, like the detail card */}
      <aside
        data-map-obstacle
        aria-label="훈련"
        hidden={tab !== "훈련"}
        className="absolute right-4 top-20 z-10 w-[400px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        style={{ bottom: 16 + eventCardH + 12 }}
      >
        <TrainingView onScene={setTrainScene} active={tab === "훈련"} />
      </aside>
      {selected && tab !== "훈련" ? (
        <DetailCard
          key={selected.id}
          equipment={selected}
          detectedTime={detectedTime}
          plantRes={equipmentById(selected.id) ? plantStatus[selected.id] : undefined}
          bottomOffset={16 + eventCardH + 12}
          onAdvisor={applyAdvisor}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <EventCard
        events={events}
        context={selected ? selected.nameKo : line}
        expanded={eventsExpanded}
        onCollapsedHeight={setEventCardH}
        onToggle={() => setEventsExpanded((v) => !v)}
      />
      {toast ? (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-primary shadow-card"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
