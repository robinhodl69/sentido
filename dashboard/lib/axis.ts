export interface Axis {
  min: number;
  max: number;
  step: number;
  decimals: number;
  ticks: number[];
}

const INTERVALS = 6;
const MANTISSAS = [1, 2, 2.5, 5, 10];

function niceStepAbove(raw: number, strict: boolean): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (let k = -1; k <= 1; k++) {
    for (const m of MANTISSAS) {
      const c = m * pow * Math.pow(10, k);
      if (strict ? c > raw * 1.0001 : c >= raw * 0.9999) return c;
    }
  }
  return raw;
}

function decimalsFor(step: number): number {
  for (let d = 0; d <= 4; d++) {
    const x = step * Math.pow(10, d);
    if (Math.abs(x - Math.round(x)) < 1e-6) return d;
  }
  return 4;
}

/** Eje con 6 intervalos iguales, rango calculado desde los datos con margen. */
export function buildAxis(dataMin: number, dataMax: number): Axis {
  let range = dataMax - dataMin;
  if (range <= 0) range = Math.max(Math.abs(dataMax) * 0.02, 1);
  const flat = dataMax - dataMin <= 0;
  const pad = flat ? range : range * 0.08;
  const lo0 = dataMin - pad;
  const hi0 = dataMax + pad;
  let step = niceStepAbove((hi0 - lo0) / INTERVALS, false);
  let lo = Math.floor(lo0 / step + 1e-9) * step;
  let guard = 0;
  while (lo + INTERVALS * step < hi0 - 1e-9 && guard++ < 20) {
    step = niceStepAbove(step, true);
    lo = Math.floor(lo0 / step + 1e-9) * step;
  }
  const decimals = decimalsFor(step);
  const ticks: number[] = [];
  for (let i = 0; i <= INTERVALS; i++) {
    ticks.push(Number((lo + i * step).toFixed(6)));
  }
  return { min: ticks[0], max: ticks[INTERVALS], step, decimals, ticks };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TIME_STEPS = [
  MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY,
];

export interface TimeTicks {
  ticks: number[];
  stepMs: number;
}

/** Marcas de tiempo alineadas a la hora local, máx. ~8. */
export function buildTimeTicks(t0: number, t1: number): TimeTicks {
  const span = t1 - t0;
  let stepMs = TIME_STEPS[TIME_STEPS.length - 1];
  for (const s of TIME_STEPS) {
    if (span / s <= 8) {
      stepMs = s;
      break;
    }
  }
  const ticks: number[] = [];
  if (stepMs >= DAY) {
    const d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    const days = Math.round(stepMs / DAY);
    while (d.getTime() < t0) d.setDate(d.getDate() + days);
    while (d.getTime() <= t1 && ticks.length < 20) {
      ticks.push(d.getTime());
      d.setDate(d.getDate() + days);
    }
  } else {
    const off = new Date(t0).getTimezoneOffset() * MIN;
    let t = Math.ceil((t0 - off) / stepMs) * stepMs + off;
    while (t <= t1 && ticks.length < 20) {
      ticks.push(t);
      t += stepMs;
    }
  }
  return { ticks, stepMs };
}

/** Curva monótona (sin sobreimpulso) como path SVG. */
export function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  const f = (v: number) => v.toFixed(1);
  if (n === 1) return `M${f(pts[0][0])},${f(pts[0][1])}`;
  const dx: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = pts[i + 1][0] - pts[i][0];
    dx.push(d);
    s.push(d > 0 ? (pts[i + 1][1] - pts[i][1]) / d : 0);
  }
  const tg: number[] = new Array(n).fill(0);
  tg[0] = s[0];
  tg[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) {
      tg[i] = 0;
    } else {
      const c = dx[i - 1] + dx[i];
      tg[i] = (3 * c) / ((c + dx[i]) / s[i - 1] + (c + dx[i - 1]) / s[i]);
    }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${f(x0 + h)},${f(y0 + tg[i] * h)} ${f(x1 - h)},${f(y1 - tg[i + 1] * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
