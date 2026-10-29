"use client";

import { useEffect, useState, type FormEvent } from "react";
import { automationRunLabels, directionSymbol, parseAutomations, parseEmailConnection, type Automation, type AutomationsData, type EmailConnection } from "@/lib/automations";
import { fmtThreshold, fmtValue, variableLabel } from "@/lib/format";

const PAGE_SIZE = 3;
const RUN_PAGE_SIZE = 2;
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

const emptyDraft = () => ({ name: "", variable: "temperature" as Automation["variable"], direction: "gt" as Automation["direction"], threshold: "", recipient: null as string | null, enabled: true });

function Pager({ page, total, size = PAGE_SIZE, onChange }: { page: number; total: number; size?: number; onChange: (page: number) => void }) {
  if (total <= size) return null;
  const pages = Math.ceil(total / size);
  return <div className="autoPager">
    <button type="button" className="textButton" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Página anterior">Anterior</button>
    <span>{page + 1} / {pages}</span>
    <button type="button" className="textButton" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label="Página siguiente">Siguiente</button>
  </div>;
}

export default function Automations() {
  const [data, setData] = useState<AutomationsData | null>(null);
  const [connection, setConnection] = useState<EmailConnection | null>(null);
  const [revision, setRevision] = useState(0);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [runPage, setRunPage] = useState(0);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    async function load() {
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      try {
        const response = await fetch("/api/automations", { cache: "no-store", signal: ctrl.signal });
        const result = response.ok ? parseAutomations(await response.json()) : null;
        if (!result) throw new Error("Sin conexión con el servidor");
        if (alive && controller === ctrl) { setData(result); setLoadError(""); }
      } catch {
        if (alive && controller === ctrl) setLoadError("No se pudieron cargar las automatizaciones.");
      } finally { clearTimeout(timeout); }
    }
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(interval); controller?.abort(); };
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const timeout = setTimeout(() => controller.abort(), 65_000);
    void (async () => {
      try {
        const response = await fetch("/api/email-connection", { cache: "no-store", signal: controller.signal });
        const result = response.ok ? parseEmailConnection(await response.json()) : null;
        if (!result) throw new Error("Sin respuesta");
        if (alive) setConnection(result);
      } catch {
        if (alive) setConnection({ connected: false, email: null, error: "No se pudo verificar la conexión de Gmail." });
      } finally { clearTimeout(timeout); }
    })();
    return () => { alive = false; controller.abort(); clearTimeout(timeout); };
  }, [connectionRevision]);

  async function mutate(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "No se pudo guardar");
      setRevision((n) => n + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error && err.name !== "AbortError" ? err.message : "No se pudo confirmar el cambio. Revisa la lista antes de repetirlo.");
      setRevision((n) => n + 1);
      return false;
    } finally { clearTimeout(timeout); setBusy(false); }
  }

  function reset() { setDraft(emptyDraft()); setEditingId(null); setError(""); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await mutate(editingId ? `/api/automations/${editingId}` : "/api/automations", editingId ? "PATCH" : "POST", {
      ...draft, threshold: Number(draft.threshold), recipient: draft.recipient ?? connection?.email ?? "",
    });
    if (ok) {
      setNotice(editingId ? "Cambios guardados." : "Automatización creada.");
      reset(); setPage(0);
    }
  }

  function edit(rule: Automation) {
    setEditingId(rule.id);
    setDraft({ name: rule.name, variable: rule.variable, direction: rule.direction, threshold: String(rule.threshold), recipient: rule.recipient, enabled: rule.enabled });
    setError(""); setNotice("");
  }

  const rules = data?.automations ?? [];
  const runs = data?.runs ?? [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rules.length / PAGE_SIZE) - 1));
  const currentRunPage = Math.min(runPage, Math.max(0, Math.ceil(runs.length / RUN_PAGE_SIZE) - 1));

  return <section className="autoWorkspace" aria-label="Automatizaciones">
    <div className="card autoFormCard">
      <h1 className="autoTitle">{editingId ? "Editar automatización" : "Nueva automatización"}</h1>
      <p className="autoHelp">Un correo cuando se cumpla la condición. Se rearma al volver a la normalidad.</p>
      <form className="autoForm" onSubmit={save}>
        <fieldset disabled={busy}>
          <label>Nombre<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Variable<select value={draft.variable} onChange={(event) => setDraft({ ...draft, variable: event.target.value as Automation["variable"], threshold: "" })}>
            <option value="temperature">Temperatura</option><option value="humidity">Humedad</option>
          </select></label>
          <div className="autoCondition">
            <label>Condición<select value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value as Automation["direction"] })}>
              <option value="gt">Mayor que (&gt;)</option><option value="gte">Mayor o igual (≥)</option>
              <option value="lt">Menor que (&lt;)</option><option value="lte">Menor o igual (≤)</option>
            </select></label>
            <label>Umbral ({draft.variable === "temperature" ? "°C" : "%"})<input type="number" required step="any" min={draft.variable === "temperature" ? -20 : 0} max={draft.variable === "temperature" ? 80 : 100} value={draft.threshold} onChange={(event) => setDraft({ ...draft, threshold: event.target.value })} /></label>
          </div>
          <label>Enviar correo a<input type="email" required maxLength={254} value={draft.recipient ?? connection?.email ?? ""} onChange={(event) => setDraft({ ...draft, recipient: event.target.value })} /></label>
          <label className="autoCheckbox"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Activada</label>
          <div className="autoFormActions">
            <button type="submit" className="primaryButton">{busy ? "Guardando…" : editingId ? "Guardar cambios" : "Crear automatización"}</button>
            {editingId && <button type="button" className="textButton" onClick={reset}>Cancelar</button>}
          </div>
        </fieldset>
      </form>
      <div className="autoFeedback" aria-live="polite">
        {error && <p className="autoError" role="alert">{error}</p>}
        {notice && <p>{notice}</p>}
      </div>
      <div className="autoConnection">
        <span>{connection === null ? "Verificando Gmail…" : connection.connected ? `Gmail · ${connection.email}` : connection.error}</span>
        {connection?.connected === false && <button type="button" className="textButton" onClick={() => { setConnection(null); setConnectionRevision((n) => n + 1); }}>Revisar</button>}
      </div>
    </div>

    <div className="autoRight">
      <div className="card autoRulesCard">
        <div className="row"><h2 className="autoTitle">Automatizaciones</h2><span className="autoCount">{data ? rules.length : "—"}</span></div>
        <p className="autoHelp">Las creadas desde ChatGPT también aparecen aquí.</p>
        {loadError ? <p className="autoError" role="alert">{loadError}</p> : !data ? <p className="none">Cargando…</p> : rules.length === 0 ? <p className="none">Sin automatizaciones</p> :
          <ul className="autoRules">{rules.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((rule) => <li key={rule.id}>
            <div className="row"><h3 title={rule.name}>{rule.name}</h3><span className={`pill ${rule.enabled ? "ok" : "idle"}`}>{rule.enabled ? "Activada" : "Pausada"}</span></div>
            <div className="autoRuleDetails">
              <p className="autoRuleCondition">{variableLabel(rule.variable)} {directionSymbol[rule.direction]} {fmtThreshold(rule.variable, rule.threshold)}</p>
              <p className="autoRecipient" title={rule.recipient}>{rule.recipient}</p>
            </div>
            <div className="autoRuleActions">
              {pendingDelete === rule.id ? <>
                <span>¿Eliminar regla?</span>
                <button type="button" className="textButton danger" disabled={busy} onClick={async () => {
                  if (await mutate(`/api/automations/${rule.id}`, "DELETE")) {
                    setPendingDelete(null); if (editingId === rule.id) reset(); setNotice("Automatización eliminada.");
                  }
                }}>Eliminar</button>
                <button type="button" className="textButton" disabled={busy} onClick={() => setPendingDelete(null)}>Cancelar</button>
              </> : <>
                <button type="button" className="textButton" disabled={busy} onClick={() => edit(rule)}>Editar</button>
                <button type="button" className="textButton" disabled={busy} onClick={async () => {
                  if (await mutate(`/api/automations/${rule.id}`, "PATCH", { enabled: !rule.enabled })) {
                    if (editingId === rule.id) reset(); setNotice(rule.enabled ? "Automatización pausada." : "Automatización activada.");
                  }
                }}>{rule.enabled ? "Pausar" : "Activar"}</button>
                <button type="button" className="textButton danger" disabled={busy} onClick={() => setPendingDelete(rule.id)}>Eliminar</button>
              </>}
            </div>
          </li>)}</ul>}
        <Pager page={currentPage} total={rules.length} onChange={setPage} />
      </div>
      <div className="card autoRunsCard">
        <h2 className="autoTitle">Últimos correos</h2>
        {!data ? <p className="none">{loadError || "Cargando…"}</p> : runs.length === 0 ? <p className="none">Sin envíos</p> : <ul className="autoRuns">{runs.slice(currentRunPage * RUN_PAGE_SIZE, (currentRunPage + 1) * RUN_PAGE_SIZE).map((run) => <li key={run.id}>
          <div className="row"><b title={run.name}>{run.name}</b><span className={`tag ${run.status === "failed" || run.status === "unknown" ? "errorTag" : ""}`}>{automationRunLabels[run.status]}</span></div>
          <p>{dateFormat.format(new Date(run.triggeredAt))} · {fmtValue(run.variable, run.value)}</p>
          <p className="autoRecipient" title={run.recipient}>{run.recipient}</p>
          {run.error && <p className="autoError">{run.error}</p>}
        </li>)}</ul>}
        <Pager page={currentRunPage} total={runs.length} size={RUN_PAGE_SIZE} onChange={setRunPage} />
      </div>
    </div>
  </section>;
}
