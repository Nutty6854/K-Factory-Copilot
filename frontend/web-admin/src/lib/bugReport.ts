/*
 * "문제 보고": a JSON file the user can download when something looks wrong, so the problem can be reproduced later.
 * Nothing is sent anywhere. The file holds what the app already knows (state, recent events, injected faults) plus a
 * short rolling record of errors and clicks. No typed text is recorded: clicks keep only the visible label of the
 * button, and there is no personal data in this app to begin with.
 */

type ErrorNote = { t: string; kind: string; message: string; stack?: string };
type ActionNote = { t: string; what: string };

const MAX_ERRORS = 50;
const MAX_ACTIONS = 40;
const errors: ErrorNote[] = [];
const actions: ActionNote[] = [];
let installed = false;

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const now = () => new Date().toISOString();

function note(kind: string, message: unknown, stack?: unknown) {
  errors.push({ t: now(), kind, message: clip(message, 500), stack: stack ? clip(stack, 1500) : undefined });
  if (errors.length > MAX_ERRORS) errors.shift();
}

/** Start the rolling record once per page load. Safe to call again. */
export function installBugCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => note("error", ev.message, (ev.error as Error | undefined)?.stack));
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason as Error | string | undefined;
    note("promise", typeof r === "string" ? r : r?.message, typeof r === "string" ? undefined : r?.stack);
  });
  // the 3D view can lose its GL context on weak GPUs; the event does not bubble, so listen while it travels down
  window.addEventListener("webglcontextlost", () => note("webgl", "WebGL context lost"), true);
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    note("console.error", args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : safe(a))).join(" "));
    orig.apply(console, args);
  };
  window.addEventListener(
    "click",
    (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest?.("button, a, [role=button], label, input, select, summary");
      if (!el) return;
      const tag = el.tagName.toLowerCase();
      // inputs are named by type only: never record what was typed or chosen
      const label = tag === "input" || tag === "select" ? `${tag}[${(el as HTMLInputElement).type ?? ""}]` : clip(el.textContent?.replace(/\s+/g, " ").trim(), 40);
      actions.push({ t: now(), what: `${tag} ${label}` });
      if (actions.length > MAX_ACTIONS) actions.shift();
    },
    true,
  );
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function gpu(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch {
    return null;
  }
}

function stored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return "unreadable";
  }
}

/** state: whatever the caller wants to include (the app's own picture of itself) */
export function buildReport(state: Record<string, unknown>, note_?: string) {
  return {
    kind: "k-factory-copilot-problem-report",
    version: 1,
    createdAt: now(),
    note: note_ ?? null,
    page: {
      url: location.href,
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      gpu: gpu(),
    },
    state,
    storage: {
      plantInjected: stored("kfc.plantInjected.v1"),
      mapColor: stored("kfc.mapColor.v1"),
    },
    recentErrors: [...errors],
    recentActions: [...actions],
  };
}

/** NaN and Infinity are not valid JSON: write them as null so the file always opens */
export function downloadReport(report: object) {
  const json = JSON.stringify(report, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  a.href = url;
  a.download = `kfc-report-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
