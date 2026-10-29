"use client";

import { useState } from "react";
import Chart from "./Chart";
import Automations from "./Automations";
import { automationRunLabels, parseAutomations } from "@/lib/automations";
import {
  directionSign,
  EMPTY_BIG,
  EMPTY_SMALL,
  fmtClock,
  fmtPlain,
  fmtThreshold,
  fmtValue,
  variableLabel,
} from "@/lib/format";
import { usePolling, useNow } from "@/lib/hooks";
import { parseReadings, parseStatus } from "@/lib/parse";
import type { Stats, Variable } from "@/lib/types";

const STALE_MS = 30_000;

const PERIODS = [
  { minutes: 15, label: "15 min", suffix: "últimos 15 min" },
  { minutes: 60, label: "1 h", suffix: "última hora" },
  { minutes: 1440, label: "24 h", suffix: "últimas 24 h" },
  { minutes: 10080, label: "7 días", suffix: "últimos 7 días" },
] as const;

const LED_COLORS: Record<string, string> = {
  rojo: "#E5484D",
  verde: "#30A46C",
  azul: "#3E63DD",
  amarillo: "#F5A524",
  blanco: "#FFFFFF",
};

function ledColor(led: string | null): string | null {
  if (led === null) return null;
  const key = led
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return LED_COLORS[key] ?? null;
}

function statsLine(v: Variable, s: Stats | null, suffix: string): string {
  const f = (n: number | null) => fmtPlain(v, n);
  return `Mín ${f(s ? s.min : null)} · Máx ${f(s ? s.max : null)} · Prom ${f(s ? s.avg : null)} (${suffix})`;
}

export default function Dashboard() {
  const [view, setView] = useState<"overview" | "automations">("overview");
  const [minutes, setMinutes] = useState<number>(60);
  const status = usePolling("/api/status", parseStatus);
  const readingsData = usePolling(`/api/readings?minutes=${minutes}`, parseReadings);
  const automationData = usePolling("/api/automations", parseAutomations);
  const now = useNow();

  const period = PERIODS.find((p) => p.minutes === minutes) ?? PERIODS[1];
  const readings = readingsData?.readings ?? [];

  const lastAt = status?.lastReadingAt ?? null;
  const ageMs = lastAt !== null && now !== null ? Math.max(0, now - lastAt) : null;
  const fresh = ageMs !== null && ageMs <= STALE_MS;
  const current = fresh ? (status?.current ?? null) : null;
  const temperature = current?.temperature ?? null;
  const humidity = current?.humidity ?? null;

  const tStats = readingsData?.stats.temperature ?? null;
  const hStats = readingsData?.stats.humidity ?? null;

  const alert = status?.alert ?? null;
  const humThreshold =
    alert && alert.variable === "humidity" && alert.threshold !== null
      ? alert.threshold
      : null;

  const alertsLoaded = status !== null && automationData !== null;
  const rules = automationData?.automations ?? [];
  const configuredCount = rules.length + (alert ? 1 : 0);
  const enabledCount = rules.filter((rule) => rule.enabled).length + (alert ? 1 : 0);
  const pausedCount = configuredCount - enabledCount;
  const triggeredCount = rules.filter((rule) => rule.enabled && rule.active).length + (alert?.active === true ? 1 : 0);
  const alertHeadline = !alertsLoaded ? "Sin datos de alertas" : configuredCount === 0
    ? "Sin alertas configuradas"
    : `${configuredCount} ${configuredCount === 1 ? "alerta configurada" : "alertas configuradas"}`;
  const alertMeta = alertsLoaded && configuredCount > 0
    ? [
        pausedCount > 0 ? `${pausedCount} ${pausedCount === 1 ? "pausada" : "pausadas"}` : null,
        current === null ? "Sin lectura reciente" : `${triggeredCount} en umbral`,
      ].filter((item): item is string => item !== null)
    : [];

  const led = status?.codex.led ?? null;
  const swatch = ledColor(led);
  const message = status?.codex.displayMessage ?? null;
  const actions = [...(status?.codex.recentActions ?? [])]
    .sort((a, b) => (b.t ?? -Infinity) - (a.t ?? -Infinity))
    .slice(0, 3);
  const alertRows = [
    ...(status?.alerts ?? []).map((entry) => ({
      ...entry,
      key: `legacy-${entry.t}-${entry.variable}`,
      emailStatus: entry.emailSent === null ? EMPTY_SMALL : entry.emailSent ? "Enviado" : "No enviado",
    })),
    ...(automationData?.runs ?? []).map((run) => ({
      key: run.id,
      t: Date.parse(run.triggeredAt),
      variable: run.variable,
      value: run.value,
      emailStatus: automationRunLabels[run.status],
    })),
  ]
    .sort((a, b) => (b.t ?? -Infinity) - (a.t ?? -Infinity))
    .slice(0, 3);

  return (
    <main className="page">
      <header className="top">
        <div className="left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/logo.svg" alt="Sentido" />
          <div className={fresh ? "pill ok" : "pill idle"}>
            {fresh && ageMs !== null
              ? `Última lectura hace ${Math.floor(ageMs / 1000)} s`
              : EMPTY_BIG}
          </div>
        </div>
        <div className="headerActions">
          <nav className="seg" aria-label="Vista">
            <button type="button" className={view === "overview" ? "on" : undefined} aria-current={view === "overview" ? "page" : undefined} onClick={() => setView("overview")}>Resumen</button>
            <button type="button" className={view === "automations" ? "on" : undefined} aria-current={view === "automations" ? "page" : undefined} onClick={() => setView("automations")}>Automatizaciones</button>
          </nav>
        {view === "overview" && <div className="seg" role="group" aria-label="Periodo">
          {PERIODS.map((p) => (
            <button
              key={p.minutes}
              type="button"
              className={p.minutes === minutes ? "on" : undefined}
              aria-pressed={p.minutes === minutes}
              onClick={() => setMinutes(p.minutes)}
            >
              {p.label}
            </button>
          ))}
        </div>}
        </div>
      </header>

      {view === "overview" ? <>
      <section className="kpis">
        <div className="card">
          <div className="lbl">Temperatura</div>
          <div className={temperature === null ? "big empty" : "big"}>
            {temperature === null ? EMPTY_BIG : fmtValue("temperature", temperature)}
          </div>
          <div className="meta">{statsLine("temperature", tStats, period.suffix)}</div>
        </div>

        <div className="card vio">
          <div className="lbl">Humedad</div>
          <div className={humidity === null ? "big empty" : "big"}>
            {humidity === null ? EMPTY_BIG : fmtValue("humidity", humidity)}
          </div>
          <div className="meta">{statsLine("humidity", hStats, period.suffix)}</div>
          {humThreshold !== null && alert && (
            <div className="meta meta2">
              {`Umbral de alerta: ${alert.direction ? `${directionSign(alert.direction)} ` : ""}${fmtThreshold("humidity", humThreshold)}`}
            </div>
          )}
        </div>

        <div className="card">
          <div className="row">
            <div className="lbl">Alertas</div>
            {alertsLoaded && configuredCount > 0 && (
              <span className={enabledCount > 0 ? "pill ok" : "pill idle"}>
                {`${enabledCount} ${enabledCount === 1 ? "activada" : "activadas"}`}
              </span>
            )}
          </div>
          <div className={alertsLoaded && configuredCount > 0 ? "alt" : "alt empty"}>{alertHeadline}</div>
          {alertMeta.length > 0 && <div className="meta metaAlert">{alertMeta.join(" · ")}</div>}
        </div>
      </section>

      <section className="charts" aria-label="Histórico">
        <div className="card chart">
          <div className="row">
            <h2 className="lbl">Histórico de temperatura</h2>
            <span className="chartUnit">°C</span>
          </div>
          <Chart readings={readings} window={readingsData?.window ?? null} variable="temperature" alert={alert} />
        </div>
        <div className="card chart">
          <div className="row">
            <h2 className="lbl">Histórico de humedad</h2>
            <span className="chartUnit">%</span>
          </div>
          <Chart readings={readings} window={readingsData?.window ?? null} variable="humidity" alert={alert} />
        </div>
      </section>

      <section className="bottom">
        <div className="card">
          <div className="lbl">Codex</div>
          <div className="kv">
            <span className="k">Mensaje en pantalla:</span>
            <b>{message ?? EMPTY_SMALL}</b>
          </div>
          <div className="kv">
            <span className="k">LED:</span>
            {swatch && (
              <span
                className="sw"
                style={{ background: swatch, boxShadow: swatch === "#FFFFFF" ? "inset 0 0 0 1px #CFCCDB" : undefined }}
              />
            )}
            <b>{led ?? EMPTY_SMALL}</b>
          </div>
          <div className="sub">Acciones recientes</div>
          {actions.length === 0 ? (
            <div className="none">Sin acciones</div>
          ) : (
            <ul className="mono">
              {actions.map((a, i) => (
                <li key={`${a.t ?? "x"}-${a.tool}-${i}`}>
                  <span>{fmtClock(a.t)}</span>
                  {a.tool}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="lbl">Alertas</div>
          {!alertsLoaded ? (
            <div className="none">Sin datos de alertas</div>
          ) : alertRows.length === 0 ? (
            <div className="none">Sin alertas</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Hora</th>
                  <th style={{ width: "30%" }}>Variable</th>
                  <th style={{ width: "25%" }}>Valor</th>
                  <th>Correo</th>
                </tr>
              </thead>
              <tbody>
                {alertRows.map((r, i) => (
                  <tr key={`${r.key}-${i}`}>
                    <td>{fmtClock(r.t)}</td>
                    <td>{r.variable ? variableLabel(r.variable) : EMPTY_SMALL}</td>
                    <td>{r.variable ? fmtValue(r.variable, r.value) : EMPTY_SMALL}</td>
                    <td>
                      {r.emailStatus === EMPTY_SMALL ? (
                        EMPTY_SMALL
                      ) : (
                        <span className="tag">{r.emailStatus}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      </> : <Automations />}
    </main>
  );
}
