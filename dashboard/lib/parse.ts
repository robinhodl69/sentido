import type {
  ActionItem,
  AlertInfo,
  AlertRow,
  Direction,
  Reading,
  ReadingsData,
  Stats,
  Status,
  Variable,
} from "./types";

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function time(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function variable(v: unknown): Variable | null {
  return v === "temperature" || v === "humidity" ? v : null;
}

function direction(v: unknown): Direction | null {
  return v === "gte" || v === "lte" ? v : null;
}

function parseAlert(v: unknown): AlertInfo | null {
  if (!isRec(v)) return null;
  return {
    active: bool(v.active),
    variable: variable(v.variable),
    direction: direction(v.direction),
    threshold: num(v.threshold),
    since: time(v.since),
    emailSent: bool(v.emailSent),
  };
}

function parseActions(v: unknown): ActionItem[] {
  if (!Array.isArray(v)) return [];
  const out: ActionItem[] = [];
  for (const item of v) {
    if (!isRec(item)) continue;
    const tool = str(item.tool);
    if (tool === null) continue;
    out.push({ t: time(item.t), tool });
  }
  return out;
}

function parseAlertRows(v: unknown): AlertRow[] {
  if (!Array.isArray(v)) return [];
  const out: AlertRow[] = [];
  for (const item of v) {
    if (!isRec(item)) continue;
    out.push({
      t: time(item.t),
      variable: variable(item.variable),
      value: num(item.value),
      emailSent: bool(item.emailSent),
    });
  }
  return out;
}

export function parseStatus(raw: unknown): Status | null {
  if (!isRec(raw)) return null;
  const cur = isRec(raw.current)
    ? { temperature: num(raw.current.temperature), humidity: num(raw.current.humidity) }
    : null;
  const codex = isRec(raw.codex) ? raw.codex : {};
  return {
    lastReadingAt: time(raw.lastReadingAt),
    current: cur,
    alert: parseAlert(raw.alert),
    codex: {
      displayMessage: str(codex.displayMessage),
      led: str(codex.led),
      recentActions: parseActions(codex.recentActions),
    },
    alerts: parseAlertRows(raw.alerts),
  };
}

export function parseReadings(raw: unknown): ReadingsData | null {
  if (!isRec(raw) || !Array.isArray(raw.readings) || !isRec(raw.window) || !isRec(raw.stats)) return null;
  const from = time(raw.window.from);
  const to = time(raw.window.to);
  if (from === null || to === null || from >= to) return null;
  const readStats = (value: unknown): Stats | null => {
    if (!isRec(value)) return null;
    const min = num(value.min);
    const max = num(value.max);
    const avg = num(value.avg);
    return min === null || max === null || avg === null ? null : { min, max, avg };
  };
  const out: Reading[] = [];
  for (const item of raw.readings) {
    if (!isRec(item)) continue;
    const t = time(item.t);
    if (t === null || t < from || t > to) continue;
    const temperature = num(item.temperature);
    const humidity = num(item.humidity);
    if (temperature === null && humidity === null) continue;
    out.push({ t, temperature, humidity });
  }
  out.sort((a, b) => a.t - b.t);
  return {
    readings: out,
    window: { from, to },
    stats: { temperature: readStats(raw.stats.temperature), humidity: readStats(raw.stats.humidity) },
  };
}
