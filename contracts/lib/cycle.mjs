// Cycle-time models for the factory profile. Pure functions, no dependencies:
// used by scripts/check-factory-profile.mjs and by the web app.
//
// Every number a model uses comes from `model.params` (each with its own provenance),
// so the result carries an evidence level = the weakest parameter it relied on.

export const RANK = { assumed: 0, secondary: 1, sourced: 2 };
export const LEVEL_KO = { sourced: "직접 확인", secondary: "보조 출처", assumed: "가정" };
const NAME = ["assumed", "secondary", "sourced"];

export function evaluateCycle(model, part) {
  const terms = [];
  const P = (k) => {
    const p = model.params[k];
    if (!p) throw new Error(`cycle_model "${model.kind}" needs param "${k}"`);
    return p.value;
  };
  const T = (label, seconds, keys) => terms.push({ label, seconds, keys });
  const floorDiv = (a, b) => Math.max(1, Math.floor(a / b));

  switch (model.kind) {
    case "laser": {
      const perSheet = floorDiv(P("sheet_l_mm"), part.blank_mm.l + P("margin_mm")) * floorDiv(P("sheet_w_mm"), part.blank_mm.w + P("margin_mm"));
      T("절단", part.cut_length_m / (P("cut_speed_m_min") / 60), ["cut_speed_m_min"]);
      T("피어싱", part.pierces * P("pierce_s"), ["pierce_s"]);
      T("윤곽 간 이동", part.pierces * P("rapid_s_per_contour"), ["rapid_s_per_contour"]);
      T(`판 교체 ÷ ${perSheet}개`, P("sheet_change_s") / perSheet, ["sheet_change_s", "sheet_l_mm", "sheet_w_mm", "margin_mm"]);
      break;
    }
    case "press_brake": {
      T("램 하강(벤딩)", part.bends * (P("stroke_mm") / P("y_speed_mm_s")), ["stroke_mm", "y_speed_mm_s"]);
      T("램 접근·복귀", part.bends * P("approach_return_s"), ["approach_return_s"]);
      T("뒤집기·재위치", part.bends * P("handling_s_per_bend"), ["handling_s_per_bend"]);
      T("투입·배출", P("load_unload_s"), ["load_unload_s"]);
      break;
    }
    case "deburring": {
      T("통과", part.length_m / (P("feed_m_min") / 60), ["feed_m_min"]);
      T("투입·배출", P("handling_s"), ["handling_s"]);
      break;
    }
    case "washer": {
      T("벨브 피치", P("pitch_m") / (P("belt_m_min") / 60), ["pitch_m", "belt_m_min"]);
      break;
    }
    case "machining": {
      const feed = (P("spindle_rpm") / 60) * P("feed_mm_rev");
      T("진입", P("approach_s"), ["approach_s"]);
      T(`구멍 ${part.holes}개`, part.holes * (P("hole_approach_s") + part.hole_depth_mm / feed + P("hole_retract_s")), ["hole_approach_s", "hole_retract_s", "spindle_rpm", "feed_mm_rev"]);
      T("구멍 간 이동", Math.max(0, part.holes - 1) * P("move_s"), ["move_s"]);
      T("복귀", P("return_s"), ["return_s"]);
      break;
    }
    case "welding": {
      const robot = part.seams * (P("approach_s") + P("retract_s")) + part.seam_length_m / (P("travel_m_min") / 60);
      T("로봇 용접(접근·아크·후퇴)", robot, ["approach_s", "retract_s", "travel_m_min"]);
      T("포지셔너 회전", P("index_s"), ["index_s"]);
      // 2-station positioner: the operator loads the other side while the robot welds,
      // so loading only adds time when it is longer than robot + index.
      T("작업자 투입 대기(로봇보다 길 때만)", Math.max(P("load_unload_s") - (robot + P("index_s")), 0), ["load_unload_s"]);
      break;
    }
    case "inspection": {
      T("시점별 이동+스캔", P("views") * (P("move_s") + P("scan_s")), ["views", "move_s", "scan_s"]);
      T("분석", P("analysis_s"), ["analysis_s"]);
      T("투입·배출", P("load_unload_s"), ["load_unload_s"]);
      break;
    }
    case "marking": {
      T("마킹", P("mark_s"), ["mark_s"]);
      T("투입·배출", P("handling_s"), ["handling_s"]);
      break;
    }
    case "packing": {
      T("집어 넣기", P("pick_place_s"), ["pick_place_s"]);
      T(`상자 교체 ÷ ${part.parts_per_box}개`, P("box_change_s") / part.parts_per_box, ["box_change_s"]);
      break;
    }
    default:
      throw new Error(`unknown cycle model kind: ${model.kind}`);
  }

  // optional sampling: only a fraction of parts goes through this step
  let factor = 1;
  const usedAll = new Set(terms.flatMap((t) => t.keys));
  if (model.params.sampling_rate) {
    factor = model.params.sampling_rate.value;
    usedAll.add("sampling_rate");
  }
  for (const t of terms) {
    t.evidence = NAME[Math.min(...t.keys.map((k) => RANK[model.params[k].provenance.confidence]))];
  }
  const seconds = terms.reduce((a, t) => a + t.seconds, 0) * factor;
  const evidence = NAME[Math.min(...[...usedAll].map((k) => RANK[model.params[k].provenance.confidence]))];
  return { seconds, terms, evidence, factor, perPartSeconds: seconds };
}
