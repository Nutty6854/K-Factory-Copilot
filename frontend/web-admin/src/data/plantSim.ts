import { cycleOf, equipmentById, footprintOf, profile, takt, typeOf, type Instance } from "@/data/factoryProfile";
import { ON_BELT, POSITIONER_DX, pathOf, positionerTurn, turnAbout } from "./machinePaths";
import type { Resolved, Status } from "@/data/plantStatus";

/*
 * Visual material-flow simulation of the line, driven by the factory profile only:
 *  - a carrier is released every takt time at the first machine of the flow,
 *  - it moves along the profile's flow legs (conveyor / cart / manual speeds are our assumptions),
 *  - at each machine it dwells for the machine's derived cycle time (cycleOf), one part at a time,
 *  - warning slows a machine, abnormal stops it, and the queue builds up behind it.
 * Speeds, carrier spacing and "one part per machine" are simplifications for the picture, not a plant model.
 */

export type ActState = "run" | "idle" | "slow" | "fault";
export type Act = { busy: boolean; progress: number; status: Status; state: ActState; processed: number; busySec: number; waiting: number };

export type Token = { id: number; leg: Leg | null; s: number; phase: "move" | "proc"; node: string | null; progress: number; arrivedAt: number; mode: string; x: number; y: number; z: number; rot: number; hidden: boolean; px: number; pz: number; done?: boolean; /** the machine the carrier came from (what it carries depends on it) */ src?: string; /** the transfer cart under the carrier: where it stands, and whether it waits parked at a machine's dock while the carrier is inside */ cart: boolean; cx: number; cz: number; cr: number; park: boolean; inLeg?: Leg | null; /** heading when the carrier arrived at the machine (the positioner turns the tray from here) */ r0?: number; /** tilt about the x axis while the tray lies on an inclined belt (the laser's ramp) */ pitch?: number };

/** An empty transfer cart driving back along the leg it came on, then leaving the scene. */
export type Ghost = { leg: Leg; d: number; stop: number; x: number; z: number; rot: number; fade: number };

export type Leg = { from: string; to: string; mode: string; pts: [number, number][]; len: number; cum: number[] };

const SPEED: Record<string, number> = { conveyor: 0.25, cart: 0.8, manual: 0.6 }; // m per simulated second (assumed)
const GAP = 0.62; // m between carriers
const MAX_BACKLOG = 3;
const MAX_WIP = 44; // keeps the carrier pool in the 3D view large enough to show every carrier
export const SIM_TICK = 0.5;

/* Material stocks. All numbers are our assumptions (the profile only says there is a raw-material rack, a packing station and two stock zones). */
export const RACK_CAP = 40; // blanks the raw rack holds
export const RACK_LOW = 16; // the cart is called when the rack is down to this
export const REFILL = 24; // blanks on one pallet from the receiving stock
export const BATCH = 8; // cartons on one pallet at the packing station
export const OUT_BLOCKS = 6; // pallet places in the shipping stock (a truck clears it when full and the next pallet arrives)
const RACK_ID = profile.equipment.find((e) => e.type === "raw_rack")?.id;
const PACK_ID = profile.equipment.find((e) => e.type === "packing_station")?.id;
const STOCK_OUT_ID = profile.equipment.find((e) => e.id === "stock_out_01")?.id;

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centre = (id: string): [number, number] => {
  const e = equipmentById(id)!;
  return [e.position_m.x, e.position_m.y];
};

function buildLeg(from: string, to: string, mode: string, way?: [number, number][], route?: [number, number][]): Leg {
  const pts: [number, number][] = route && route.length > 1 ? route : [centre(from), ...(way ?? []), centre(to)];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { from, to, mode, pts, len: cum[cum.length - 1], cum };
}

/** Point along a leg at distance s. */
export function pointOn(leg: Leg, s: number): [number, number] {
  const ss = Math.max(0, Math.min(leg.len, s));
  for (let i = 1; i < leg.pts.length; i++) {
    if (ss <= leg.cum[i] || i === leg.pts.length - 1) {
      const seg = leg.cum[i] - leg.cum[i - 1] || 1;
      const k = (ss - leg.cum[i - 1]) / seg;
      return [leg.pts[i - 1][0] + (leg.pts[i][0] - leg.pts[i - 1][0]) * k, leg.pts[i - 1][1] + (leg.pts[i][1] - leg.pts[i - 1][1]) * k];
    }
  }
  return leg.pts[leg.pts.length - 1];
}

/** A fixture / positioner is worked by the robot standing next to it (same x). */
/** The x where the tray stands while the robot works on it: the fixture's centre, or the positioner's entry plate. */
const stationX = (f: Instance) => f.position_m.x - (f.type === "positioner_2station" ? POSITIONER_DX : 0);
export function robotFor(e: Instance): Instance | null {
  if (e.type !== "fixture" && e.type !== "positioner_2station") return null;
  return profile.equipment.find((r) => r.type === "robot_arm" && Math.abs(r.position_m.x - stationX(e)) < 0.5) ?? null;
}
export function fixtureFor(robot: Instance): Instance | null {
  return profile.equipment.find((f) => (f.type === "fixture" || f.type === "positioner_2station") && Math.abs(stationX(f) - robot.position_m.x) < 0.5) ?? null;
}

const dwellOf = (id: string): number => {
  const e = equipmentById(id);
  if (!e) return 0;
  const own = cycleOf(e);
  if (own) return own.seconds;
  const r = robotFor(e);
  const via = r ? cycleOf(r) : null;
  return via ? via.seconds : 0;
};

/** Machines that take the part inside: the carrier is out of sight while it is being worked. */
const ENCLOSED = new Set(["inspection_station", "laser_marker"]);
/** The line runs through these: the carrier rolls in at one doorway, travels inside while it is worked and rolls out at the other. */
const THROUGH = new Set(["deburring", "washer_dryer"]);

const FACTOR: Record<Status, number> = { normal: 1, warning: 0.6, abnormal: 0 };

export class PlantSim {
  t = 0;
  finished = 0;
  spawned = 0;
  /** blanks on the raw rack, finished cartons waiting at the packing station, in the shipping stock, and already trucked away */
  rack = RACK_CAP;
  packed = 0;
  stockOut = 0;
  shipped = 0;
  refills = 0;
  starved = false;
  finishTimes: number[] = [];
  tokens: Token[] = [];
  ghosts: Ghost[] = [];
  acts: Record<string, Act> = {};
  legs: Leg[];
  out: Record<string, Leg[]> = {};
  dwell: Record<string, number> = {};
  start: string;
  conveyors: { id: string; x0: number; x1: number; y0: number; y1: number }[];
  /** The stock carts shuttle between the receiving dock and the shipping dock; each starts at the end it is parked at. */
  agvs: AgvRunner[] = profile.equipment
    .filter((e) => e.type === "agv")
    .map((e, i) => new AgvRunner(e.id, e.position_m.x < (profile.factory.building_m.w ?? 54) / 2 ? "in" : "out", laneY + 0.7 * i, (a, st) => this.onAgvArrive(a, st)));
  private nextId = 1;
  private sinceSpawn = 0;
  private holder: Record<string, number | null> = {};

  constructor() {
    const flow = profile.flow.filter((f) => f.mode !== "agv");
    this.legs = flow.map((f) => buildLeg(f.from, f.to, f.mode, f.waypoints_m, f.route_m));
    for (const l of this.legs) (this.out[l.from] ??= []).push(l);
    const targets = new Set(this.legs.map((l) => l.to));
    this.start = this.legs.find((l) => !targets.has(l.from))?.from ?? this.legs[0].from;
    for (const e of profile.equipment) {
      this.acts[e.id] = { busy: false, progress: 0, status: "normal", state: "idle", processed: 0, busySec: 0, waiting: 0 };
      this.dwell[e.id] = dwellOf(e.id);
      this.holder[e.id] = null;
    }
    this.conveyors = profile.equipment
      .filter((e) => e.type === "conveyor")
      .map((e) => {
        const f = footprintOf(e);
        return { id: e.id, x0: e.position_m.x - f.w / 2, x1: e.position_m.x + f.w / 2, y0: e.position_m.y - f.d / 2, y1: e.position_m.y + f.d / 2 };
      });
  }

  reset() {
    this.t = 0;
    this.finished = 0;
    this.spawned = 0;
    this.rack = RACK_CAP;
    this.packed = 0;
    this.stockOut = 0;
    this.shipped = 0;
    this.refills = 0;
    this.starved = false;
    this.finishTimes = [];
    this.tokens = [];
    this.ghosts = [];
    this.sinceSpawn = 0;
    for (const a of this.agvs) a.reset();
    for (const id of Object.keys(this.acts)) {
      Object.assign(this.acts[id], { busy: false, progress: 0, state: "idle", processed: 0, busySec: 0, waiting: 0 });
      this.holder[id] = null;
    }
  }

  private load(id: string) {
    return this.tokens.filter((k) => (k.node === id && k.phase === "proc") || (k.leg?.to === id && k.phase === "move")).length;
  }

  private pickLeg(node: string): Leg | null {
    // a branch that leads into a dead end (the reject bin) is not used by the regular flow
    const opts = this.out[node]?.filter((l) => this.dwell[l.to] || this.out[l.to]);
    if (!opts?.length) return null;
    return opts.slice().sort((a, b) => this.load(a.to) - this.load(b.to))[0];
  }

  private frozen(k: Token, statuses: Record<string, Resolved>) {
    if (k.leg?.mode !== "conveyor") return false;
    return this.conveyors.some((c) => statuses[c.id]?.status === "abnormal" && k.x >= c.x0 - 0.05 && k.x <= c.x1 + 0.05 && Math.abs(k.z - (c.y0 + c.y1) / 2) < 1);
  }

  /** ease the carrier's height toward where it rests, so stepping onto a raised table does not pop */
  private glideTo(k: Token, y: number) {
    k.y = k.y > 0 ? k.y + (y - k.y) * 0.22 : y;
  }

  /** Where a carrier rests while a machine holds it: on the belt, a roller bed or a cart deck, which are all at the same height. */
  private restOf() {
    return ON_BELT;
  }

  private place(k: Token) {
    k.pitch = 0;
    if (k.leg && k.phase === "move") {
      const [x, z] = pointOn(k.leg, k.s);
      const [x2, z2] = pointOn(k.leg, k.s + 0.15);
      if (Math.hypot(x2 - x, z2 - z) > 1e-4) k.rot = Math.atan2(x2 - x, z2 - z);
      k.x = x;
      k.z = z;
      k.hidden = false;
      k.mode = k.leg.mode;
      // on a cart leg the carrier rides its transport cart, which drives along with it
      k.cart = k.leg.mode !== "conveyor";
      k.park = false;
      if (k.cart) {
        k.cx = x;
        k.cz = z;
        k.cr = k.rot;
      }
      this.glideTo(k, ON_BELT); // on the belt, or on its transport vehicle: the deck is at the same height
    } else if (k.node) {
      const e = equipmentById(k.node)!;
      k.x = k.px;
      k.z = k.pz;
      if (k.cart) {
        // the cart stays at the machine's dock while the carrier goes inside, and the carrier comes back down onto it
        if (THROUGH.has(e.type) || e.type === "laser_cutter" || e.type === "press_brake") {
          if (!k.park) {
            k.park = true;
            k.cx = k.px;
            k.cz = k.pz;
          }
        } else {
          k.cx = k.px;
          k.cz = k.pz;
        }
      }
      k.hidden = ENCLOSED.has(e.type);
      if (THROUGH.has(e.type)) {
        // the carrier is handed to the machine's belt and moves from the entry doorway to the exit doorway as the work progresses
        const exit = this.out[k.node]?.[0]?.pts[0];
        if (exit) {
          k.x = k.px + (exit[0] - k.px) * k.progress;
          k.z = k.pz + (exit[1] - k.pz) * k.progress;
        }
        k.mode = "conveyor";
      }
      if (e.type === "positioner_2station") {
        // the tray rests on the entry plate; at the end of the work the table turns half a revolution and carries it to the exit plate
        const turn = positionerTurn(k.progress);
        const o = turnAbout(k.px - e.position_m.x, k.pz - e.position_m.y, turn);
        k.x = e.position_m.x + o.x;
        k.z = e.position_m.y + o.z;
        k.rot = (k.r0 ?? k.rot) + turn;
        k.mode = "conveyor";
      }
      // the laser and the press brake take the carrier in: up the ramp onto the shelf and into the cell, or under the ram
      const inside = pathOf(e, k.px, k.pz, k.progress);
      if (inside) {
        k.x = inside.x;
        k.z = inside.z;
        k.mode = "conveyor";
        k.y = inside.y; // exactly on the belt or the ramp: no easing, the belt surface is where the tray is
        k.pitch = inside.pitch ?? 0;
        return;
      }
      this.glideTo(k, this.restOf());
    }
  }

  step(dt: number, statuses: Record<string, Resolved>) {
    this.t += dt;
    for (const e of profile.equipment) this.acts[e.id].status = statuses[e.id]?.status ?? "normal";
    for (const id of Object.keys(this.acts)) this.acts[id].waiting = 0;

    // release a carrier every takt time, unless the first leg is already backed up
    this.sinceSpawn += dt;
    const first = this.out[this.start]?.[0];
    this.starved = this.rack <= 0 && this.sinceSpawn >= takt();
    if (first && this.sinceSpawn >= takt() && this.tokens.length < MAX_WIP && this.rack > 0) {
      const onFirst = this.tokens.filter((k) => k.leg === first && k.phase === "move");
      if (onFirst.length < MAX_BACKLOG && !onFirst.some((k) => k.s < GAP)) {
        this.sinceSpawn = 0;
        this.rack--;
        const k: Token = { id: this.nextId++, leg: first, s: 0, phase: "move", node: null, progress: 0, arrivedAt: this.t, mode: first.mode, x: 0, y: 0, z: 0, rot: 0, hidden: false, px: 0, pz: 0, cart: false, cx: 0, cz: 0, cr: 0, park: false };
        this.tokens.push(k);
        this.spawned++;
        this.place(k);
      }
    }

    // machines: work on the held carrier
    for (const e of profile.equipment) {
      const a = this.acts[e.id];
      const hid = this.holder[e.id];
      const k = hid ? this.tokens.find((t) => t.id === hid) : null;
      const dwell = this.dwell[e.id];
      a.busy = false;
      a.state = a.status === "abnormal" ? "fault" : a.status === "warning" ? "slow" : "idle";
      if (!k || !dwell) continue;
      const f = FACTOR[a.status];
      if (k.progress < 1) {
        k.progress = Math.min(1, k.progress + (dt * f) / dwell);
        if (f > 0) {
          a.busy = true;
          a.busySec += dt;
          if (a.state === "idle") a.state = "run";
        }
        a.progress = k.progress;
      } else {
        a.progress = 1;
      }
    }

    // carriers that finished their dwell try to leave
    for (const k of this.tokens) {
      if (k.phase !== "proc" || k.progress < 1 || !k.node) continue;
      const node = k.node;
      const next = this.pickLeg(node);
      if (!next) {
        this.holder[node] = null;
        this.acts[node].processed++;
        this.acts[node].progress = 0;
        k.node = null;
        k.leg = null;
        this.finished++;
        this.packed++;
        this.finishTimes.push(this.t);
        k.done = true;
        continue;
      }
      if (this.tokens.some((o) => o !== k && o.leg === next && o.phase === "move" && o.s < GAP)) continue; // exit blocked
      this.holder[node] = null;
      this.acts[node].processed++;
      this.acts[node].progress = 0;
      if (k.cart && next.mode === "conveyor" && k.inLeg) {
        // the carrier leaves on a belt: its cart is empty now and drives back along the way it came
        const leg = k.inLeg;
        this.ghosts.push({ leg, d: 0, stop: Math.max(0.5, Math.min(leg.len * 0.7, leg.len - 1.5)), x: k.cx, z: k.cz, rot: k.cr + Math.PI, fade: 1 });
        k.cart = false;
      }
      k.park = false;
      k.leg = next;
      k.s = 0;
      k.phase = "move";
      k.node = null;
      k.progress = 0;
      k.arrivedAt = this.t;
    }
    this.tokens = this.tokens.filter((k) => !k.done);
    for (const g of this.ghosts) {
      if (g.d < g.stop) {
        g.d = Math.min(g.stop, g.d + 1.2 * dt);
        const s0 = g.leg.len - g.d;
        const [x, z] = pointOn(g.leg, s0);
        const [x2, z2] = pointOn(g.leg, s0 - 0.15);
        g.x = x;
        g.z = z;
        if (Math.hypot(x2 - x, z2 - z) > 1e-4) g.rot = Math.atan2(x2 - x, z2 - z);
      } else g.fade = Math.max(0, g.fade - dt / 0.8);
    }
    this.ghosts = this.ghosts.filter((g) => g.fade > 0);

    // move carriers along their legs, keeping a gap to the one ahead
    const byLeg = new Map<Leg, Token[]>();
    for (const k of this.tokens) if (k.phase === "move" && k.leg) (byLeg.get(k.leg) ?? byLeg.set(k.leg, []).get(k.leg)!).push(k);
    for (const [leg, ks] of byLeg) {
      ks.sort((a, b) => b.s - a.s);
      const v = SPEED[leg.mode] ?? 0.4;
      ks.forEach((k, i) => {
        if (!this.frozen(k, statuses)) {
          const limit = i === 0 ? leg.len : ks[i - 1].s - GAP;
          k.s = Math.max(k.s, Math.min(k.s + v * dt, limit));
        }
        this.place(k);
        if (k.s >= leg.len - 1e-6) this.acts[leg.to].waiting += 1;
      });
    }

    // machines accept the carrier that has waited longest at their entrance
    for (const e of profile.equipment) {
      if (this.holder[e.id] !== null) continue;
      const waiting = this.tokens.filter((k) => k.phase === "move" && k.leg?.to === e.id && k.s >= (k.leg?.len ?? 0) - 1e-6).sort((a, b) => a.arrivedAt - b.arrivedAt);
      if (!waiting.length) continue;
      const k = waiting[0];
      if (!this.dwell[e.id]) {
        // pass-through node (no cycle): carry straight on
        const next = this.pickLeg(e.id);
        if (next && !this.tokens.some((o) => o !== k && o.leg === next && o.phase === "move" && o.s < GAP)) {
          k.leg = next;
          k.s = 0;
          k.arrivedAt = this.t;
        }
        continue;
      }
      k.phase = "proc";
      k.node = e.id;
      k.progress = 0;
      const end = k.leg!.pts[k.leg!.pts.length - 1];
      k.px = end[0];
      k.pz = end[1];
      k.src = k.leg!.from;
      k.r0 = k.rot;
      k.inLeg = k.leg;
      k.leg = null;
      this.holder[e.id] = k.id;
      this.place(k);
    }
    // a carrier held by a machine follows the machine's own motion (through the tunnel, up the ramp, under the ram) and settles
    // onto its rest height over the next ticks (the positioner's table is raised)
    for (const k of this.tokens) {
      if (k.phase !== "proc" || !k.node) continue;
      this.place(k);
    }
    this.syncActs();
  }

  /** Make busy/state/progress describe the situation after this tick's carrier moves, not the one before. */
  private syncActs() {
    for (const e of profile.equipment) {
      const a = this.acts[e.id];
      const hid = this.holder[e.id];
      const k = hid ? this.tokens.find((t) => t.id === hid) : null;
      const dwell = this.dwell[e.id];
      a.state = a.status === "abnormal" ? "fault" : a.status === "warning" ? "slow" : "idle";
      if (!k || !dwell) {
        a.busy = false;
        continue;
      }
      a.busy = k.progress < 1 && FACTOR[a.status] > 0;
      if (a.busy) a.state = "run";
      a.progress = k.progress;
    }
  }

  /**
   * Real seconds, times `scale` when the line is fast-forwarded: the carts are part of the plant, so a refill must
   * keep up with the rack however fast the clock runs. A stopped cart stands still, a slowed one drives at 60 %.
   */
  stepAgvs(dt: number, scale = 1) {
    let left = dt * scale;
    while (left > 1e-6) {
      const d = Math.min(0.25, left);
      left -= d;
      for (const a of this.agvs) {
        const st = this.acts[a.id]?.status ?? "normal";
        if (a.idle && st !== "abnormal") {
          if (a.role === "in" && this.rack <= RACK_LOW) a.dispatch(REFILL_RACK);
          else if (a.role === "out" && this.packed >= BATCH) a.dispatch(SHIP_CARTONS);
        }
        if (st !== "abnormal") a.step(d * (st === "warning" ? 0.6 : 1));
        else a.speed = 0;
      }
    }
  }

  private onAgvArrive(a: AgvRunner, st: { to: string; act: AgvAct }) {
    if (a.role === "in" && st.to === "rackF" && st.act === "drop") {
      this.rack += REFILL;
      this.refills++;
    } else if (a.role === "out" && st.to === "dockR" && st.act === "full") {
      this.packed -= BATCH;
      a.carry = BATCH;
    } else if (a.role === "out" && st.to === "dropR" && st.act === "drop") {
      if (this.stockOut >= OUT_BLOCKS * BATCH) {
        this.shipped += this.stockOut; // a truck took the full stock away
        this.stockOut = 0;
      }
      this.stockOut += a.carry;
      a.carry = 0;
    }
  }

  /** How full a stock looks, 0..1; undefined for machines that show no fill. */
  levelOf(id: string): number | undefined {
    if (id === RACK_ID) return Math.max(0, this.rack) / RACK_CAP;
    if (id === PACK_ID) return Math.min(1, this.packed / BATCH);
    if (id === STOCK_OUT_ID) return Math.floor(this.stockOut / BATCH) / OUT_BLOCKS;
    return undefined;
  }

  /** Advance by `dt` simulated seconds in small ticks. */
  advance(dt: number, statuses: Record<string, Resolved>) {
    let left = dt;
    while (left > 1e-6) {
      const d = Math.min(SIM_TICK, left);
      this.step(d, statuses);
      left -= d;
    }
  }

  stats() {
    // output of the last 10 simulated minutes, so the start-up (empty line) does not drag the number down
    const window = 600;
    const recent = this.finishTimes.filter((x) => x > this.t - window).length;
    return { t: this.t, finished: this.finished, wip: this.tokens.length, uph: (recent / window) * 3600, ready: this.t >= window + 300, spawned: this.spawned, rack: this.rack, packed: this.packed, carrying: this.agvs.reduce((n, a) => n + a.carry, 0), stockOut: this.stockOut, shipped: this.shipped, refills: this.refills, starved: this.starved };
  }

  /** Where a robot should be working: the act of the fixture beside it. */
  robotAct(robot: Instance): Act | null {
    const f = fixtureFor(robot);
    return f ? this.acts[f.id] : null;
  }
}

export const typeName = (e: Instance) => typeOf(e).name_ko;

/**
 * The autonomous carts on the stock lane shuttle between the receiving dock (left) and the shipping dock
 * (right): a full pallet one way, an empty pallet back. Real-time speed, soft start and stop. Trip contents
 * are our assumption (the profile only says there is an AGV flow between the two zones).
 */
type Pt = [number, number];
export type AgvAct = "full" | "empty" | "drop";
export type Mission = { steps: { to: string; act: AgvAct }[] };

const stockIn = equipmentById("stock_in_01");
const stockOut = equipmentById("stock_out_01");
const packSt = equipmentById("pack_01");
const rack = profile.equipment.find((e) => e.type === "raw_rack");
const laneY = profile.flow.find((f) => f.mode === "agv")?.waypoints_m?.[0][1] ?? 13.6;
const NODES: Record<string, Pt> = {
  laneL: [4.4, laneY],
  laneR: [stockOut ? stockOut.position_m.x - 2.1 : 46.9, laneY],
  rackF: [rack?.position_m.x ?? 2.5, rack ? rack.position_m.y + footprintOf(rack).d / 2 + 0.7 : 9.4],
  cL: [4.4, stockIn ? stockIn.position_m.y - footprintOf(stockIn).d / 2 - 0.7 : 10.6],
  dockL: [stockIn?.position_m.x ?? 2.5, stockIn ? stockIn.position_m.y - footprintOf(stockIn).d / 2 - 0.7 : 10.6],
  cR: [stockOut ? stockOut.position_m.x - 2.1 : 46.9, packSt ? packSt.position_m.y + footprintOf(packSt).d / 2 + 0.9 : 10.3],
  dockR: [packSt ? packSt.position_m.x + footprintOf(packSt).w / 2 - 0.65 : 49.2, packSt ? packSt.position_m.y + footprintOf(packSt).d / 2 + 0.9 : 10.3],
  dropR: [stockOut?.position_m.x ?? 49, stockOut ? stockOut.position_m.y - footprintOf(stockOut).d / 2 - 0.45 : 10.85],
};
const LINKS: [string, string][] = [["laneL", "laneR"], ["laneL", "cL"], ["cL", "dockL"], ["dockL", "rackF"], ["laneR", "cR"], ["cR", "dockR"], ["dockR", "dropR"]];

function route(from: string, to: string, links: [string, string][]): string[] {
  const prev: Record<string, string | null> = { [from]: null };
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    if (n === to) break;
    for (const [a, b] of links) {
      const m = a === n ? b : b === n ? a : null;
      if (m && !(m in prev)) {
        prev[m] = n;
        q.push(m);
      }
    }
  }
  const out: string[] = [];
  for (let n: string | null = to; n; n = prev[n] ?? null) out.unshift(n);
  return out;
}

/** Left cart: a full pallet of blanks from the receiving stock to the rack, then back. Right cart: a pallet of cartons from packing to the shipping stock, then back. */
const REFILL_RACK: Mission = { steps: [{ to: "dockL", act: "full" }, { to: "rackF", act: "drop" }, { to: "dockL", act: "drop" }] };
const SHIP_CARTONS: Mission = { steps: [{ to: "dockR", act: "full" }, { to: "dropR", act: "drop" }, { to: "dockR", act: "drop" }] };

export class AgvRunner {
  x: number;
  z: number;
  rot = Math.PI / 2;
  payload: "none" | "full" | "empty" = "none";
  at: string;
  speed = 0;
  /** cartons on board (right cart) */
  carry = 0;
  private nodes: Record<string, Pt>;
  private cur: Mission | null = null;
  private stepIdx = 0;
  private path: Pt[] = [];
  private wait = 0;
  private home: "dockL" | "dockR";

  constructor(
    readonly id: string,
    /** "in": brings blanks from the receiving stock to the rack. "out": brings cartons from packing to the shipping stock. */
    readonly role: "in" | "out",
    laneZ: number,
    private onArrive: (a: AgvRunner, st: { to: string; act: AgvAct }) => void,
  ) {
    // each cart keeps to its own lane so two carts never drive through each other
    this.nodes = { ...NODES, laneL: [NODES.laneL[0], laneZ], laneR: [NODES.laneR[0], laneZ] };
    this.home = role === "in" ? "dockL" : "dockR";
    this.at = this.home;
    this.x = this.nodes[this.home][0];
    this.z = this.nodes[this.home][1];
  }

  reset() {
    Object.assign(this, { x: this.nodes[this.home][0], z: this.nodes[this.home][1], rot: Math.PI / 2, payload: "none", at: this.home, speed: 0, carry: 0, cur: null, stepIdx: 0, path: [], wait: 0 });
  }

  /** Waiting at its dock for the next errand. */
  get idle() {
    return !this.cur && this.wait <= 0;
  }

  dispatch(m: Mission) {
    this.cur = m;
    this.stepIdx = 0;
    this.path = [];
  }

  /** Real seconds. Drives at 1 m/s with a soft start and stop. */
  step(dt: number) {
    if (this.wait > 0) {
      this.wait -= dt;
      this.speed = 0;
      return;
    }
    if (!this.cur) {
      this.speed = 0;
      return;
    }
    if (!this.path.length) {
      const st = this.cur.steps[this.stepIdx];
      this.path = route(this.at, st.to, LINKS).slice(1).map((n) => this.nodes[n]);
      if (!this.path.length) return this.arrive();
    }
    const tgt = this.path[0];
    const dx = tgt[0] - this.x;
    const dz = tgt[1] - this.z;
    const d = Math.hypot(dx, dz);
    const wantRot = Math.atan2(dx, dz);
    let dr = wantRot - this.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    this.rot += dr * Math.min(1, dt * 4);
    const turning = Math.abs(dr) > 0.35;
    const last = this.path.length === 1;
    const target = turning ? 0.15 : last ? Math.max(0.2, Math.min(1, d)) : 1; // slow down into a dock
    this.speed += (target - this.speed) * Math.min(1, dt * 2.5);
    const adv = Math.min(d, this.speed * dt);
    if (d > 1e-6 && !turning) {
      this.x += (dx / d) * adv;
      this.z += (dz / d) * adv;
    }
    if (d < 0.05) {
      this.path.shift();
      if (!this.path.length) this.arrive();
    }
  }

  private arrive() {
    const st = this.cur!.steps[this.stepIdx];
    this.at = st.to;
    this.payload = st.act === "drop" ? "none" : st.act;
    this.wait = 1.6;
    this.speed = 0;
    this.stepIdx++;
    if (this.stepIdx >= this.cur!.steps.length) this.cur = null; // back at the dock: wait for the next errand
    this.onArrive(this, st);
  }
}
