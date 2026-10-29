import type { Direction, Variable } from "./types";

const NBSP = "\u00A0";

const nfTemp = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const nfHum = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const nfThreshold = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export const EMPTY_BIG = "Sin dato";
export const EMPTY_SMALL = "—";

export function unit(v: Variable): string {
  return v === "temperature" ? "°C" : "%";
}

export function variableLabel(v: Variable): string {
  return v === "temperature" ? "Temperatura" : "Humedad";
}

export function directionSign(d: Direction): string {
  return d === "gte" ? "≥" : "≤";
}

/** Número sin unidad. */
export function fmtPlain(v: Variable, n: number | null): string {
  if (n === null) return EMPTY_SMALL;
  return v === "temperature" ? nfTemp.format(n) : nfHum.format(n);
}

/** Número con unidad. */
export function fmtValue(v: Variable, n: number | null): string {
  if (n === null) return EMPTY_SMALL;
  return `${fmtPlain(v, n)}${NBSP}${unit(v)}`;
}

export function fmtThreshold(v: Variable, n: number): string {
  return `${nfThreshold.format(n)}${NBSP}${unit(v)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** HH:MM en hora local. */
export function fmtClock(ms: number | null): string {
  if (ms === null) return EMPTY_SMALL;
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const dayFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

export function fmtDay(ms: number): string {
  return dayFmt.format(new Date(ms)).replace(".", "");
}

export function fmtAxis(n: number, decimals: number): string {
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
