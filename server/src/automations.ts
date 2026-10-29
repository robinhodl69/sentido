import { randomUUID } from "node:crypto";
import { automationPatchSchema, automationSchema, type Automation, type AutomationInput, type AutomationRun, type RunStatus } from "./automation-schema.js";
import { STALE_MS } from "./config.js";
import { database } from "./store.js";
import type { Reading } from "./types.js";

const RULE_COLUMNS = `id, name, variable, direction, threshold, recipient, enabled, active,
  created_at AS createdAt, updated_at AS updatedAt`;
const RUN_COLUMNS = `id, automation_id AS automationId, name, triggered_at AS triggeredAt,
  variable, direction, threshold, value, recipient, status, error, sent_at AS sentAt`;

function fromRow(row: Record<string, unknown>): Automation {
  return { ...row, enabled: Boolean(row.enabled), active: Boolean(row.active) } as unknown as Automation;
}

export class AutomationNotFound extends Error {
  status = 404;
  constructor() { super("La automatización ya no existe"); }
}

export function getAutomation(id: string): Automation {
  const row = database().prepare(`SELECT ${RULE_COLUMNS} FROM automations WHERE id = ?`).get(id);
  if (!row) throw new AutomationNotFound();
  return fromRow(row);
}

export function listAutomations(): Automation[] {
  return database().prepare(`SELECT ${RULE_COLUMNS} FROM automations ORDER BY created_at DESC, id`).all().map(fromRow);
}

export function listAutomationRuns(limit = 30): AutomationRun[] {
  return database().prepare(`SELECT ${RUN_COLUMNS} FROM automation_runs ORDER BY triggered_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as unknown as AutomationRun[];
}

export function createAutomation(input: unknown): Automation {
  const rule = automationSchema.parse(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  database().prepare(`INSERT INTO automations
    (id, name, variable, direction, threshold, recipient, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, rule.name, rule.variable, rule.direction, rule.threshold, rule.recipient, Number(rule.enabled), now, now,
  );
  return getAutomation(id);
}

export function updateAutomation(id: string, input: unknown): Automation {
  const patch = automationPatchSchema.parse(input);
  const previous = getAutomation(id);
  const { name, variable, direction, threshold, recipient, enabled } = previous;
  const rule = automationSchema.parse({ name, variable, direction, threshold, recipient, enabled, ...patch });
  const reset = rule.variable !== variable || rule.direction !== direction || rule.threshold !== threshold || rule.enabled !== enabled;
  database().prepare(`UPDATE automations SET name = ?, variable = ?, direction = ?, threshold = ?,
    recipient = ?, enabled = ?, active = ?, updated_at = ? WHERE id = ?`).run(
    rule.name, rule.variable, rule.direction, rule.threshold, rule.recipient, Number(rule.enabled),
    reset ? 0 : Number(previous.active), new Date().toISOString(), id,
  );
  if (!rule.enabled) {
    database().prepare("UPDATE automation_runs SET status = 'failed', error = 'Automatización pausada antes del envío' WHERE automation_id = ? AND status = 'queued'").run(id);
  }
  return getAutomation(id);
}

export function deleteAutomation(id: string): void {
  getAutomation(id);
  database().prepare("DELETE FROM automations WHERE id = ?").run(id);
  // Los envíos ya registrados conservan su historial. Se cancelan los aún no iniciados.
  database().prepare("UPDATE automation_runs SET status = 'failed', error = 'Automatización eliminada antes del envío' WHERE automation_id = ? AND status = 'queued'").run(id);
}

export function automationConditionMet(rule: Pick<AutomationInput, "variable" | "direction" | "threshold">, reading: Reading): boolean {
  const value = reading[rule.variable];
  switch (rule.direction) {
    case "gt": return value > rule.threshold;
    case "gte": return value >= rule.threshold;
    case "lt": return value < rule.threshold;
    case "lte": return value <= rule.threshold;
  }
}

/** Registra cada cruce y su correo pendiente en una sola transacción. Solo recibe lecturas reales. */
export function claimAutomationRuns(reading: Reading, now = Date.now()): void {
  if (!Number.isFinite(reading.t) || reading.t > now || now - reading.t > STALE_MS ||
      !Number.isFinite(reading.temperature) || !Number.isFinite(reading.humidity)) return;
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const rule of listAutomations()) {
      if (!rule.enabled) continue;
      const met = automationConditionMet(rule, reading);
      if (met === rule.active) continue;
      db.prepare("UPDATE automations SET active = ? WHERE id = ?").run(Number(met), rule.id);
      if (!met) continue;
      db.prepare(`INSERT INTO automation_runs
        (id, automation_id, name, triggered_at, variable, direction, threshold, value, recipient, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`).run(
        randomUUID(), rule.id, rule.name, new Date(reading.t).toISOString(), rule.variable,
        rule.direction, rule.threshold, reading[rule.variable], rule.recipient,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Reclama un envío antes de contactar a Composio. Impide envíos duplicados entre procesos. */
export function takeQueuedRun(): AutomationRun | null {
  return (database().prepare(`UPDATE automation_runs SET status = 'sending'
    WHERE id = (SELECT id FROM automation_runs WHERE status = 'queued' ORDER BY triggered_at, rowid LIMIT 1)
    AND status = 'queued' RETURNING ${RUN_COLUMNS}`).get() as unknown as AutomationRun | undefined) ?? null;
}

export function finishAutomationRun(id: string, status: Extract<RunStatus, "sent" | "failed" | "unknown">, error: string | null = null): void {
  database().prepare("UPDATE automation_runs SET status = ?, error = ?, sent_at = ? WHERE id = ? AND status = 'sending'")
    .run(status, error, status === "sent" ? new Date().toISOString() : null, id);
}

export function recoverInterruptedRuns(): void {
  database().prepare(`UPDATE automation_runs SET status = 'unknown', error =
    'El servidor se reinició durante el envío. Revisa Gmail antes de repetirlo.' WHERE status = 'sending'`).run();
}
