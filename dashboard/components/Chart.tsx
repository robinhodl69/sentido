"use client";

import { useEffect, useRef, useState } from "react";
import { buildAxis, buildTimeTicks, monotonePath, type Axis } from "@/lib/axis";
import { fmtAxis, fmtClock, fmtDay, fmtThreshold, variableLabel } from "@/lib/format";
import type { AlertInfo, Reading, Variable } from "@/lib/types";

const INK = "#16141F";
const VIOLET = "#6D3BF5";
const RED = "#E5484D";
const DAY = 24 * 60 * 60 * 1000;

interface Props {
  readings: Reading[];
  window: { from: number; to: number } | null;
  variable: Variable;
  alert: AlertInfo | null;
}

interface Size {
  w: number;
  h: number;
}

type Pt = [number, number]; // [t, value]

function useSize(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function series(readings: Reading[], key: Variable): Pt[] {
  const out: Pt[] = [];
  for (const r of readings) {
    const v = r[key];
    if (v !== null) out.push([r.t, v]);
  }
  return out;
}

function extent(pts: Pt[], extra: number | null): [number, number] | null {
  if (pts.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (p[1] < lo) lo = p[1];
    if (p[1] > hi) hi = p[1];
  }
  if (extra !== null) {
    lo = Math.min(lo, extra);
    hi = Math.max(hi, extra);
  }
  return [lo, hi];
}

/** Promedia por columnas cuando hay más puntos que píxeles. */
function downsample(pts: Pt[], maxPts: number): Pt[] {
  if (pts.length <= maxPts || maxPts < 2) return pts;
  const size = Math.ceil(pts.length / maxPts);
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += size) {
    const chunk = pts.slice(i, i + size);
    let t = 0;
    let v = 0;
    for (const p of chunk) {
      t += p[0];
      v += p[1];
    }
    out.push([t / chunk.length, v / chunk.length]);
  }
  return out;
}

/** No une intervalos largos sin lecturas; el servidor agrupa puntos en ventanas grandes. */
function splitSeries(points: Pt[], windowMs: number): Pt[][] {
  const maxGap = Math.max(30_000, (windowMs / 400) * 1.5);
  const groups: Pt[][] = [];
  for (const point of points) {
    const group = groups[groups.length - 1];
    if (!group || point[0] - group[group.length - 1][0] > maxGap) groups.push([point]);
    else group.push(point);
  }
  return groups;
}

function breaches(value: number, alert: AlertInfo): boolean {
  if (alert.threshold === null || alert.direction === null) return false;
  return alert.direction === "gte" ? value >= alert.threshold : value <= alert.threshold;
}

/** Instantes (ms) en que la serie cruza el umbral, interpolados. */
function crossings(pts: Pt[], alert: AlertInfo): number[] {
  const th = alert.threshold;
  if (th === null || alert.direction === null) return [];
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [t0, v0] = pts[i - 1];
    const [t1, v1] = pts[i];
    if (breaches(v0, alert) === breaches(v1, alert)) continue;
    const f = v1 === v0 ? 0 : (th - v0) / (v1 - v0);
    out.push(t0 + Math.min(1, Math.max(0, f)) * (t1 - t0));
  }
  return out;
}

export default function Chart({
  readings,
  window,
  variable,
  alert,
}: Props) {
  const [ref, size] = useSize();
  const points = series(readings, variable);
  const matchingAlert = alert?.variable === variable ? alert : null;

  return (
    <div className="chartBody" ref={ref}>
      {window && size.w > 0 && size.h > 0 && (
        <Plot size={size} points={points} window={window} variable={variable} alert={matchingAlert} />
      )}
      {points.length === 0 && <div className="chartEmpty">Sin datos en este periodo</div>}
    </div>
  );
}

function Plot({
  size,
  points,
  window,
  variable,
  alert,
}: {
  size: Size;
  points: Pt[];
  window: { from: number; to: number };
  variable: Variable;
  alert: AlertInfo | null;
}) {
  const { w, h } = size;
  const padL = 52;
  const padR = 24;
  const padT = 26;
  const padB = 30;
  const x0 = padL;
  const x1 = Math.max(x0 + 10, w - padR);
  const yTop = padT;
  const yBot = Math.max(yTop + 10, h - padB);

  const th = alert?.threshold ?? null;
  const bounds = extent(points, th);
  const axis: Axis | null = bounds ? buildAxis(bounds[0], bounds[1]) : null;
  const color = variable === "temperature" ? INK : VIOLET;

  const tMin = window.from;
  const tMax = window.to;
  const xOf = (t: number) => x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0);
  const yOf = (v: number) =>
    axis ? yBot - ((v - axis.min) / (axis.max - axis.min)) * (yBot - yTop) : yBot;

  const { ticks: xTicks, stepMs } = buildTimeTicks(tMin, tMax);
  const dayLabels = stepMs >= DAY;
  const maxTicks = Math.max(2, Math.floor((x1 - x0) / 80));
  const tickStride = Math.max(1, Math.ceil(xTicks.length / maxTicks));

  const maxPts = Math.max(2, Math.floor((x1 - x0) / 2));
  const groups = splitSeries(points, tMax - tMin);

  // Umbral y marcadores (solo si existe umbral para una variable con datos)
  const thY = axis && th !== null ? yOf(th) : null;
  const marks: number[] = [];
  if (thY !== null && alert) {
    let last = -Infinity;
    for (const t of groups.flatMap((group) => crossings(group, alert))) {
      const x = xOf(t);
      if (x - last >= 8) {
        marks.push(x);
        last = x;
      }
    }
  }

  return (
    <svg
      className="plot"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Histórico de ${variableLabel(variable).toLowerCase()}`}
    >
      {axis?.ticks.map((v, i) => {
          const y = yOf(v);
          return <line key={`g${i}`} x1={x0} x2={x1} y1={y} y2={y} stroke="#EEECF4" />;
        })}
      {axis?.ticks.map((v, i) => (
          <text key={`l${i}`} x={x0 - 12} y={yOf(v) + 4} textAnchor="end" className="ax">
            {fmtAxis(v, axis.decimals)}
          </text>
        ))}
      {xTicks.filter((_, i) => i % tickStride === 0).map((t) => (
        <g key={`x${t}`}>
          <line x1={xOf(t)} x2={xOf(t)} y1={yBot} y2={yBot + 5} stroke="#CFCCDB" />
          <text x={xOf(t)} y={yBot + 22} textAnchor="middle" className="ax">
            {dayLabels ? fmtDay(t) : fmtClock(t)}
          </text>
        </g>
      ))}
      <line x1={x0} x2={x1} y1={yBot} y2={yBot} stroke="#CFCCDB" />

      {thY !== null && th !== null && (
        <>
          <line
            x1={x0}
            x2={x1}
            y1={thY}
            y2={thY}
            stroke={RED}
            strokeWidth={1.25}
            strokeDasharray="2 5"
            strokeLinecap="round"
          />
          <text x={x0 + 8} y={thY - 8} className="thr">
            {`Umbral ${fmtThreshold(variable, th)}`}
          </text>
        </>
      )}

      {groups.map((group, i) => group.length === 1 ? (
        <circle key={i} cx={xOf(group[0][0])} cy={yOf(group[0][1])} r={3} fill={color} />
      ) : (
        <path key={i} d={monotonePath(downsample(group, maxPts).map(([t, v]) => [xOf(t), yOf(v)] as Pt))}
          fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      ))}

      {thY !== null &&
        marks.map((x, i) => (
          <circle key={`m${i}`} cx={x} cy={thY} r={4.5} fill={RED} stroke="#fff" strokeWidth={1.5} />
        ))}
    </svg>
  );
}
