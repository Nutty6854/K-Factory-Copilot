/**
 * 화면 틀용 임시 데이터. 실데이터(백엔드·실시간 3D)가 붙으면 이 파일만 교체한다.
 */
export const LINE_NAME = "라인 A";

export const STATUS_COUNTS = { normal: 8, warning: 0, abnormal: 1 };

export const OPERATOR = { initial: "A", name: "A조 · op-12", role: `${LINE_NAME} 운영자` };

export type EventLevel = "info" | "warn" | "alert";
export type FactoryEvent = { id: string; time: string; message: string; level: EventLevel };

/** "제목 · 보조" 형식. 첫 " · " 앞이 제목, 뒤가 보조 줄. */
export const RECENT_EVENTS: FactoryEvent[] = [
  { id: "e1", time: "12:41:03", message: "설명 생성 완료 · 베어링 마모 · 근거 3 · 미확인 1", level: "info" },
  { id: "e2", time: "12:40:52", message: "원인 후보 분석 · bearing_wear 0.78 · cooling_line_degradation 0.41", level: "info" },
  { id: "e3", time: "12:40:31", message: "이상 감지 · 로봇 03 · 진동 +42%", level: "alert" },
  { id: "e4", time: "12:38:10", message: "센서 경보 · 로봇 03 · 전류 +18%", level: "warn" },
];
